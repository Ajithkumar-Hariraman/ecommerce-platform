import type { ProductRepository } from "../products/product.repository.js";
import type { PaymentClient } from "../payments/payment.client.js";
import { assertTransition } from "../payments/payment-workflow.js";
import { randomUUID } from "node:crypto";
import { AppError } from "../../errors/app-error.js";
import type { OrderRepository } from "./order.repository.js";
import type { CreateOrderInput, Order } from "./order.types.js";

export class OrderService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly paymentClient: PaymentClient,
    private readonly products?: ProductRepository,
  ) {}

  async create(input: CreateOrderInput): Promise<Order> {
    if (!input.items.length) throw new AppError(400, "Order must contain items");
    if (this.products) {
      const items = [];
      for (const item of input.items) {
        const product = await this.products.findById(item.productId);
        if (!product || product.status !== "ACTIVE")
          throw new AppError(400, "Product is unavailable for checkout");
        items.push({
          ...item,
          unitPriceInMinorUnits: product.priceInMinorUnits,
        });
      }
      input = { ...input, items };
    }
    let totalInMinorUnits = 0;
    const items = input.items.map((item) => {
      if (
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0 ||
        item.quantity > 2_147_483_647 ||
        !Number.isSafeInteger(item.unitPriceInMinorUnits) ||
        item.unitPriceInMinorUnits < 0
      ) {
        throw new AppError(400, "Invalid order quantity or price");
      }
      const lineTotalInMinorUnits = item.quantity * item.unitPriceInMinorUnits;
      totalInMinorUnits += lineTotalInMinorUnits;
      if (
        !Number.isSafeInteger(lineTotalInMinorUnits) ||
        !Number.isSafeInteger(totalInMinorUnits)
      ) {
        throw new AppError(400, "Order total exceeds safe integer bounds");
      }
      return { ...item, lineTotalInMinorUnits };
    });
    const now = new Date().toISOString();
    const order: Order = {
      id: randomUUID(),
      customerId: input.customerId,
      items,
      totalInMinorUnits,
      status: "CREATED",
      paymentId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.orderRepository.save(order);
    return this.initiatePayment(order.id);
  }

  async initiatePayment(id: string): Promise<Order> {
    const order = await this.findById(id);
    if (order.paymentId && order.status !== "CREATED") return order;
    assertTransition(order.status, "PAYMENT_PENDING");
    let payment;
    try {
      payment = await this.paymentClient.createPayment({
        orderId: order.id,
        amountInMinorUnits: order.totalInMinorUnits,
        idempotencyKey: `payment:${order.id}`,
      });
    } catch {
      throw new AppError(
        502,
        `Payment initiation failed; order ${order.id} is retained. Retry POST /api/v1/orders/${order.id}/payment`,
      );
    }
    const updated: Order = {
      ...order,
      status: "PAYMENT_PENDING",
      paymentId: payment.paymentId,
      version: order.version + 1,
      updatedAt: new Date().toISOString(),
    };
    try {
      await this.orderRepository.update(updated);
    } catch (error) {
      const current = await this.findById(id);
      if (current.paymentId === payment.paymentId && current.status !== "CREATED") return current;
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        `Payment state persistence failed; retry POST /api/v1/orders/${order.id}/payment`,
      );
    }
    return updated;
  }

  async findById(id: string): Promise<Order> {
    const order = await this.orderRepository.findById(id);
    if (!order) throw new AppError(404, "Order not found");
    return order;
  }
}

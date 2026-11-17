import type { OrderListInput, OrderListResponse } from "./order-list.js";
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
    private readonly products: ProductRepository,
  ) {}

  async list(ownerSubject: string | null, input: OrderListInput = {}): Promise<OrderListResponse> {
    const page = input.page ?? 1,
      limit = input.limit ?? 20,
      offset = (page - 1) * limit;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset + limit)
    )
      throw new AppError(400, "Invalid order pagination");
    if (ownerSubject !== null && !ownerSubject.trim())
      throw new AppError(401, "Authentication required");
    const { orders, total } = await this.orderRepository.list({ ownerSubject, limit, offset });
    const totalPages = Math.ceil(total / limit);
    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1 && total > 0,
      },
    };
  }
  async create(
    input: CreateOrderInput,
    ownerSubject: string,
    customer?: Order["customer"],
  ): Promise<Order> {
    if (typeof ownerSubject !== "string" || !ownerSubject.trim())
      throw new AppError(401, "Authentication required");
    if (!input.items.length) throw new AppError(400, "Order must contain items");
    const quantities = new Map<string, number>();
    for (const item of input.items) {
      if (
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 2_147_483_647
      )
        throw new AppError(400, "Invalid order quantity");
      const quantity = (quantities.get(item.productId) ?? 0) + item.quantity;
      if (!Number.isSafeInteger(quantity) || quantity > 2_147_483_647)
        throw new AppError(400, "Invalid combined order quantity");
      quantities.set(item.productId, quantity);
    }
    const priced = [];
    for (const [productId, quantity] of quantities) {
      const product = await this.products.findById(productId);
      if (!product || product.status !== "ACTIVE")
        throw new AppError(400, "Product is unavailable for checkout");
      if (quantity > product.stock)
        throw new AppError(409, "Requested quantity exceeds available stock");
      if (!Number.isSafeInteger(product.priceInMinorUnits) || product.priceInMinorUnits <= 0)
        throw new AppError(409, "Product has no valid checkout price");
      priced.push({
        productId,
        quantity,
        name: product.name,
        unitPriceInMinorUnits: product.priceInMinorUnits,
      });
    }
    input = { ...input, items: priced };
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
      customerId: null,
      ownerSubject,
      ...(customer ? { customer } : {}),
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
    assertOrderPricing(order);
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

// Snapshot prices remain stable when catalog prices change after order creation.
export function assertOrderPricing(order: Order): void {
  let total = 0;
  for (const item of order.items) {
    if (
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 ||
      !Number.isSafeInteger(item.unitPriceInMinorUnits) ||
      item.unitPriceInMinorUnits <= 0 ||
      !Number.isSafeInteger(item.lineTotalInMinorUnits) ||
      item.lineTotalInMinorUnits !== item.quantity * item.unitPriceInMinorUnits
    )
      throw new AppError(409, "Saved order pricing is invalid; payment is blocked pending repair");
    total += item.lineTotalInMinorUnits;
  }
  if (
    !order.items.length ||
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    total !== order.totalInMinorUnits
  )
    throw new AppError(409, "Saved order pricing is invalid; payment is blocked pending repair");
}

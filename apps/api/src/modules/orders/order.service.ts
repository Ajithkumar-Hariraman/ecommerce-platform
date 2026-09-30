import { randomUUID } from "node:crypto";
import { AppError } from "../../errors/app-error.js";
import type { OrderRepository } from "./order.repository.js";
import type { CreateOrderInput, Order } from "./order.types.js";

export class OrderService {
  constructor(private readonly orderRepository: OrderRepository) {}

  async create(input: CreateOrderInput): Promise<Order> {
    if (!input.items.length) throw new AppError(400, "Order must contain items");
    let totalInMinorUnits = 0;
    const items = input.items.map(item => {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 2_147_483_647 ||
          !Number.isSafeInteger(item.unitPriceInMinorUnits) || item.unitPriceInMinorUnits < 0) {
        throw new AppError(400, "Invalid order quantity or price");
      }
      const lineTotalInMinorUnits = item.quantity * item.unitPriceInMinorUnits;
      totalInMinorUnits += lineTotalInMinorUnits;
      if (!Number.isSafeInteger(lineTotalInMinorUnits) || !Number.isSafeInteger(totalInMinorUnits)) {
        throw new AppError(400, "Order total exceeds safe integer bounds");
      }
      return { ...item, lineTotalInMinorUnits };
    });
    const now = new Date().toISOString();
    const order: Order = {
      id: randomUUID(), customerId: input.customerId, items, totalInMinorUnits,
      status: "CREATED", paymentId: null, version: 1, createdAt: now, updatedAt: now,
    };
    await this.orderRepository.save(order);
    return order;
  }

  async findById(id: string): Promise<Order> {
    const order = await this.orderRepository.findById(id);
    if (!order) throw new AppError(404, "Order not found");
    return order;
  }
}

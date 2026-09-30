import type { Order } from "./order.types.js";

export interface OrderRepository {
  save(order: Order): Promise<void>;

  findById(id: string): Promise<Order | null>;

  update(order: Order): Promise<void>;
}

import type { OrderListQuery, OrderListResult } from "./order-list.js";
import type { Order } from "./order.types.js";

export interface OrderRepository {
  list(query: OrderListQuery): Promise<OrderListResult>;
  save(order: Order): Promise<void>;

  findById(id: string): Promise<Order | null>;

  update(order: Order): Promise<void>;
}

import type { OrderRepository } from "./order.repository.js";
import { OrderService } from "./order.service.js";
import { OrderController } from "./order.controller.js";
import { createOrderRouter } from "./order.routes.js";

export function createOrderModule(repository: OrderRepository) {
  return createOrderRouter(new OrderController(new OrderService(repository)));
}

import type { ProductRepository } from "../products/product.repository.js";
import type { PaymentClient } from "../payments/payment.client.js";
import type { OrderRepository } from "./order.repository.js";
import { OrderService } from "./order.service.js";
import { OrderController } from "./order.controller.js";
import { createOrderRouter } from "./order.routes.js";

export function createOrderModule(
  repository: OrderRepository,
  paymentClient: PaymentClient,
  products: ProductRepository,
) {
  return createOrderRouter(
    new OrderController(new OrderService(repository, paymentClient, products)),
  );
}

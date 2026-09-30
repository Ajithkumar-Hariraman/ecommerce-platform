import { Router } from "express";
import type { OrderController } from "./order.controller.js";
import { validateCreateOrder, validateOrderId } from "./order.validation.js";

export function createOrderRouter(controller: OrderController): Router {
  const router = Router();
  router.post("/", validateCreateOrder, controller.create);
  router.post("/:id/payment", validateOrderId, controller.initiatePayment);
  router.get("/:id", validateOrderId, controller.findById);
  return router;
}

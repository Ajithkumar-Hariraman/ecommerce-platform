import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { assertOrderAccess } from "../orders/order-access.js";
import { assertOrderPricing } from "../orders/order.service.js";
import type { Order } from "../orders/order.types.js";
import type { OrderRepository } from "../orders/order.repository.js";

export interface SimulatorCheckout {
  finalize(paymentId: string, outcome: "succeed" | "fail"): Promise<void>;
}
export class HttpSimulatorCheckout implements SimulatorCheckout {
  constructor(private readonly baseUrl: string) {}
  async finalize(paymentId: string, outcome: "succeed" | "fail") {
    if (!z.uuid().safeParse(paymentId).success) throw new AppError(409, "Invalid saved payment");
    let response: Response;
    try {
      response = await fetch(
        new URL(`payments/${paymentId}/${outcome}`, this.baseUrl.replace(/\/?$/, "/")),
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        },
      );
      await response.body?.cancel();
    } catch {
      throw new AppError(
        502,
        "Simulator unavailable; refresh status before retrying the same order",
      );
    }
    if (!response.ok)
      throw new AppError(
        response.status === 409 ? 409 : 502,
        response.status === 409
          ? "Simulation already finalized with a different outcome"
          : "Simulator confirmation unavailable; retry the same order",
      );
  }
}
export class SimulatorCheckoutService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly simulator: SimulatorCheckout,
  ) {}
  async complete(order: Order, outcome: "succeed" | "fail"): Promise<Order> {
    assertOrderPricing(order);
    const expected = outcome === "succeed" ? "PAID" : "PAYMENT_FAILED";
    if (order.status === expected) return order;
    if (order.status !== "PAYMENT_PENDING" || !order.paymentId)
      throw new AppError(409, "This simulation cannot be changed; refresh your order status");
    // The existing provider reuses its durable event and delivers a signed webhook.
    await this.simulator.finalize(order.paymentId, outcome);
    const current = await this.orders.findById(order.id);
    if (!current) throw new AppError(404, "Order not found");
    return current;
  }
}
// The server supplies this capability only in development + local provider mode.
export function simulatorCheckoutRouter(orders: OrderRepository, simulator: SimulatorCheckout) {
  const router = Router();
  const service = new SimulatorCheckoutService(orders, simulator);
  router.post("/:id/simulator-payment", async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    const input = z.strictObject({ outcome: z.enum(["succeed", "fail"]) }).safeParse(req.body);
    if (!id.success || !input.success) throw new AppError(400, "Invalid simulator checkout");
    const order = await orders.findById(id.data);
    if (!order) throw new AppError(404, "Order not found");
    assertOrderAccess(res.locals.principal, order);
    res.json(await service.complete(order, input.data.outcome));
  });
  return router;
}

import { assertOrderAccess } from "../orders/order-access.js";
import { raw, Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { checkoutVerification } from "./razorpay.gateway.js";
import type { RazorpayPaymentClient } from "./razorpay.gateway.js";
import type { OrderRepository } from "../orders/order.repository.js";
import type { PaymentWorkflowRepository } from "./payment-workflow.js";
export function razorpayWebhookRouter(
  gateway: RazorpayPaymentClient,
  orders: OrderRepository,
  workflow: PaymentWorkflowRepository,
) {
  const router = Router();
  router.post(
    "/razorpay",
    raw({ type: "application/json", limit: "64kb", inflate: false }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body))
        throw new AppError(415, "Razorpay webhook requires application/json");
      await gateway.webhook(
        req.body,
        req.get("X-Razorpay-Signature") ?? "",
        req.get("X-Razorpay-Event-Id") ?? "",
        orders,
        workflow,
      );
      res.json({ received: true });
    },
  );
  return router;
}
// Mounted behind the existing Order authentication, rate limiter and per-Order authorization.
export function razorpayCheckoutRouter(gateway: RazorpayPaymentClient, orders: OrderRepository, workflow: PaymentWorkflowRepository) {
  const router = Router();
  router.post("/:id/checkout", async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw new AppError(400, "Invalid order ID");
    const order = await orders.findById(id.data);
    if (!order) throw new AppError(404, "Order not found");
    assertOrderAccess(res.locals.principal, order);
    if (!["PAYMENT_PENDING", "PAYMENT_FAILED"].includes(order.status))
      throw new AppError(409, "Order cannot be checked out");
    res.json(await gateway.checkout(order, workflow));
  });
  router.post("/:id/checkout/verify", async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    const input = checkoutVerification.safeParse(req.body);
    if (!id.success || !input.success) throw new AppError(400, "Invalid checkout confirmation");
    const order = await orders.findById(id.data);
    if (!order) throw new AppError(404, "Order not found");
    assertOrderAccess(res.locals.principal, order);
    const paymentStatus = await gateway.verifyCheckout(order, input.data, workflow);
    res.json({ verified: true, paymentStatus });
  });
  return router;
}

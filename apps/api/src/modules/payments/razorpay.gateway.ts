import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { CheckoutMapping, CheckoutRepository, CheckoutSession } from "./checkout.repository.js";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import type { PaymentClient } from "./payment.client.js";
import type { RazorpayApi } from "./razorpay.api.js";
import { razorpayPayment } from "./razorpay.api.js";
import type { Order } from "../orders/order.types.js";
import { assertOrderPricing } from "../orders/order.service.js";
import type { OrderRepository } from "../orders/order.repository.js";
import type { PaymentWorkflowRepository } from "./payment-workflow.js";
export interface Checkout {
  keyId: string;
  providerOrderId: string;
  amount: number;
  currency: "INR";
  orderId: string;
}
export function verifyRazorpaySignature(
  body: Buffer | string,
  signature: string,
  secret: string,
): void {
  if (!/^[a-fA-F0-9]{64}$/.test(signature)) throw new AppError(401, "Invalid Razorpay signature");
  const expected = createHmac("sha256", secret).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
    throw new AppError(401, "Invalid Razorpay signature");
}
function eventUuid(identity: string): string {
  const bytes = createHash("sha256")
    .update("razorpay:" + identity)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80;
  bytes[8] = (bytes[8]! & 63) | 128;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const checkoutVerification = z.strictObject({
  razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]+$/),
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  razorpay_signature: z.string(),
});
const webhook = z.object({
  event: z.enum(["payment.captured", "payment.failed"]),
  payload: z.object({ payment: z.object({ entity: razorpayPayment }) }),
});
export class RazorpayPaymentClient implements PaymentClient {
  constructor(
    private readonly repository: CheckoutRepository,
    private readonly api: RazorpayApi,
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {}
  async createPayment(input: Parameters<PaymentClient["createPayment"]>[0]) {
    if (
      input.idempotencyKey !== `payment:${input.orderId}` ||
      !Number.isSafeInteger(input.amountInMinorUnits) ||
      input.amountInMinorUnits < 100
    )
      throw new AppError(400, "Razorpay requires at least INR 1 and a stable payment key");
    return this.repository.locked(input.orderId, async (db) => {
      await db.initialize({
        orderId: input.orderId,
        paymentId: randomUUID(),
        idempotencyKey: input.idempotencyKey,
        amount: input.amountInMinorUnits,
      });
      const row = (await db.findOrder(input.orderId))!;
      if (
        Number(row.amount) !== input.amountInMinorUnits ||
        row.idempotency_key !== input.idempotencyKey
      )
        throw new AppError(409, "Payment idempotency conflict");
      if (!row.provider_order_id) {
        // Persist intent before HTTPS. An ambiguous/crashed POST is never blindly repeated.
        let remote;
        if (row.creation_started || !(await db.startCreation(input.orderId))) {
          remote = await this.api.findOrder(input.orderId);
          if (!remote)
            throw new AppError(
              503,
              "Payment creation outcome is unknown; reconcile the receipt in Razorpay before retrying",
            );
        } else {
          remote = await this.api.createOrder(input.orderId, input.amountInMinorUnits);
        }
        if (
          remote.receipt !== input.orderId ||
          remote.amount !== input.amountInMinorUnits ||
          remote.currency !== "INR"
        )
          throw new AppError(502, "Razorpay Order does not match this checkout");
        await db.setProviderOrder(input.orderId, remote.id);
      }
      return { paymentId: row.payment_id, status: "PENDING" as const };
    });
  }
  private assertMapping(order: Order, mapping: CheckoutMapping) {
    assertOrderPricing(order);
    if (order.paymentId !== mapping.payment_id || order.totalInMinorUnits !== Number(mapping.amount))
      throw new AppError(409, "Payment does not match the saved order");
  }
  private async mapping(order: Order) {
    const row = await this.repository.findOrder(order.id);
    if (!row?.provider_order_id) throw new AppError(409, "Payment has not been initialized");
    this.assertMapping(order, row);
    return { ...row, provider_order_id: row.provider_order_id };
  }
  private assertPayment(payment: z.infer<typeof razorpayPayment>, mapping: CheckoutMapping) {
    if (payment.order_id !== mapping.provider_order_id ||
        payment.amount !== Number(mapping.amount) || payment.currency !== mapping.currency)
      throw new AppError(409, "Payment amount, currency or Order mismatch");
  }
  private async applyAttempt(
    db: CheckoutSession,
    order: Order,
    payment: z.infer<typeof razorpayPayment>,
    workflow: PaymentWorkflowRepository,
  ) {
    await db.recordAttempt(payment.id, order.id, payment.status, payment.status !== "authorized");
    if (payment.status === "authorized") return;
    await workflow.applyEvent({
      eventId: eventUuid("payment." + payment.status + ":" + payment.id),
      orderId: order.id,
      paymentId: order.paymentId!,
      type: payment.status === "captured" ? "payment.succeeded" : "payment.failed",
      occurredAt: new Date(payment.created_at * 1000).toISOString(),
      provider: "razorpay",
    });
  }
  async checkout(order: Order, workflow: PaymentWorkflowRepository): Promise<Checkout> {
    const row = await this.mapping(order);
    // Reconcile the same provider Order before reopening it after an exit or lost callback.
    const attempts = await this.api.orderPayments(row.provider_order_id);
    for (const attempt of attempts) this.assertPayment(attempt, row);
    const captured = attempts.find((attempt) => attempt.status === "captured");
    if (captured) {
      await this.repository.locked(order.id, (db) => this.applyAttempt(db, order, captured, workflow));
      throw new AppError(409, "Payment is already confirmed. Refresh your order status.");
    }
    if (attempts.some((attempt) => ["authorized", "refunded"].includes(attempt.status)))
      throw new AppError(409, "Payment cannot be retried. Check your order status or contact support.");
    return {
      keyId: this.keyId,
      providerOrderId: row.provider_order_id,
      amount: Number(row.amount),
      currency: row.currency,
      orderId: order.id,
    };
  }
  async verifyCheckout(
    order: Order,
    input: z.infer<typeof checkoutVerification>,
    workflow: PaymentWorkflowRepository,
  ): Promise<"PAID" | "AWAITING_CAPTURE"> {
    const mapping = await this.mapping(order);
    if (input.razorpay_order_id !== mapping.provider_order_id)
      throw new AppError(400, "Checkout Order mismatch");
    verifyRazorpaySignature(
      mapping.provider_order_id + "|" + input.razorpay_payment_id,
      input.razorpay_signature,
      this.keySecret,
    );
    const payment = await this.api.payment(input.razorpay_payment_id);
    this.assertPayment(payment, mapping);
    if (payment.id !== input.razorpay_payment_id ||
        (payment.status !== "authorized" && payment.status !== "captured"))
      throw new AppError(409, "Payment does not match checkout");
    await this.repository.locked(order.id, (db) => this.applyAttempt(db, order, payment, workflow));
    return payment.status === "captured" ? "PAID" : "AWAITING_CAPTURE";
  }
  async webhook(
    raw: Buffer,
    signature: string,
    eventId: string,
    orders: OrderRepository,
    workflow: PaymentWorkflowRepository,
  ): Promise<void> {
    verifyRazorpaySignature(raw, signature, this.webhookSecret);
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(eventId))
      throw new AppError(400, "Missing or invalid Razorpay event ID");
    let value: unknown;
    try {
      value = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new AppError(400, "Invalid Razorpay webhook");
    }
    const result = webhook.safeParse(value);
    if (!result.success) throw new AppError(400, "Unsupported or invalid Razorpay webhook");
    const event = result.data;
    const payment = event.payload.payment.entity;
    if (payment.status !== (event.event === "payment.captured" ? "captured" : "failed"))
      throw new AppError(400, "Razorpay status mismatch");
    const mapping = await this.repository.findProviderOrder(payment.order_id);
    if (!mapping) throw new AppError(404, "Unknown Razorpay Order");
    this.assertPayment(payment, mapping);
    await this.repository.locked(mapping.order_id, async (db) => {
      const hash = createHash("sha256").update(raw).digest("hex");
      const record = await db.claimEvent(eventId, hash);
      if (record.body_hash !== hash) throw new AppError(409, "Webhook identity conflict");
      if (record.processed) return;
      const order = await orders.findById(mapping.order_id);
      if (!order) throw new AppError(404, "Order not found");
      this.assertMapping(order, mapping);
      await this.applyAttempt(db, order, payment, workflow);
      await db.completeEvent(eventId);
    });
  }
}

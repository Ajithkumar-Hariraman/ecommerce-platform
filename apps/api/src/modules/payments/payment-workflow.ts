import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import type { OrderStatus } from "../orders/order.types.js";

export const paymentEventSchema = z.strictObject({
  eventId: z.uuid(),
  type: z.enum(["payment.succeeded", "payment.failed"]),
  paymentId: z.uuid(),
  orderId: z.uuid(),
  occurredAt: z.iso.datetime(),
});
export type PaymentEvent = z.infer<typeof paymentEventSchema> & {
  provider?: "razorpay";
};
export interface OrderAudit {
  id: string;
  orderId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  reason: string;
  changedAt: Date;
}
export interface OrderAuditRepository {
  append(audit: OrderAudit): Promise<void>;
}
export interface WebhookEventRepository {
  isProcessed(eventId: string): Promise<boolean>;
  record(eventId: string): Promise<void>;
}
// True means a durable transition/projection was applied; false means already processed.
export interface PaymentWorkflowRepository {
  applyEvent(event: PaymentEvent): Promise<boolean>;
}
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (
    (from === "CREATED" && to === "PAYMENT_PENDING") ||
    (from === "PAYMENT_PENDING" && (to === "PAID" || to === "PAYMENT_FAILED"))
  )
    return;
  throw new AppError(409, "Invalid order status transition");
}
export function webhookAudit(
  event: PaymentEvent,
  order: { paymentId: string | null; status: OrderStatus; totalInMinorUnits: number },
): OrderAudit | null {
  if (!Number.isSafeInteger(order.totalInMinorUnits) || order.totalInMinorUnits <= 0)
    throw new AppError(409, "Saved order pricing is invalid; payment is blocked pending repair");
  if (order.paymentId !== event.paymentId)
    throw new AppError(409, "Payment does not belong to this order");
  const toStatus = event.type === "payment.succeeded" ? "PAID" : "PAYMENT_FAILED";
  if (event.provider === "razorpay") {
    // A failed attempt is not a terminal Razorpay Order; captured settlement wins.
    if (
      order.status === "PAID" ||
      (order.status === "PAYMENT_FAILED" && toStatus === "PAYMENT_FAILED")
    )
      return null;
    if (!(order.status === "PAYMENT_FAILED" && toStatus === "PAID"))
      assertTransition(order.status, toStatus);
  } else assertTransition(order.status, toStatus);
  return {
    id: event.eventId,
    orderId: event.orderId,
    fromStatus: order.status,
    toStatus,
    reason: event.type,
    changedAt: new Date(),
  };
}

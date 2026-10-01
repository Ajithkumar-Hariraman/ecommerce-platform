import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import type { OrderStatus } from "../orders/order.types.js";

export const paymentEventSchema = z.strictObject({
  eventId: z.uuid(), type: z.enum(["payment.succeeded", "payment.failed"]),
  paymentId: z.uuid(), orderId: z.uuid(), occurredAt: z.iso.datetime(),
});
export type PaymentEvent = z.infer<typeof paymentEventSchema>;
export interface OrderAudit {
  id: string; orderId: string; fromStatus: OrderStatus; toStatus: OrderStatus; reason: string; changedAt: Date;
}
export interface OrderAuditRepository { append(audit: OrderAudit): Promise<void>; }
export interface WebhookEventRepository {
  isProcessed(eventId: string): Promise<boolean>;
  record(eventId: string): Promise<void>;
}
// True means a durable transition/projection was applied; false means already processed.
export interface PaymentWorkflowRepository { applyEvent(event: PaymentEvent): Promise<boolean>; }
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if ((from === "CREATED" && to === "PAYMENT_PENDING") ||
      (from === "PAYMENT_PENDING" && (to === "PAID" || to === "PAYMENT_FAILED"))) return;
  throw new AppError(409, "Invalid order status transition");
}
export function webhookAudit(event: PaymentEvent, order: {paymentId: string | null; status: OrderStatus}): OrderAudit {
  if (order.paymentId !== event.paymentId) throw new AppError(409, "Payment does not belong to this order");
  const toStatus = event.type === "payment.succeeded" ? "PAID" : "PAYMENT_FAILED";
  assertTransition(order.status, toStatus);
  return {id: event.eventId, orderId: event.orderId, fromStatus: order.status, toStatus, reason: event.type, changedAt: new Date()};
}

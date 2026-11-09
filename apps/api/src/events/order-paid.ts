import { z } from "zod";
import type { PaymentEvent } from "../modules/payments/payment-workflow.js";
export const orderPaidSchema = z.strictObject({
  eventId: z.uuid(),
  eventType: z.literal("OrderPaid"),
  eventVersion: z.literal(1),
  occurredAt: z.iso.datetime(),
  aggregateType: z.literal("Order"),
  aggregateId: z.uuid(),
  payload: z.strictObject({ paymentId: z.uuid() }),
});
export type OrderPaid = z.infer<typeof orderPaidSchema>;
export interface EventPublisher {
  readonly failureCategory?: "KAFKA_UNAVAILABLE" | "PUBSUB_UNAVAILABLE" | "SNS_UNAVAILABLE";
  publish(event: OrderPaid): Promise<void>;
}
export function orderPaid(event: PaymentEvent): OrderPaid {
  return orderPaidSchema.parse({
    eventId: event.eventId,
    eventType: "OrderPaid",
    eventVersion: 1,
    occurredAt: event.occurredAt,
    aggregateType: "Order",
    aggregateId: event.orderId,
    payload: { paymentId: event.paymentId },
  });
}

import type { EventPublisher } from "../../events/order-paid.js";
import { orderPaid } from "../../events/order-paid.js";
import type { PaymentEvent, PaymentWorkflowRepository } from "./payment-workflow.js";

// DB transition completes before publication. This is deliberately not an outbox.
export class PublishingPaymentWorkflow implements PaymentWorkflowRepository {
  constructor(private readonly workflow: PaymentWorkflowRepository, private readonly publisher: EventPublisher) {}
  async applyEvent(event: PaymentEvent): Promise<boolean> {
    const applied = await this.workflow.applyEvent(event);
    if (applied && event.type === "payment.succeeded") {
      try { await this.publisher.publish(orderPaid(event)); }
      catch { console.error({operation: "OrderPaid publish failed after DB commit", eventId: event.eventId, orderId: event.orderId}); }
    }
    return applied;
  }
}

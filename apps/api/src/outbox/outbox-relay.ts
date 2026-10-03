import { orderPaidSchema } from "../events/order-paid.js";
import type { EventPublisher } from "../events/order-paid.js";
import type { ClaimOptions, OutboxRepository } from "./outbox.js";
import { retryDelay } from "./outbox.js";
export class OutboxRelay {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly publisher: EventPublisher,
    private readonly options: ClaimOptions,
  ) {}
  async runOnce(stopping: () => boolean = () => false): Promise<number> {
    let handled = 0;
    for (let i = 0; i < this.options.batchSize && !stopping(); i++) {
      // Claim just in time: later batch members cannot exhaust their lease waiting for earlier sends.
      const claim = (await this.repository.claimBatch({ ...this.options, batchSize: 1 }))[0];
      if (!claim) break;
      let category: "INVALID_EVENT" | "KAFKA_UNAVAILABLE" | "PUBSUB_UNAVAILABLE" | undefined;
      const parsed = orderPaidSchema.safeParse(claim.event);
      if (!parsed.success) category = "INVALID_EVENT";
      else {
        try {
          await this.publisher.publish(parsed.data);
        } catch {
          category = this.publisher.failureCategory ?? "KAFKA_UNAVAILABLE";
        }
      }
      // A failed DB acknowledgement leaves PROCESSING intact; lease expiry recovers it.
      const owned = category
        ? await this.repository.markFailed(
            claim,
            category,
            retryDelay(claim.attempts),
            this.options.maxAttempts,
          )
        : await this.repository.markPublished(claim);
      console.info({
        outboxId: claim.id,
        eventId: claim.event.eventId,
        eventType: claim.event.eventType,
        aggregateId: claim.event.aggregateId,
        attempt: claim.attempts,
        storageBackend: this.repository.storageBackend,
        publishStatus: !owned ? "CLAIM_LOST" : (category ?? "PUBLISHED"),
      });
      handled++;
    }
    return handled;
  }
}

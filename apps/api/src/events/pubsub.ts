import { PubSub } from "@google-cloud/pubsub";
import type { Message, Topic } from "@google-cloud/pubsub";
import { orderPaidSchema } from "./order-paid.js";
import type { EventPublisher, OrderPaid } from "./order-paid.js";
import type { OrderNotificationRepository } from "./order-notification.repository.js";

export class PubSubEventPublisher implements EventPublisher {
  readonly failureCategory = "PUBSUB_UNAVAILABLE" as const;
  constructor(private readonly topic: Pick<Topic, "publishMessage">) {}
  async publish(event: OrderPaid): Promise<void> {
    const validated = orderPaidSchema.parse(event);
    await this.topic.publishMessage({
      data: Buffer.from(JSON.stringify(validated)),
      attributes: {
        eventId: validated.eventId,
        eventType: validated.eventType,
        aggregateId: validated.aggregateId,
      },
    });
  }
}

// Ack follows the durable event-ID deduplication record; database failure means redelivery.
export async function processPubSubMessage(
  message: Pick<Message, "data" | "attributes" | "ack" | "nack">,
  repository: OrderNotificationRepository,
): Promise<void> {
  try {
    if (message.data.length > 32768) throw new Error("Event exceeds bound");
    const event = orderPaidSchema.parse(JSON.parse(message.data.toString("utf8")));
    if (
      message.attributes.eventId !== event.eventId ||
      message.attributes.aggregateId !== event.aggregateId ||
      message.attributes.eventType !== event.eventType
    )
      throw new Error("Event envelope mismatch");
    const outcome = await repository.process(event);
    message.ack();
    console.info({
      operation: "pubsub-order-event",
      eventId: event.eventId,
      orderId: event.aggregateId,
      outcome,
    });
  } catch {
    // Never log/copy untrusted payloads. Subscription retry + DLQ policy bounds poison retries.
    message.nack();
    console.warn({ operation: "pubsub-order-event", outcome: "retry-or-dlq" });
  }
}

export function pubSubClient(config: { projectId: string; region: string }): PubSub {
  return new PubSub({
    projectId: config.projectId,
  });
}
export async function startPubSubConsumer(
  client: PubSub,
  name: string,
  repository: OrderNotificationRepository,
  onCrash: () => void,
) {
  const subscription = client.subscription(name, {
    flowControl: { maxMessages: 10, maxBytes: 327680, allowExcessMessages: false },
  });
  const [metadata] = await subscription.getMetadata();
  if (!metadata.deadLetterPolicy?.deadLetterTopic || !metadata.deadLetterPolicy.maxDeliveryAttempts)
    throw new Error("Pub/Sub subscription requires a bounded DLQ policy");
  const active = new Set<Promise<void>>();
  const onMessage = (message: Message) => {
    const work = processPubSubMessage(message, repository);
    active.add(work);
    void work.finally(() => active.delete(work));
  };
  subscription.on("error", () => {
    console.error({ operation: "pubsub-subscription", outcome: "failed" });
    onCrash();
  });
  subscription.on("message", onMessage);
  return {
    async close() {
      subscription.removeListener("message", onMessage);
      await Promise.allSettled([...active]);
      await subscription.close();
    },
  };
}

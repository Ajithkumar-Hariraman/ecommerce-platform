import { createHash } from "node:crypto";
import { z } from "zod";
import type { Producer } from "kafkajs";
import type { KafkaConfig } from "../config/env.js";
import { orderPaidSchema } from "./order-paid.js";
import type { OrderPaid } from "./order-paid.js";
import { TransientProcessingError } from "./order-notification.repository.js";
import type { OrderNotificationRepository } from "./order-notification.repository.js";

const retrySchema = z.strictObject({
  event: orderPaidSchema,
  retryCount: z.number().int().min(1).max(10),
  originalTopic: z.string(),
  failureCategory: z.literal("TRANSIENT_STORAGE"),
});
export class OrderEventHandler {
  constructor(
    private readonly repository: OrderNotificationRepository,
    private readonly producer: Pick<Producer, "send">,
    private readonly config: KafkaConfig,
  ) {}
  async handle(input: {
    topic: string;
    key: Buffer | null;
    value: Buffer | null;
    partition: number;
    offset: string;
  }): Promise<void> {
    let value: unknown;
    let event: OrderPaid | undefined;
    let retryCount = 0;
    try {
      if (!input.value || input.value.length > 32768) throw new Error();
      value = JSON.parse(input.value.toString("utf8"));
      if (input.topic === this.config.retryTopic) {
        const retry = retrySchema.parse(value);
        if (
          retry.originalTopic !== this.config.orderTopic ||
          retry.retryCount > this.config.maxRetries
        )
          throw new Error();
        event = retry.event;
        retryCount = retry.retryCount;
      } else if (input.topic === this.config.orderTopic) event = orderPaidSchema.parse(value);
      else throw new Error();
      if (input.key?.toString("utf8") !== event.aggregateId) throw new Error();
    } catch {
      // Never copy an unvalidated raw message into a DLQ: it may contain secrets.
      await this.route(this.config.dlqTopic, event, retryCount, "INVALID_EVENT", input);
      console.warn({
        operation: "order-event",
        outcome: "dlq",
        failureCategory: "INVALID_EVENT",
        topic: input.topic,
        partition: input.partition,
        offset: input.offset,
        consumerGroup: this.config.consumerGroup,
      });
      return;
    }
    let outcome: string;
    try {
      outcome = await this.repository.process(event);
    } catch (error) {
      if (error instanceof TransientProcessingError && retryCount < this.config.maxRetries) {
        await this.producer.send({
          topic: this.config.retryTopic,
          acks: -1,
          timeout: 2000,
          messages: [
            {
              key: event.aggregateId,
              value: JSON.stringify({
                event,
                retryCount: retryCount + 1,
                originalTopic: this.config.orderTopic,
                failureCategory: "TRANSIENT_STORAGE",
              }),
            },
          ],
        });
        outcome = "retry";
      } else {
        await this.route(
          this.config.dlqTopic,
          event,
          retryCount,
          error instanceof TransientProcessingError ? "RETRIES_EXHAUSTED" : "PROCESSING_REJECTED",
          input,
        );
        outcome = "dlq";
      }
    }
    console.info({
      operation: "order-event",
      outcome,
      eventId: event.eventId,
      eventType: event.eventType,
      orderId: event.aggregateId,
      topic: input.topic,
      partition: input.partition,
      offset: input.offset,
      consumerGroup: this.config.consumerGroup,
      retryCount,
    });
  }
  private async route(
    topic: string,
    event: OrderPaid | undefined,
    retryCount: number,
    failureCategory: string,
    input: { topic: string; value: Buffer | null },
  ): Promise<void> {
    await this.producer.send({
      topic,
      acks: -1,
      timeout: 2000,
      messages: [
        {
          key: event?.aggregateId ?? "invalid",
          value: JSON.stringify({
            originalEvent: event ?? null,
            eventId: event?.eventId ?? null,
            originalTopic: this.config.orderTopic,
            sourceTopic: input.topic,
            retryCount,
            failureCategory,
            failedAt: new Date().toISOString(),
            ...(event
              ? {}
              : {
                  messageSha256: createHash("sha256")
                    .update(input.value ?? "")
                    .digest("hex"),
                }),
          }),
        },
      ],
    });
  }
}

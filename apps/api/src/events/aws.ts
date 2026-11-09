import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import type { Message } from "@aws-sdk/client-sqs";
import { orderPaidSchema } from "./order-paid.js";
import type { EventPublisher, OrderPaid } from "./order-paid.js";
import type { OrderNotificationRepository } from "./order-notification.repository.js";

export class SnsEventPublisher implements EventPublisher {
  readonly failureCategory = "SNS_UNAVAILABLE" as const;
  constructor(
    private readonly client: Pick<SNSClient, "send">,
    private readonly topicArn: string,
  ) {}
  async publish(input: OrderPaid): Promise<void> {
    const event = orderPaidSchema.parse(input);
    await this.client.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Message: JSON.stringify(event),
        MessageAttributes: Object.fromEntries(
          ["eventId", "eventType", "aggregateId"].map((key) => [
            key,
            {
              DataType: "String",
              StringValue: event[key as "eventId" | "eventType" | "aggregateId"],
            },
          ]),
        ),
      }),
    );
  }
}

// Never acknowledge before the database transaction (including event-ID deduplication) commits.
export async function processSqsMessage(
  client: Pick<SQSClient, "send">,
  queueUrl: string,
  message: Message,
  repository: OrderNotificationRepository,
): Promise<void> {
  try {
    if (!message.Body || Buffer.byteLength(message.Body) > 32768 || !message.ReceiptHandle)
      throw new Error("Invalid event envelope");
    const event = orderPaidSchema.parse(JSON.parse(message.Body));
    for (const key of ["eventId", "eventType", "aggregateId"] as const) {
      if (message.MessageAttributes?.[key]?.StringValue !== event[key])
        throw new Error("Event envelope mismatch");
    }
    const outcome = await repository.process(event);
    await client.send(
      new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }),
    );
    console.info({
      operation: "sqs-order-event",
      eventId: event.eventId,
      orderId: event.aggregateId,
      outcome,
    });
  } catch {
    // No deletion: visibility expiry enables retry; queue policy bounds poison retries through DLQ.
    console.warn({ operation: "sqs-order-event", outcome: "retry-or-dlq" });
  }
}

export async function startSqsConsumer(
  client: SQSClient,
  queueUrl: string,
  repository: OrderNotificationRepository,
  onCrash: () => void,
) {
  const attributes = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ["RedrivePolicy", "VisibilityTimeout"],
    }),
  );
  const policy = JSON.parse(attributes.Attributes?.RedrivePolicy ?? "{}");
  if (
    !policy.deadLetterTargetArn ||
    Number(policy.maxReceiveCount) !== 5 ||
    Number(attributes.Attributes?.VisibilityTimeout) < 60
  )
    throw new Error("SQS queue requires bounded retries and visibility >=60 seconds");
  const controller = new AbortController();
  let stopping = false;
  const running = (async () => {
    while (!stopping) {
      const result = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          WaitTimeSeconds: 20,
          MaxNumberOfMessages: 1,
          MessageAttributeNames: ["All"],
        }),
        { abortSignal: controller.signal },
      );
      for (const message of result.Messages ?? [])
        await processSqsMessage(client, queueUrl, message, repository);
    }
  })().catch(() => {
    if (!stopping) onCrash();
  });
  return {
    async close() {
      stopping = true;
      controller.abort();
      await running;
      client.destroy();
    },
  };
}

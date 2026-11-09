import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { SQSClient, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { SnsEventPublisher, processSqsMessage } from "../src/events/aws.js";
import type { OrderNotificationRepository } from "../src/events/order-notification.repository.js";
const event = () => ({
  eventId: randomUUID(),
  eventType: "OrderPaid" as const,
  eventVersion: 1 as const,
  occurredAt: new Date().toISOString(),
  aggregateType: "Order" as const,
  aggregateId: randomUUID(),
  payload: { paymentId: randomUUID() },
});
test("SNS preserves OrderPaid JSON and envelope attributes", async () => {
  const value = event();
  const client = new SNSClient({ region: "ap-south-1" });
  const send = test.mock.method(client, "send", async (command: PublishCommand) => {
    assert.equal(command.input.TopicArn, "topic");
    assert.deepEqual(JSON.parse(command.input.Message!), value);
    assert.equal(command.input.MessageAttributes?.eventId?.StringValue, value.eventId);
    assert.equal(command.input.MessageAttributes?.aggregateId?.StringValue, value.aggregateId);
    return { MessageId: "message" };
  });
  await new SnsEventPublisher(client, "topic").publish(value);
  assert.equal(send.mock.callCount(), 1);
  client.destroy();
});
test("SQS deletes after durable processing, tolerates duplicates and retains failed/poison messages", async () => {
  const value = event();
  const message = {
    Body: JSON.stringify(value),
    ReceiptHandle: "receipt",
    MessageAttributes: Object.fromEntries(
      ["eventId", "eventType", "aggregateId"].map((key) => [
        key,
        { DataType: "String", StringValue: value[key as "eventId" | "eventType" | "aggregateId"] },
      ]),
    ),
  };
  const client = new SQSClient({ region: "ap-south-1" });
  let committed = false;
  const sent = test.mock.method(client, "send", async (command: DeleteMessageCommand) => {
    assert.equal(committed, true);
    assert.equal(command.input.ReceiptHandle, "receipt");
    return {};
  });
  const seen = new Set<string>();
  const repository = {
    process: async (input: typeof value) => {
      committed = true;
      if (seen.has(input.eventId)) return "duplicate";
      seen.add(input.eventId);
      return "processed";
    },
  } as OrderNotificationRepository;
  await processSqsMessage(client, "queue", message, repository);
  await processSqsMessage(client, "queue", message, repository);
  assert.equal(seen.size, 1);
  assert.equal(sent.mock.callCount(), 2);
  committed = false;
  await processSqsMessage(client, "queue", message, {
    process: async () => {
      throw new Error("DB unavailable");
    },
  } as OrderNotificationRepository);
  await processSqsMessage(client, "queue", { ...message, Body: "poison" }, repository);
  await processSqsMessage(client, "queue", { ...message, MessageAttributes: {} }, repository);
  assert.equal(sent.mock.callCount(), 2);
  client.destroy();
});

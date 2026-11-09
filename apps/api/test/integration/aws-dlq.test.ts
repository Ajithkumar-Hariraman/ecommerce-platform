import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } from "@aws-sdk/client-sqs";
import type { Message } from "@aws-sdk/client-sqs";
import { processSqsMessage } from "../../src/events/aws.js";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { PostgresOrderNotificationRepository } from "../../src/events/order-notification.repository.js";

test("live AWS: poison retries reach DLQ; message-specific repaired replay recovers", { skip: process.env.AWS_DLQ_INTEGRATION !== "true", timeout: 150000 }, async () => {
  const client = new SQSClient({ region: "ap-south-1" });
  const source = "https://sqs.ap-south-1.amazonaws.com/201943655840/ecommerce-dev-order-notifications";
  const dead = "https://sqs.ap-south-1.amazonaws.com/201943655840/ecommerce-dev-order-notification-dlq";
  const event = { eventId: randomUUID(), eventType: "OrderPaid", eventVersion: 1, occurredAt: new Date().toISOString(), aggregateType: "Order", aggregateId: randomUUID(), payload: { paymentId: randomUUID() } };
  const attributes = Object.fromEntries(["eventId", "eventType", "aggregateId"].map(key => [key, { DataType: "String", StringValue: event[key as "eventId" | "eventType" | "aggregateId"] }]));
  const pool = createPool(loadDatabaseConfig("test"));
  async function receive(queue: string): Promise<Message | undefined> {
    const response = await client.send(new ReceiveMessageCommand({ QueueUrl: queue, WaitTimeSeconds: 1, MaxNumberOfMessages: 10, MessageAttributeNames: ["All"], MessageSystemAttributeNames: ["ApproximateReceiveCount"] }));
    let owned: Message | undefined;
    for (const message of response.Messages ?? []) {
      if (message.MessageAttributes?.eventId?.StringValue === event.eventId && !owned) owned = message;
      else await client.send(new ChangeMessageVisibilityCommand({ QueueUrl: queue, ReceiptHandle: message.ReceiptHandle, VisibilityTimeout: 0 }));
    }
    return owned;
  }
  let dlqMessage: Message | undefined;
  try {
    await client.send(new SendMessageCommand({ QueueUrl: source, MessageBody: "test-poison:" + event.eventId, MessageAttributes: attributes }));
    let attempts = 0;
    for (let i = 0; i < 50 && !dlqMessage; i++) {
      const message = await receive(source);
      if (message) {
        attempts++;
        await processSqsMessage(client, source, message, { process: async () => { throw new Error("Poison must not reach repository"); } });
        await client.send(new ChangeMessageVisibilityCommand({ QueueUrl: source, ReceiptHandle: message.ReceiptHandle, VisibilityTimeout: 0 }));
      }
      dlqMessage = await receive(dead);
    }
    assert(dlqMessage, "Poison was not forwarded to deployed DLQ");
    assert.equal(attempts, 5);
    // Repair and replay this owned message only; never queue-wide redrive unrelated messages.
    await client.send(new SendMessageCommand({ QueueUrl: source, MessageBody: JSON.stringify(event), MessageAttributes: attributes }));
    let replay: Message | undefined;
    for (let i = 0; i < 15 && !replay; i++) replay = await receive(source);
    assert(replay);
    await processSqsMessage(client, source, replay, new PostgresOrderNotificationRepository(pool));
    assert.equal(Number((await pool.query("SELECT count(*) FROM order_notifications WHERE event_id=$1", [event.eventId])).rows[0].count), 1);
    await client.send(new DeleteMessageCommand({ QueueUrl: dead, ReceiptHandle: dlqMessage.ReceiptHandle }));
    dlqMessage = undefined;
  } finally {
    if (dlqMessage) await client.send(new DeleteMessageCommand({ QueueUrl: dead, ReceiptHandle: dlqMessage.ReceiptHandle }));
    await pool.query("DELETE FROM order_notifications WHERE event_id=$1", [event.eventId]);
    await pool.end(); client.destroy();
  }
});

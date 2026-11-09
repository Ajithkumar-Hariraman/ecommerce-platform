import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SNSClient } from "@aws-sdk/client-sns";
import {
  SQSClient,
  ReceiveMessageCommand,
  ChangeMessageVisibilityCommand,
} from "@aws-sdk/client-sqs";
import { SnsEventPublisher, processSqsMessage } from "../../src/events/aws.js";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { PostgresOrderNotificationRepository } from "../../src/events/order-notification.repository.js";
import {
  PostgresOutboxRepository,
  insertPostgresOutbox,
} from "../../src/outbox/postgres-outbox.repository.js";
import { OutboxRelay } from "../../src/outbox/outbox-relay.js";
import { orderPaid } from "../../src/events/order-paid.js";

test(
  "live AWS: test DB outbox -> SNS -> deployed SQS -> durable deduplication",
  { skip: process.env.AWS_EVENTS_INTEGRATION !== "true", timeout: 90000 },
  async () => {
    const config = loadDatabaseConfig("test");
    assert.equal(config.database, "ecommerce_test");
    const admin = createPool(config);
    const schema = "test_aws_" + randomUUID().replaceAll("-", "");
    const sns = new SNSClient({ region: "ap-south-1" });
    const sqs = new SQSClient({ region: "ap-south-1" });
    const queueUrl =
      "https://sqs.ap-south-1.amazonaws.com/201943655840/ecommerce-dev-order-notifications";
    const publisher = new SnsEventPublisher(
      sns,
      "arn:aws:sns:ap-south-1:201943655840:ecommerce-dev-order-events",
    );
    const event = orderPaid({
      eventId: randomUUID(),
      orderId: randomUUID(),
      paymentId: randomUUID(),
      type: "payment.succeeded",
      occurredAt: new Date().toISOString(),
    });
    let pool: ReturnType<typeof createPool> | undefined;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.query(
        `CREATE TABLE "${schema}".outbox_events (LIKE public.outbox_events INCLUDING ALL)`,
      );
      await admin.query(
        `CREATE TABLE "${schema}".order_notifications (LIKE public.order_notifications INCLUDING ALL)`,
      );
      pool = createPool(config);
      pool.options.options = `-c search_path=${schema}`;
      const db = await pool.connect();
      try {
        await insertPostgresOutbox(db, event);
      } finally {
        db.release();
      }
      const relay = new OutboxRelay(new PostgresOutboxRepository(pool), publisher, {
        batchSize: 1,
        leaseMs: 30000,
        maxAttempts: 3,
      });
      assert.equal(await relay.runOnce(), 1);
      assert.equal(
        (await pool.query("SELECT status FROM outbox_events WHERE event_id=$1", [event.eventId]))
          .rows[0].status,
        "PUBLISHED",
      );
      await publisher.publish(event);
      const repository = new PostgresOrderNotificationRepository(pool);
      const outcomes: string[] = [];
      for (let attempt = 0; attempt < 8 && outcomes.length < 2; attempt++) {
        const response = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            WaitTimeSeconds: 5,
            MaxNumberOfMessages: 10,
            MessageAttributeNames: ["All"],
          }),
        );
        for (const message of response.Messages ?? []) {
          if (message.MessageAttributes?.eventId?.StringValue !== event.eventId) {
            await sqs.send(
              new ChangeMessageVisibilityCommand({
                QueueUrl: queueUrl,
                ReceiptHandle: message.ReceiptHandle,
                VisibilityTimeout: 0,
              }),
            );
            continue;
          }
          await processSqsMessage(sqs, queueUrl, message, {
            process: async (input) => {
              const outcome = await repository.process(input);
              outcomes.push(outcome);
              return outcome;
            },
          });
        }
      }
      assert.deepEqual(outcomes.sort(), ["duplicate", "processed"]);
      assert.equal(
        Number(
          (
            await pool.query("SELECT count(*) FROM order_notifications WHERE event_id=$1", [
              event.eventId,
            ])
          ).rows[0].count,
        ),
        1,
      );
    } finally {
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
      sns.destroy();
      sqs.destroy();
    }
  },
);

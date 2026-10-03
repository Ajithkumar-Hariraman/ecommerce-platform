import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import {
  pubSubClient,
  PubSubEventPublisher,
  startPubSubConsumer,
} from "../../src/events/pubsub.js";
import { PostgresOrderNotificationRepository } from "../../src/events/order-notification.repository.js";
import {
  PostgresOutboxRepository,
  insertPostgresOutbox,
} from "../../src/outbox/postgres-outbox.repository.js";
import { OutboxRelay } from "../../src/outbox/outbox-relay.js";
import { orderPaid } from "../../src/events/order-paid.js";

test(
  "real Pub/Sub outbox publish and duplicate delivery persist one PostgreSQL notification",
  { skip: process.env.PUBSUB_RUN_INTEGRATION !== "true", timeout: 90000 },
  async () => {
    const runId = randomUUID();
    const topicName = "test-orders-" + runId;
    const subName = "test-worker-" + runId;
    const dlqName = "test-dlq-" + runId;
    const schema = "test_pubsub_" + runId.replaceAll("-", "");
    const config = loadDatabaseConfig("test");
    assert.equal(config.database, "ecommerce_test");
    const admin = createPool(config);
    const client = pubSubClient({
      projectId: process.env.GOOGLE_CLOUD_PROJECT!,
      region: process.env.GOOGLE_CLOUD_REGION ?? "asia-south1",
    });
    let pool: ReturnType<typeof createPool> | undefined;
    let worker: Awaited<ReturnType<typeof startPubSubConsumer>> | undefined;
    let topicCreated = false,
      dlqCreated = false,
      subCreated = false;
    try {
      // Dedicated test-owned schema clones production tables; no unrelated rows can be claimed.
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.query(
        `CREATE TABLE "${schema}".outbox_events (LIKE public.outbox_events INCLUDING ALL)`,
      );
      await admin.query(
        `CREATE TABLE "${schema}".order_notifications (LIKE public.order_notifications INCLUDING ALL)`,
      );
      pool = createPool(config);
      pool.options.options = `-c search_path=${schema}`;
      console.info("Pub/Sub test: creating owned topic");
      const [topic] = await client.createTopic(topicName,{timeout:15000,retry:null});
      topicCreated = true;console.info("Pub/Sub test: topic created");
      await client.createTopic(dlqName,{timeout:15000,retry:null});
      dlqCreated = true;
      await topic.createSubscription(subName, {
        deadLetterPolicy: { deadLetterTopic: client.topic(dlqName).name, maxDeliveryAttempts: 5 },
      });
      subCreated = true;console.info("Pub/Sub test: subscription created");
      const event = orderPaid({
        eventId: randomUUID(),
        orderId: randomUUID(),
        paymentId: randomUUID(),
        type: "payment.succeeded",
        occurredAt: new Date().toISOString(),
      });
      const db = await pool.connect();
      try {
        await insertPostgresOutbox(db, event);
      } finally {
        db.release();
      }
      worker = await startPubSubConsumer(
        client,
        subName,
        new PostgresOrderNotificationRepository(pool),
        () => {},
      );
      const publisher = new PubSubEventPublisher(
        client.topic(topicName, { gaxOpts: { timeout: 5000, retry: null } }),
      );
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
      const until = async (check: () => Promise<boolean>) => {
        for (let i = 0; i < 150; i++) {
          if (await check()) return;
          await delay(100);
        }
        throw new Error("Pub/Sub durable processing timeout");
      };
      await until(
        async () =>
          Number(
            (
              await pool!.query("SELECT count(*) FROM order_notifications WHERE event_id=$1", [
                event.eventId,
              ])
            ).rows[0].count,
          ) === 1,
      );
      // Separate provider messages carrying the same application event prove persistent deduplication.
      await worker.close();
      await publisher.publish(event);
      let duplicateObserved = false;
      const repo = new PostgresOrderNotificationRepository(pool);
      worker = await startPubSubConsumer(
        client,
        subName,
        {
          async process(e) {
            const outcome = await repo.process(e);
            if (outcome === "duplicate") duplicateObserved = true;
            return outcome;
          },
        },
        () => {},
      );
      await until(async () => duplicateObserved);
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
      await worker?.close();
      if (subCreated) await client.subscription(subName).delete();
      if (topicCreated) await client.topic(topicName).delete();
      if (dlqCreated) await client.topic(dlqName).delete();
      await client.close();
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  },
);

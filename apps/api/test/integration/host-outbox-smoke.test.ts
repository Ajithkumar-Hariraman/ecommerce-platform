import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import KafkaJS from "kafkajs";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { createMongoResources } from "../../src/database/mongo.js";
import { kafkaClient, ensureOrderTopics } from "../../src/events/kafka.js";
import { pendingOutbox } from "../../src/outbox/outbox.js";
import { insertPostgresOutbox } from "../../src/outbox/postgres-outbox.repository.js";
import type { OrderPaid } from "../../src/events/order-paid.js";

const { KafkaJSDeleteGroupsError, KafkaJSProtocolError } = KafkaJS;

// Real host entrypoints, isolated Kafka topics/groups, test DB only; no payment initiation.
for (const storage of ["postgres", "mongodb"] as const)
  test(
    `host ${storage} outbox -> Kafka -> ${storage} notification`,
    { timeout: 90000 },
    async (t) => {
      const dbConfig = loadDatabaseConfig("test");
      assert.ok(process.env.MONGODB_TEST_URI, "Set MONGODB_TEST_URI for the real Mongo smoke");
      const pool = storage === "postgres" ? createPool(dbConfig) : null;
      const mongo =
        storage === "mongodb"
          ? await createMongoResources(process.env.MONGODB_TEST_URI, "ecommerce_test")
          : null;
      const prefix = "test-" + randomUUID();
      const c = {
        brokers: ["127.0.0.1:9093"],
        clientId: prefix,
        orderTopic: prefix + "-events",
        retryTopic: prefix + "-retry",
        dlqTopic: prefix + "-dlq",
        consumerGroup: prefix + "-group",
        maxRetries: 3,
      };
      const kafka = kafkaClient(c);
      const admin = kafka.admin();
      await admin.connect();
      const orderId = randomUUID();
      const event: OrderPaid = {
        eventId: randomUUID(),
        eventType: "OrderPaid",
        eventVersion: 1,
        aggregateType: "Order",
        aggregateId: orderId,
        occurredAt: new Date().toISOString(),
        payload: { paymentId: randomUUID() },
      };
      const common = {
        ...process.env,
        NODE_ENV: "test",
        BUSINESS_STORAGE: storage,
        ORDER_STORAGE: storage,
        MONGODB_URI: storage === "mongodb" ? process.env.MONGODB_TEST_URI : "not-a-mongo-uri",
        MONGODB_DB_NAME: "ecommerce_test",
        DB_PASSWORD: storage === "postgres" ? dbConfig.password : "",
        DB_TEST_NAME: "ecommerce_test",
        KAFKA_BROKERS: c.brokers.join(","),
        KAFKA_ORDER_TOPIC: c.orderTopic,
        KAFKA_ORDER_RETRY_TOPIC: c.retryTopic,
        KAFKA_ORDER_DLQ_TOPIC: c.dlqTopic,
        KAFKA_ORDER_CONSUMER_GROUP: c.consumerGroup,
        OUTBOX_POLL_INTERVAL_MS: "100",
      };
      const children: {
        child: ReturnType<typeof spawn>;
        exited: Promise<unknown[]>;
        output: () => string;
      }[] = [];
      async function until(check: () => Promise<boolean>, label: string) {
        const deadline = Date.now() + 30000;
        while (!(await check())) {
          if (Date.now() > deadline || children.some((p) => p.child.exitCode !== null))
            throw new Error("Smoke failed: " + label);
          await delay(50);
        }
      }
      async function stop() {
        for (const p of children) {
          if (p.child.exitCode === null) p.child.kill("SIGTERM");
          await p.exited;
        }
      }
      async function count() {
        return mongo
          ? await mongo.db
              .collection<{ _id: string }>("order_notifications")
              .countDocuments({ _id: event.eventId })
          : Number(
              (
                await pool!.query("SELECT count(*) FROM order_notifications WHERE event_id=$1", [
                  event.eventId,
                ])
              ).rows[0].count,
            );
      }
      t.after(async () => {
        await stop();
        if (mongo) {
          await mongo.db.collection<{ _id: string }>("orders").deleteOne({ _id: orderId });
          await mongo.db
            .collection<{ _id: string }>("order_notifications")
            .deleteOne({ _id: event.eventId });
        }
        if (pool) {
          await pool.query("DELETE FROM outbox_events WHERE event_id=$1", [event.eventId]);
          await pool.query("DELETE FROM order_notifications WHERE event_id=$1", [event.eventId]);
        }
        try {
          try {
            await admin.deleteGroups([c.consumerGroup]);
          } catch (error) {
            // A failure before the first join can leave no group to delete.
            if (
              !(error instanceof KafkaJSDeleteGroupsError) ||
              error.groups.length !== 1 ||
              error.groups[0]?.groupId !== c.consumerGroup ||
              error.groups[0]?.error?.type !== "GROUP_ID_NOT_FOUND"
            ) {
              throw error;
            }
          }
          await admin.deleteTopics({
            topics: [c.orderTopic, c.retryTopic, c.dlqTopic],
          });
        } finally {
          await Promise.all([admin.disconnect(), mongo?.client.close(), pool?.end()]);
        }
      });
      const pending = mongo
        ? await mongo.db.collection("orders").countDocuments({
            "outbox.status": { $in: ["PENDING", "PROCESSING"] },
          })
        : Number(
            (
              await pool!.query(
                "SELECT count(*) FROM outbox_events WHERE status IN ('PENDING','PROCESSING')",
              )
            ).rows[0].count,
          );
      assert.equal(pending, 0, "Unrelated pending test outbox records; refuse to consume");
      await ensureOrderTopics(kafka, c);
      // A fresh broker can serve topic metadata before its group coordinator is ready.
      await until(async () => {
        try {
          await admin.describeGroups([c.consumerGroup]);
          return true;
        } catch (error) {
          const cause = error instanceof Error ? (error.cause ?? error) : error;
          if (
            cause instanceof KafkaJSProtocolError &&
            (cause.type === "GROUP_COORDINATOR_NOT_AVAILABLE" ||
              cause.type === "GROUP_LOAD_IN_PROGRESS" ||
              cause.type === "NOT_COORDINATOR_FOR_GROUP")
          ) {
            return false;
          }
          throw error;
        }
      }, "Kafka group coordinator readiness");
      for (const file of ["order-event.worker.ts", "outbox-relay.worker.ts"]) {
        const child = spawn(process.execPath, ["--import", "tsx", "src/workers/" + file], {
          env: common,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout!.on("data", (d) => (output += d));
        child.stderr!.on("data", (d) => (output += d));
        children.push({
          child,
          exited: once(child, "exit"),
          output: () => output,
        });
      }
      await until(
        async () =>
          children[0]!.output().includes("Order worker started") &&
          children[1]!.output().includes("Outbox relay started"),
        "worker startup",
      );
      if (mongo)
        await mongo.db.collection<{ _id: string }>("orders").insertOne({
          _id: orderId,
          outbox: pendingOutbox(event, new Date()),
        });
      else {
        const client = await pool!.connect();
        try {
          await insertPostgresOutbox(client, event);
        } finally {
          client.release();
        }
      }
      await until(async () => (await count()) === 1, "durable notification");
      await until(
        async () =>
          mongo
            ? (await mongo.db.collection<{ _id: string }>("orders").findOne({ _id: orderId }))
                ?.outbox.status === "PUBLISHED"
            : (
                await pool!.query("SELECT status FROM outbox_events WHERE event_id=$1", [
                  event.eventId,
                ])
              ).rows[0]?.status === "PUBLISHED",
        "published acknowledgement",
      );
      assert.equal(await count(), 1);
      await stop();
      for (const p of children) {
        assert.equal(p.child.exitCode, 0);
        assert.ok(
          !p.output().includes("TimeoutNegativeWarning"),
          "worker must not schedule negative timers",
        );
      }
      console.info(
        `Non-payment smoke: ${storage} -> separate relay -> Kafka -> separate consumer -> ${storage} PASS`,
      );
    },
  );

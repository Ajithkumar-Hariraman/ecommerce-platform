import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { createMongoResources } from "../../src/database/mongo.js";
import {
  kafkaClient,
  kafkaProducer,
  ensureOrderTopics,
  KafkaEventPublisher,
} from "../../src/events/kafka.js";
import { startOrderConsumer } from "../../src/events/order-consumer.js";
import { PostgresOrderNotificationRepository } from "../../src/events/order-notification.repository.js";
import { PostgresOutboxRepository } from "../../src/outbox/postgres-outbox.repository.js";
import { MongoOutboxRepository } from "../../src/outbox/mongo-outbox.repository.js";
import { OutboxRelay } from "../../src/outbox/outbox-relay.js";
import { startProvider } from "../helpers/payment-provider.js";
async function wait(check: () => Promise<boolean>, label: string) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > 20000) throw new Error("Timeout: " + label);
    await delay(30);
  }
}
async function freePort() {
  const s = createServer().listen(0, "127.0.0.1");
  await once(s, "listening");
  const a = s.address();
  assert.ok(a && typeof a !== "string");
  await new Promise<void>((r) => s.close(() => r()));
  return a.port;
}
for (const mode of ["postgres", "mongodb"] as const) {
  test(
    `${mode} real webhook survives unreachable Kafka, relay recovers, send-before-ack crash deduplicates`,
    {
      skip: !process.env.OIDC_TEST_ISSUER || (mode === "mongodb" && !process.env.MONGODB_TEST_URI),
      timeout: 90000,
    },
    async () => {
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
      await ensureOrderTopics(kafka, c);
      const producer = kafkaProducer(kafka);
      await producer.connect();
      const admin = kafka.admin();
      await admin.connect();
      const pool = createPool(loadDatabaseConfig("test"));
      const mongo =
        mode === "mongodb"
          ? await createMongoResources(process.env.MONGODB_TEST_URI!, "ecommerce_test")
          : undefined;
      const repository = mongo
        ? new MongoOutboxRepository(mongo.db)
        : new PostgresOutboxRepository(pool);
      const notifications = new PostgresOrderNotificationRepository(pool);
      const original = notifications.process.bind(notifications);
      let duplicates = 0;
      notifications.process = async (e) => {
        const result = await original(e);
        if (result === "duplicate") duplicates++;
        return result;
      };
      const consumer = await startOrderConsumer(kafka, producer, c, notifications);
      const port = await freePort();
      const unavailable = await freePort();
      const base = `http://127.0.0.1:${port}`;
      const secret = randomUUID() + randomUUID();
      const provider = await startProvider(base + "/api/v1/webhooks/payments", secret);
      const common = {
        ...process.env,
        NODE_ENV: "test",
        AUTH_ENABLED: "true",
        OIDC_ISSUER: process.env.OIDC_TEST_ISSUER!,
        OIDC_AUDIENCE: "ecommerce-api",
        HOST: "127.0.0.1",
        PORT: String(port),
        ORDER_STORAGE: mode,
        BUSINESS_STORAGE: mode,
        PAYMENT_PROVIDER: "local",
        MONGODB_URI: process.env.MONGODB_TEST_URI ?? "",
        MONGODB_DB_NAME: "ecommerce_test",
        PAYMENT_PROVIDER_BASE_URL: provider.baseUrl,
        PAYMENT_WEBHOOK_SECRET: secret,
        KAFKA_ORDER_TOPIC: c.orderTopic,
        KAFKA_ORDER_RETRY_TOPIC: c.retryTopic,
        KAFKA_ORDER_DLQ_TOPIC: c.dlqTopic,
        KAFKA_ORDER_CONSUMER_GROUP: c.consumerGroup,
        OUTBOX_POLL_INTERVAL_MS: "100",
      };
      const launch = (path: string, brokers: string) => {
        const child = spawn(process.execPath, [path], {
          env: { ...common, KAFKA_BROKERS: brokers },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout!.on("data", (d) => (output += d));
        child.stderr!.on("data", () => {});
        return { child, exited: once(child, "exit"), output: () => output };
      };
      const children: ReturnType<typeof launch>[] = [];
      let productId: string | undefined;
      let orderId: string | undefined;
      let eventId: string | undefined;
      const inspectMongo = (expected: string) => {
        if (mode !== "mongodb" || process.env.OUTBOX_VERIFY_MONGOSH !== "1") return;
        const containerUri = new URL(process.env.MONGODB_TEST_URI!);
        containerUri.hostname = "127.0.0.1";
        containerUri.port = "27017";
        const script = `const observedDb=connect(${JSON.stringify(containerUri.toString())}).getSiblingDB("ecommerce_test"); printjson(observedDb.orders.findOne({_id:${JSON.stringify(orderId)}},{status:1,"outbox.status":1,"outbox.event.eventId":1}));`;
        const output = execFileSync(
          "docker",
          [
            "exec",
            "-i",
            "ecommerce-mongodb",
            "mongosh",
            "--quiet",
            "--norc",
            "--file",
            "/dev/stdin",
          ],
          { input: script + "\n", encoding: "utf8" },
        );
        assert.ok(output.includes(expected));
        assert.ok(output.includes(eventId!));
        console.info("mongosh observed owned Order PAID with outbox " + expected);
      };
      const state = async () =>
        mongo
          ? (
              await mongo.db
                .collection<{ _id: string; outbox: any }>("orders")
                .findOne({ _id: orderId! })
            )?.outbox
          : (
              await pool.query(
                "SELECT *, event_id AS eventid FROM outbox_events WHERE event_id=$1",
                [eventId],
              )
            ).rows[0];
      try {
        const pending = mongo
          ? await mongo.db
              .collection("orders")
              .countDocuments({ "outbox.status": { $in: ["PENDING", "PROCESSING"] } })
          : Number(
              (
                await pool.query(
                  "SELECT count(*) FROM outbox_events WHERE status IN ('PENDING','PROCESSING')",
                )
              ).rows[0].count,
            );
        assert.equal(pending, 0, "Unrelated pending outbox work; do not consume it");
        const api = launch("dist/server.js", `127.0.0.1:${unavailable}`);
        children.push(api);
        await wait(async () => api.output().includes("API listening"), "API without Kafka");
        const tokenRes = await fetch(common.OIDC_ISSUER + "/protocol/openid-connect/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: "ecommerce-cli-manager",
            client_secret: process.env.ECOMMERCE_MANAGER_CLIENT_SECRET!,
          }),
        });
        assert.equal(tokenRes.status, 200);
        const token = (await tokenRes.json()).access_token;
        const productResponse = await fetch(base + "/api/v1/products", {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({
            sku: "EVENT-" + randomUUID(),
            name: "Owned event fixture",
            priceInMinorUnits: 100,
            stock: 5,
          }),
        });
        assert.equal(productResponse.status, 201);
        productId = (await productResponse.json()).id;
        const created = await fetch(base + "/api/v1/orders", {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [{ productId, quantity: 1, unitPriceInMinorUnits: 999 }],
          }),
        });
        assert.equal(created.status, 201);
        const order = await created.json();
        orderId = order.id;
        assert.equal(order.status, "PAYMENT_PENDING");
        const delivered = await fetch(provider.baseUrl + `/payments/${order.paymentId}/succeed`, {
          method: "POST",
        });
        assert.equal(delivered.status, 200);
        eventId = (await delivered.json()).eventId;
        assert.equal((await state()).status, "PENDING");
        assert.equal((await state()).attempts, 0);
        inspectMongo("PENDING");
        assert.equal(
          (
            await fetch(base + `/api/v1/orders/${orderId}`, {
              headers: { Authorization: "Bearer " + token },
            }).then((r) => r.json())
          ).status,
          "PAID",
        );
        assert.equal(
          (
            await pool.query("SELECT count(*) FROM order_notifications WHERE event_id=$1", [
              eventId,
            ])
          ).rows[0].count,
          "0",
        );
        // Real unreachable TCP endpoint; no fake client and no disruption to other broker users.
        const down = kafkaProducer(kafkaClient({ ...c, brokers: [`127.0.0.1:${unavailable}`] }));
        try {
          await assert.rejects(down.connect());
          await new OutboxRelay(repository, new KafkaEventPublisher(down, c.orderTopic), {
            batchSize: 1,
            leaseMs: 30000,
            maxAttempts: 10,
          }).runOnce();
        } finally {
          await down.disconnect();
        }
        assert.equal((await state()).status, "PENDING");
        assert.equal((await state()).attempts, 1);
        await delay(1100);
        // Publish successfully, then intentionally omit markPublished: relay crash boundary.
        const claimed = (
          await repository.claimBatch({ batchSize: 1, leaseMs: 100, maxAttempts: 10 })
        )[0]!;
        assert.equal(claimed.event.eventId, eventId);
        await new KafkaEventPublisher(producer, c.orderTopic).publish(claimed.event);
        await wait(
          async () =>
            (
              await pool.query("SELECT count(*) FROM order_notifications WHERE event_id=$1", [
                eventId,
              ])
            ).rows[0].count === "1",
          "first delivery",
        );
        await delay(150);
        const relay = launch("dist/workers/outbox-relay.worker.js", "127.0.0.1:9093");
        children.push(relay);
        await wait(
          async () => (await state()).status === "PUBLISHED" && duplicates >= 1,
          "lease recovery and duplicate suppression",
        );
        assert.equal(await repository.markPublished(claimed), false);
        assert.equal((await state()).attempts, 3);
        inspectMongo("PUBLISHED");
        assert.equal(
          (
            await pool.query("SELECT count(*) FROM order_notifications WHERE event_id=$1", [
              eventId,
            ])
          ).rows[0].count,
          "1",
        );
        assert.equal(
          (
            await fetch(provider.baseUrl + `/payments/${order.paymentId}/succeed`, {
              method: "POST",
            })
          ).status,
          200,
        );
        assert.equal((await state()).status, "PUBLISHED");
        assert.equal(
          (
            await fetch(base + `/api/v1/orders/${orderId}`, {
              headers: { Authorization: "Bearer " + token },
            }).then((r) => r.json())
          ).version,
          3,
        );
        for (const p of children) {
          p.child.kill("SIGTERM");
          assert.equal((await p.exited)[0], 0);
        }
        assert.match(relay.output(), /Outbox relay resources closed/);
        console.info(
          `${mode}: real token + webhook200 with Kafka unreachable -> PAID/PENDING inspected -> durable retry -> real Kafka send/crash -> separate relay recovery -> PUBLISHED -> one notification PASS`,
        );
      } finally {
        for (const p of children)
          if (p.child.exitCode === null) {
            p.child.kill("SIGKILL");
            await p.exited;
          }
        await consumer.close();
        await provider.cleanup();
        if (eventId) {
          await pool.query("DELETE FROM outbox_events WHERE event_id=$1", [eventId]);
          await pool.query("DELETE FROM order_notifications WHERE event_id=$1", [eventId]);
          await pool.query("DELETE FROM processed_webhook_events WHERE event_id=$1", [eventId]);
        }
        if (orderId) {
          await pool.query("DELETE FROM orders WHERE id=$1", [orderId]);
          if (mongo) {
            await mongo.db.collection<{ _id: string }>("orders").deleteOne({ _id: orderId });
            await mongo.db.collection("order_status_history").deleteMany({ orderId });
            await mongo.db
              .collection<{ _id: string }>("processed_webhook_events")
              .deleteOne({ _id: eventId! });
          }
        }
        if (productId) {
          if (mongo)
            await mongo.db.collection<{ _id: string }>("products").deleteOne({ _id: productId });
          else await pool.query("DELETE FROM products WHERE id=$1", [productId]);
        }
        await producer.disconnect();
        await admin.deleteGroups([c.consumerGroup]);
        await admin.deleteTopics({ topics: [c.orderTopic, c.retryTopic, c.dlqTopic] });
        await admin.disconnect();
        await pool.end();
        await mongo?.client.close();
      }
    },
  );
}

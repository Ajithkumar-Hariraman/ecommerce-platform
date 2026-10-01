import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { Pool } from "pg";
import { loadDatabaseConfig } from "../../src/config/env.js";
import type { KafkaConfig } from "../../src/config/env.js";
import { kafkaClient, kafkaProducer, ensureOrderTopics, KafkaEventPublisher } from "../../src/events/kafka.js";
import { startOrderConsumer } from "../../src/events/order-consumer.js";
import { PostgresOrderNotificationRepository } from "../../src/events/order-notification.repository.js";
import { orderPaid } from "../../src/events/order-paid.js";
import { startProvider } from "../helpers/payment-provider.js";

const config = (): KafkaConfig => {
  const prefix = "test-" + randomUUID();
  return {brokers: ["127.0.0.1:9093"], clientId: prefix, orderTopic: prefix + "-events", retryTopic: prefix + "-retry", dlqTopic: prefix + "-dlq", consumerGroup: prefix + "-worker", maxRetries: 3};
};
async function until(check: () => Promise<boolean>, label: string, ms = 15000) {
  const start = Date.now(); while (!await check()) {if (Date.now() - start > ms) throw new Error("Timed out: " + label); await delay(30);}
}
async function fixture() {
  const c = config(); const kafka = kafkaClient(c); await ensureOrderTopics(kafka, c);
  const producer = kafkaProducer(kafka); await producer.connect(); const admin = kafka.admin(); await admin.connect();
  const observer = kafka.consumer({groupId: c.consumerGroup + "-observer"}); const messages: {topic: string; value: any; offset: string; partition: number}[] = [];
  await observer.connect(); await observer.subscribe({topics: [c.orderTopic, c.retryTopic, c.dlqTopic], fromBeginning: true});
  await observer.run({eachMessage: async ({topic, partition, message}) => {messages.push({topic, partition, offset: message.offset, value: JSON.parse(message.value!.toString())});}});
  return {c, kafka, producer, admin, messages, async close() {
    await observer.disconnect(); await producer.disconnect();
    await admin.deleteGroups([c.consumerGroup, c.consumerGroup + "-observer"]).catch(() => {});
    await admin.deleteTopics({topics: [c.orderTopic, c.retryTopic, c.dlqTopic]}); await admin.disconnect();
  }};
}

test("real Kafka partitions, durable dedupe, transient DB retry, DLQ and committed offsets", {timeout: 60000}, async () => {
  const f = await fixture(); const pool = new Pool({...loadDatabaseConfig("test"), statement_timeout: 500, lock_timeout: 150});
  const repository = new PostgresOrderNotificationRepository(pool);
  const worker = await startOrderConsumer(f.kafka, f.producer, f.c, repository);
  const publisher = new KafkaEventPublisher(f.producer, f.c.orderTopic); const ids: string[] = [];
  const make = () => {const e = orderPaid({eventId: randomUUID(), orderId: randomUUID(), paymentId: randomUUID(), type: "payment.succeeded", occurredAt: new Date().toISOString()}); ids.push(e.eventId); return e;};
  const count = async (id: string) => Number((await pool.query("SELECT count(*) FROM order_notifications WHERE event_id=$1", [id])).rows[0].count);
  const lock = await pool.connect();
  try {
    const metadata = await f.admin.fetchTopicMetadata({topics: [f.c.orderTopic, f.c.retryTopic, f.c.dlqTopic]}); assert.ok(metadata.topics.every(t => t.partitions.length === 3));
    const duplicate = make(); await publisher.publish(duplicate); await publisher.publish(duplicate);
    await until(async () => await count(duplicate.eventId) === 1 && f.messages.filter(m => m.value.eventId === duplicate.eventId).length === 2, "duplicate consumed");
    const copies = f.messages.filter(m => m.value.eventId === duplicate.eventId); assert.equal(copies[0]!.partition, copies[1]!.partition);
    await until(async () => {const offsets = await f.admin.fetchOffsets({groupId: f.c.consumerGroup, topics: [f.c.orderTopic]}); const offset = offsets[0]?.partitions.find(p => p.partition === copies[1]!.partition)?.offset; return offset !== undefined && BigInt(offset) > BigInt(copies[1]!.offset);}, "offset after durable effect");
    const recovery = make(); await lock.query("BEGIN");
    await lock.query("INSERT INTO order_notifications(event_id,order_id,payment_id,occurred_at) VALUES($1,$2,$3,$4)", [recovery.eventId, recovery.aggregateId, recovery.payload.paymentId, recovery.occurredAt]);
    await publisher.publish(recovery);
    await until(async () => f.messages.some(m => m.topic === f.c.retryTopic && m.value.event.eventId === recovery.eventId), "retry topic");
    await lock.query("ROLLBACK"); await until(async () => await count(recovery.eventId) === 1, "retry recovery");
    const exhausted = make(); await lock.query("BEGIN");
    await lock.query("INSERT INTO order_notifications(event_id,order_id,payment_id,occurred_at) VALUES($1,$2,$3,$4)", [exhausted.eventId, exhausted.aggregateId, exhausted.payload.paymentId, exhausted.occurredAt]);
    await publisher.publish(exhausted);
    await until(async () => f.messages.some(m => m.topic === f.c.dlqTopic && m.value.eventId === exhausted.eventId), "DLQ exhaustion");
    const dead = f.messages.find(m => m.topic === f.c.dlqTopic && m.value.eventId === exhausted.eventId)!.value;
    assert.equal(dead.retryCount, 3); assert.equal(dead.failureCategory, "RETRIES_EXHAUSTED");
    await lock.query("ROLLBACK"); assert.equal(await count(exhausted.eventId), 0);
    const invalid = make(); await f.producer.send({topic: f.c.orderTopic, messages: [{key: invalid.aggregateId, value: JSON.stringify({...invalid, eventVersion: 2, secret: "do-not-copy"})}]});
    await until(async () => f.messages.some(m => m.topic === f.c.dlqTopic && m.value.failureCategory === "INVALID_EVENT"), "invalid DLQ");
    assert.ok(!JSON.stringify(f.messages.filter(m => m.topic === f.c.dlqTopic)).includes("do-not-copy"));
    console.info("Real Kafka: 3 partitions; duplicate one record; same-order partition; committed offset; DB-lock retry recovery; 3 retries then DLQ PASS");
  } finally {
    await lock.query("ROLLBACK"); lock.release(); await worker.close();
    await pool.query("DELETE FROM order_notifications WHERE event_id=ANY($1::uuid[])", [ids]); await pool.end(); await f.close();
  }
});

test("real Keycloak Order payment publishes to separate Kafka worker", {skip: !process.env.OIDC_TEST_ISSUER, timeout: 60000}, async () => {
  const f = await fixture(); const pool = new Pool(loadDatabaseConfig("test"));
  const probe = createServer().listen(0, "127.0.0.1"); await once(probe, "listening"); const address = probe.address(); assert.ok(address && typeof address !== "string"); await new Promise<void>(resolve => probe.close(() => resolve()));
  const base = `http://127.0.0.1:${address.port}`; const secret = randomUUID() + randomUUID();
  const provider = await startProvider(base + "/api/v1/webhooks/payments", secret);
  const env = {...process.env, NODE_ENV: "test", AUTH_ENABLED: "true", OIDC_ISSUER: process.env.OIDC_TEST_ISSUER!, OIDC_AUDIENCE: "ecommerce-api", HOST: "127.0.0.1", PORT: String(address.port), ORDER_STORAGE: "postgres", PAYMENT_PROVIDER_BASE_URL: provider.baseUrl, PAYMENT_WEBHOOK_SECRET: secret,
    KAFKA_ORDER_TOPIC: f.c.orderTopic, KAFKA_ORDER_RETRY_TOPIC: f.c.retryTopic, KAFKA_ORDER_DLQ_TOPIC: f.c.dlqTopic, KAFKA_ORDER_CONSUMER_GROUP: f.c.consumerGroup};
  const children = ["dist/server.js", "dist/workers/order-event.worker.js", "dist/workers/outbox-relay.worker.js"].map(path => {
    const child = spawn(process.execPath, [path], {env, stdio: ["ignore", "pipe", "pipe"]}); let output = "";
    child.stdout!.on("data", d => output += d); child.stderr!.on("data", () => {});
    return {child, exited: once(child, "exit"), output: () => output};
  });
  let orderId: string | undefined; let eventId: string | undefined;
  try {
    await until(async () => children[0]!.output().includes("API listening") && children[1]!.output().includes("Order worker started") && children[2]!.output().includes("Outbox relay started"), "API and worker startup");
    const tokenResponse = await fetch(env.OIDC_ISSUER + "/protocol/openid-connect/token", {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}, body: new URLSearchParams({grant_type: "client_credentials", client_id: "ecommerce-cli-manager", client_secret: process.env.ECOMMERCE_MANAGER_CLIENT_SECRET!})});
    assert.equal(tokenResponse.status, 200); const token = (await tokenResponse.json()).access_token;
    const created = await fetch(base + "/api/v1/orders", {method: "POST", headers: {Authorization: "Bearer " + token, "Content-Type": "application/json"}, body: JSON.stringify({customerId: randomUUID(), items: [{productId: randomUUID(), quantity: 1, unitPriceInMinorUnits: 100}]})});
    assert.equal(created.status, 201); const order = await created.json(); orderId = order.id; assert.equal(order.status, "PAYMENT_PENDING");
    const paid = await fetch(provider.baseUrl + `/payments/${order.paymentId}/succeed`, {method: "POST"}); assert.equal(paid.status, 200); eventId = (await paid.json()).eventId;
    await until(async () => (await pool.query("SELECT event_id FROM order_notifications WHERE event_id=$1", [eventId])).rowCount === 1, "separate worker durable effect");
    assert.equal((await fetch(base + "/api/v1/orders/" + orderId, {headers: {Authorization: "Bearer " + token}}).then(r => r.json())).status, "PAID");
    await until(async () => f.messages.some(m => m.topic === f.c.orderTopic && m.value.eventId === eventId), "OrderPaid topic traffic");
    const observed = f.messages.find(m => m.value.eventId === eventId)!; await new KafkaEventPublisher(f.producer, f.c.orderTopic).publish(observed.value);
    await until(async () => children[1]!.output().includes("duplicate"), "worker duplicate");
    assert.equal((await pool.query("SELECT count(*) FROM order_notifications WHERE event_id=$1", [eventId])).rows[0].count, "1");
    for (const c of children) {c.child.kill("SIGTERM"); assert.equal((await c.exited)[0], 0);}
    assert.match(children[2]!.output(), /Outbox relay resources closed/); assert.match(children[1]!.output(), /Order worker resources closed/);
    console.info("Real Keycloak -> Order201 pending -> provider HMAC -> PAID -> Kafka OrderPaid -> separate worker -> one durable notification; duplicate + graceful shutdown PASS");
  } finally {
    for (const c of children) if (c.child.exitCode === null) {c.child.kill("SIGKILL"); await c.exited;}
    await provider.cleanup();
    if (eventId) {await pool.query("DELETE FROM outbox_events WHERE event_id=$1", [eventId]); await pool.query("DELETE FROM order_notifications WHERE event_id=$1", [eventId]); await pool.query("DELETE FROM processed_webhook_events WHERE event_id=$1", [eventId]);}
    if (orderId) await pool.query("DELETE FROM orders WHERE id=$1", [orderId]);
    await pool.end(); await f.close();
  }
});

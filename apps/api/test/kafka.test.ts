import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { orderPaid, orderPaidSchema } from "../src/events/order-paid.js";
import { KafkaEventPublisher } from "../src/events/kafka.js";
import { OrderEventHandler } from "../src/events/order-event.handler.js";
import { TransientProcessingError } from "../src/events/order-notification.repository.js";
import { PublishingPaymentWorkflow } from "../src/modules/payments/publishing-payment.workflow.js";
import type { ProducerRecord } from "kafkajs";
import type { KafkaConfig } from "../src/config/env.js";
const config: KafkaConfig = {brokers: ["127.0.0.1:9093"], clientId: "unit", orderTopic: "events", retryTopic: "retry", dlqTopic: "dlq", consumerGroup: "unit", maxRetries: 3};
const payment = () => ({eventId: randomUUID(), orderId: randomUUID(), paymentId: randomUUID(), type: "payment.succeeded" as const, occurredAt: new Date().toISOString()});
test("versioned OrderPaid contract and Kafka order key", async () => {
  const event = orderPaid(payment()); assert.equal(orderPaidSchema.safeParse(event).success, true);
  for (const change of [{eventVersion: 2}, {eventType: "Other"}, {aggregateId: "bad"}, {occurredAt: "bad"}, {payload: {paymentId: "bad"}}, {secret: "hidden"}]) assert.equal(orderPaidSchema.safeParse({...event, ...change}).success, false);
  const sent: ProducerRecord[] = []; const producer = {async send(record: ProducerRecord) {sent.push(record); return [];}};
  await new KafkaEventPublisher(producer, "events").publish(event);
  assert.equal(sent[0]!.messages[0]!.key, event.aggregateId); assert.deepEqual(JSON.parse(String(sent[0]!.messages[0]!.value)), event);
});
test("post-commit publication preserves state on failure; duplicate and failed payment do not publish", async () => {
  let persisted = false; let count = 0; let applied = true;
  const workflow = new PublishingPaymentWorkflow({async applyEvent() {persisted = true; return applied;}}, {async publish() {assert.ok(persisted); count++; throw new Error("private");}});
  await workflow.applyEvent(payment()); assert.equal(count, 1);
  applied = false; await workflow.applyEvent(payment()); assert.equal(count, 1);
  applied = true; await workflow.applyEvent({...payment(), type: "payment.failed"}); assert.equal(count, 1);
});
test("validation, retry counts, permanent rejection and safe DLQ metadata", async t => {
  const sent: ProducerRecord[] = []; let attempts = 0; let transient = true;
  const producer = {async send(record: ProducerRecord) {sent.push(record); return [];}};
  const handler = new OrderEventHandler({async process() {attempts++; if (transient) throw new TransientProcessingError("password-secret stack"); return "processed";}}, producer, config);
  const event = orderPaid(payment());
  const deliver = (value: unknown, topic = "events", raw = false) => handler.handle({topic, key: Buffer.from(event.aggregateId), value: Buffer.from(raw ? String(value) : JSON.stringify(value)), partition: 0, offset: "0"});
  await t.test("transient failure routes incremented retry; recovery stops retries", async () => {
    await deliver(event); assert.equal(sent.at(-1)!.topic, "retry"); const retry = JSON.parse(String(sent.at(-1)!.messages[0]!.value)); assert.equal(retry.retryCount, 1);
    await deliver(retry, "retry"); assert.equal(JSON.parse(String(sent.at(-1)!.messages[0]!.value)).retryCount, 2);
    transient = false; const before = sent.length; await deliver(retry, "retry"); assert.equal(sent.length, before);
  });
  await t.test("exhausted retries route validated event to DLQ without private errors", async () => {
    transient = true; await deliver({event, retryCount: 3, originalTopic: "events", failureCategory: "TRANSIENT_STORAGE"}, "retry");
    const record = sent.at(-1)!; assert.equal(record.topic, "dlq"); const body = String(record.messages[0]!.value); assert.ok(!body.includes("password-secret")); assert.equal(JSON.parse(body).failureCategory, "RETRIES_EXHAUSTED");
  });
  await t.test("malformed JSON and unsupported version go directly to redacted DLQ", async () => {
    const before = attempts;
    for (const value of ["{secret", JSON.stringify({...event, eventVersion: 2, secret: "do-not-copy"})]) {
      await deliver(value, "events", true); const record = sent.at(-1)!; assert.equal(record.topic, "dlq");
      const body = String(record.messages[0]!.value); assert.ok(!body.includes("do-not-copy")); assert.equal(JSON.parse(body).originalEvent, null);
    }
    assert.equal(attempts, before);
  });
  await t.test("failed retry publication rejects processing rather than acknowledging", async () => {
    const failing = new OrderEventHandler({async process() {throw new TransientProcessingError();}}, {async send() {throw new Error("broker down");}}, config);
    await assert.rejects(failing.handle({topic: "events", key: Buffer.from(event.aggregateId), value: Buffer.from(JSON.stringify(event)), partition: 0, offset: "9"}));
  });
});

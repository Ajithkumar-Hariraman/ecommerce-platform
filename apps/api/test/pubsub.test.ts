import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PubSubEventPublisher, processPubSubMessage } from "../src/events/pubsub.js";
import { loadEventTransportConfig } from "../src/config/env.js";
import { orderPaid } from "../src/events/order-paid.js";
const event = () =>
  orderPaid({
    eventId: randomUUID(),
    orderId: randomUUID(),
    paymentId: randomUUID(),
    type: "payment.succeeded",
    occurredAt: new Date().toISOString(),
  });
test("Pub/Sub publisher keeps the durable event ID and safe attributes", async () => {
  const e = event();
  let sent: any;
  const publisher = new PubSubEventPublisher({
    async publishMessage(message) {
      sent = message;
      return "provider-id";
    },
  });
  await publisher.publish(e);
  assert.deepEqual(JSON.parse(sent.data.toString()), e);
  assert.equal(sent.attributes.eventId, e.eventId);
  assert.equal(sent.attributes.aggregateId, e.aggregateId);
  await assert.rejects(publisher.publish({ ...e, eventVersion: 2 as 1 }));
  const failed = new PubSubEventPublisher({
    async publishMessage() {
      throw new Error("provider failure");
    },
  });
  await assert.rejects(failed.publish(e));
  assert.equal(failed.failureCategory, "PUBSUB_UNAVAILABLE");
});
test("Pub/Sub ack follows durable processing; duplicates ack; failures nack", async (t) => {
  const e = event();
  const outcomes: string[] = [];
  let stored = 0;
  let fail = false;
  const repository = {
    async process() {
      stored++;
      if (fail) throw new Error("storage failure");
      return stored === 1 ? ("processed" as const) : ("duplicate" as const);
    },
  };
  const message = {
    data: Buffer.from(JSON.stringify(e)),
    attributes: { eventId: e.eventId, aggregateId: e.aggregateId, eventType: e.eventType },
    ack() {
      outcomes.push("ack");
    },
    nack() {
      outcomes.push("nack");
    },
  };
  await processPubSubMessage(message, repository);
  await processPubSubMessage(message, repository);
  assert.deepEqual(outcomes, ["ack", "ack"]);
  fail = true;
  await processPubSubMessage(message, repository);
  assert.equal(outcomes.at(-1), "nack");
  for (const bad of [
    Buffer.from("broken"),
    Buffer.alloc(32769),
    Buffer.from(JSON.stringify({ ...e, eventVersion: 2 })),
  ]) {
    const before = stored;
    await processPubSubMessage({ ...message, data: bad }, repository);
    assert.equal(stored, before);
    assert.equal(outcomes.at(-1), "nack");
  }
  const before = stored;
  await processPubSubMessage(
    { ...message, attributes: { ...message.attributes, eventId: randomUUID() } },
    repository,
  );
  assert.equal(stored, before);
});
test("event transport validates resources and keeps Kafka default", () => {
  const saved = { ...process.env };
  try {
    process.env.EVENT_TRANSPORT = "kafka";
    assert.equal(loadEventTransportConfig().transport, "kafka");
    process.env.EVENT_TRANSPORT = "invalid";
    assert.throws(loadEventTransportConfig);
    process.env.EVENT_TRANSPORT = "pubsub";
    process.env.GOOGLE_CLOUD_PROJECT = "ecommerce-platform-510208";
    process.env.NODE_ENV = "test";
    process.env.PUBSUB_ORDER_TOPIC = "live-topic";
    assert.throws(loadEventTransportConfig);
    process.env.PUBSUB_ORDER_TOPIC = "test-orders";
    process.env.PUBSUB_ORDER_SUBSCRIPTION = "test-worker";
    assert.equal(loadEventTransportConfig().transport, "pubsub");
  } finally {
    process.env = saved;
  }
});

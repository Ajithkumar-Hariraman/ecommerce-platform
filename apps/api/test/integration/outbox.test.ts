import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { createMongoResources } from "../../src/database/mongo.js";
import { PostgresOrderRepository } from "../../src/modules/orders/postgres-order.repository.js";
import { MongoOrderRepository } from "../../src/modules/orders/mongo-order.repository.js";
import { PostgresPaymentWorkflowRepository } from "../../src/modules/payments/postgres-payment.repositories.js";
import {
  MongoPaymentWorkflowRepository,
  ensurePaymentIndexes,
} from "../../src/modules/payments/mongo-payment.repositories.js";
import {
  PostgresOutboxRepository,
  insertPostgresOutbox,
} from "../../src/outbox/postgres-outbox.repository.js";
import { MongoOutboxRepository } from "../../src/outbox/mongo-outbox.repository.js";
import { orderPaid } from "../../src/events/order-paid.js";
import type { Order } from "../../src/modules/orders/order.types.js";
import type { OutboxRepository } from "../../src/outbox/outbox.js";
function order(): Order {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    customerId: randomUUID(),
    status: "PAYMENT_PENDING",
    paymentId: randomUUID(),
    version: 2,
    totalInMinorUnits: 100,
    items: [
      {
        productId: randomUUID(),
        quantity: 1,
        unitPriceInMinorUnits: 100,
        lineTotalInMinorUnits: 100,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}
function payment(o: Order) {
  return {
    eventId: randomUUID(),
    orderId: o.id,
    paymentId: o.paymentId!,
    type: "payment.succeeded" as const,
    occurredAt: new Date().toISOString(),
  };
}
async function claimContract(
  a: OutboxRepository,
  b: OutboxRepository,
  eventId: string,
  makeDue?: () => Promise<void>,
) {
  const options = {
    batchSize: 1,
    leaseMs: makeDue ? 300000 : 60,
    maxAttempts: 5,
  };
  const concurrent = await Promise.all([a.claimBatch(options), b.claimBatch(options)]);
  const claims = concurrent.flat();
  assert.equal(claims.length, 1);
  const old = claims[0]!;
  assert.equal(old.event.eventId, eventId);
  assert.equal(old.attempts, 1);
  if (makeDue) await makeDue();
  else await delay(100);
  const recovered = (await b.claimBatch({ ...options, leaseMs: 30000 }))[0]!;
  assert.equal(recovered.attempts, 2);
  assert.notEqual(recovered.leaseToken, old.leaseToken);
  assert.equal(await a.markPublished(old), false);
  assert.equal(await a.markFailed(old, "KAFKA_UNAVAILABLE", 0, 5), false);
  assert.equal(await b.markFailed(recovered, "KAFKA_UNAVAILABLE", makeDue ? 300000 : 120, 5), true);
  assert.deepEqual(await a.claimBatch(options), []);
  if (makeDue) await makeDue();
  else await delay(150);
  const retry = (await a.claimBatch({ ...options, leaseMs: 30000 }))[0]!;
  assert.equal(retry.event.eventId, eventId);
  assert.equal(retry.attempts, 3);
  assert.equal(await a.markPublished(retry), true);
  assert.deepEqual(await b.claimBatch(options), []);
}

test("PostgreSQL outbox atomic commit/rollback, SKIP LOCKED contention and crash leases", async (t) => {
  const pool = createPool(loadDatabaseConfig("test"));
  const orders = new PostgresOrderRepository(pool);
  const workflow = new PostgresPaymentWorkflowRepository(pool);
  const repo = new PostgresOutboxRepository(pool);
  const rows = [order(), order(), order()];
  const events = rows.map(payment);
  try {
    // Never operate on an unrelated queued event. Run DB/relay suites sequentially.
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) FROM outbox_events WHERE status IN ('PENDING','PROCESSING')",
        )
      ).rows[0].count,
      "0",
      "Test database has unrelated pending outbox work",
    );
    for (const o of rows) await orders.save(o);
    await t.test(
      "all four writes commit and duplicate webhook creates no second outbox",
      async () => {
        assert.equal(await workflow.applyEvent(events[0]!), true);
        assert.equal(await workflow.applyEvent(events[0]!), false);
        assert.equal((await orders.findById(rows[0]!.id))!.status, "PAID");
        for (const table of ["outbox_events", "processed_webhook_events"]) {
          assert.equal(
            (
              await pool.query(`SELECT count(*) FROM ${table} WHERE event_id=$1`, [
                events[0]!.eventId,
              ])
            ).rows[0].count,
            "1",
          );
        }
        assert.equal(
          (
            await pool.query("SELECT count(*) FROM order_status_history WHERE order_id=$1", [
              rows[0]!.id,
            ])
          ).rows[0].count,
          "1",
        );
        await claimContract(repo, new PostgresOutboxRepository(pool), events[0]!.eventId);
        assert.equal(
          (
            await pool.query("SELECT status FROM outbox_events WHERE event_id=$1", [
              events[0]!.eventId,
            ])
          ).rows[0].status,
          "PUBLISHED",
        );
      },
    );
    await t.test("outbox insert failure rolls back Order, audit and provider dedupe", async () => {
      const client = await pool.connect();
      try {
        await insertPostgresOutbox(client, orderPaid(events[1]!));
      } finally {
        client.release();
      }
      await assert.rejects(workflow.applyEvent(events[1]!));
      assert.equal((await orders.findById(rows[1]!.id))!.status, "PAYMENT_PENDING");
      assert.equal(
        (
          await pool.query("SELECT count(*) FROM order_status_history WHERE order_id=$1", [
            rows[1]!.id,
          ])
        ).rows[0].count,
        "0",
      );
      assert.equal(
        (
          await pool.query("SELECT count(*) FROM processed_webhook_events WHERE event_id=$1", [
            events[1]!.eventId,
          ])
        ).rows[0].count,
        "0",
      );
      await pool.query("DELETE FROM outbox_events WHERE event_id=$1", [events[1]!.eventId]);
    });
    await t.test("exhausted lease becomes FAILED without deletion", async () => {
      await workflow.applyEvent(events[2]!);
      const claim = (await repo.claimBatch({ batchSize: 1, leaseMs: 50, maxAttempts: 1 }))[0]!;
      await delay(80);
      assert.deepEqual(await repo.claimBatch({ batchSize: 1, leaseMs: 50, maxAttempts: 1 }), []);
      assert.equal(
        (await pool.query("SELECT status FROM outbox_events WHERE id=$1", [claim.id])).rows[0]
          .status,
        "FAILED",
      );
    });
  } finally {
    await pool.query("DELETE FROM outbox_events WHERE event_id=ANY($1::uuid[])", [
      events.map((e) => e.eventId),
    ]);
    await pool.query("DELETE FROM processed_webhook_events WHERE event_id=ANY($1::uuid[])", [
      events.map((e) => e.eventId),
    ]);
    await pool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])", [rows.map((o) => o.id)]);
    await pool.end();
  }
});

test(
  "Mongo standalone atomic embedded outbox, claims, retry and durable publication",
  { skip: !process.env.MONGODB_TEST_URI },
  async () => {
    const mongo = await createMongoResources(process.env.MONGODB_TEST_URI!, "ecommerce_test");
    const o = order();
    const e = payment(o);
    const orders = new MongoOrderRepository(mongo.db);
    const repo = new MongoOutboxRepository(mongo.db);
    try {
      assert.equal(
        await mongo.db.collection("orders").countDocuments({
          "outbox.status": { $in: ["PENDING", "PROCESSING"] },
        }),
        0,
        "Unrelated pending outbox work",
      );
      await ensurePaymentIndexes(mongo.db);
      await orders.save(o);
      const workflow = new MongoPaymentWorkflowRepository(mongo.db);
      await assert.rejects(workflow.applyEvent({ ...e, paymentId: randomUUID() }));
      assert.equal(
        (await mongo.db.collection<{ _id: string }>("orders").findOne({ _id: o.id }))!.outbox,
        undefined,
      );
      // The failed identity claim above deliberately uses a different eventId for the real transition.
      e.eventId = randomUUID();
      assert.equal(await workflow.applyEvent(e), true);
      const document = await mongo.db
        .collection<{
          _id: string;
          status: string;
          outbox: any;
          paymentReceipt: any;
        }>("orders")
        .findOne({ _id: o.id });
      assert.equal(document!.status, "PAID");
      assert.equal(document!.outbox.status, "PENDING");
      assert.equal(document!.outbox.event.eventId, e.eventId);
      assert.equal(document!.paymentReceipt.id, e.eventId);
      await claimContract(repo, new MongoOutboxRepository(mongo.db), e.eventId, async () => {
        // Advance only this fixture's persisted lease/retry deadline, never the global clock.
        const result = await mongo.db
          .collection<{ _id: string }>("orders")
          .updateOne(
            { _id: o.id, "outbox.event.eventId": e.eventId },
            { $set: { "outbox.availableAt": new Date(0) } },
          );
        assert.equal(result.matchedCount, 1);
      });
      await mongo.db.collection("order_status_history").deleteOne({ _id: e.eventId });
      await mongo.db
        .collection<{ _id: string }>("processed_webhook_events")
        .updateOne({ _id: e.eventId }, { $set: { processedAt: null } });
      await workflow.applyEvent(e);
      const after = await mongo.db
        .collection<{ _id: string; outbox: any }>("orders")
        .findOne({ _id: o.id });
      assert.equal(after!.outbox.status, "PUBLISHED");
      assert.equal(after!.outbox.attempts, 3);
    } finally {
      await mongo.db.collection<{ _id: string }>("orders").deleteOne({ _id: o.id });
      await mongo.db.collection("order_status_history").deleteMany({ orderId: o.id });
      await mongo.db
        .collection("processed_webhook_events")
        .deleteMany({ identity: { $regex: o.id } });
      await mongo.client.close();
    }
  },
);

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { createMongoResources } from "../../src/database/mongo.js";
import { PostgresCheckoutRepository } from "../../src/modules/payments/postgres-checkout.repository.js";
import { MongoCheckoutRepository } from "../../src/modules/payments/mongo-checkout.repository.js";
import {
  PostgresPostPurchaseRepository,
  MongoPostPurchaseRepository,
} from "../../src/post-purchase/repository.js";

for (const storage of ["postgres", "mongodb"] as const) {
  test(`${storage}: payment attempt identity and deterministic document payment`, async () => {
    const config = loadDatabaseConfig("test");
    if (storage === "mongodb")
      assert.ok(process.env.MONGODB_TEST_URI, "MONGODB_TEST_URI required for parity verification");
    const pool = storage === "postgres" ? createPool(config) : null;
    const mongo =
      storage === "mongodb"
        ? await createMongoResources(process.env.MONGODB_TEST_URI!, "ecommerce_test")
        : null;
    const checkout = pool
      ? new PostgresCheckoutRepository(pool)
      : new MongoCheckoutRepository(mongo!.db);
    const purchase = pool
      ? new PostgresPostPurchaseRepository(pool)
      : new MongoPostPurchaseRepository(mongo!.db);
    const id = randomUUID(),
      other = randomUUID(),
      event = randomUUID();
    const late = `pay_z_${id}`,
      early = `pay_a_${id}`,
      tie = `pay_b_${id}`;
    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    try {
      if (pool) {
        await pool.query(
          "INSERT INTO orders(id,customer_id,status,total_in_minor_units,created_at,updated_at) VALUES($1,$2,'PAID',100,$3,$3)",
          [id, randomUUID(), timestamp],
        );
        await pool.query(
          "INSERT INTO order_status_history(id,order_id,from_status,to_status,reason,changed_at) VALUES($1,$2,'PAYMENT_PENDING','PAID','payment.succeeded',$3)",
          [event, id, timestamp],
        );
      } else {
        await mongo!.db
          .collection<{ _id: string; orderId: string; toStatus: string; changedAt: Date }>(
            "order_status_history",
          )
          .insertOne({ _id: event, orderId: id, toStatus: "PAID", changedAt: timestamp });
      }
      await checkout.initialize({
        orderId: id,
        paymentId: randomUUID(),
        idempotencyKey: id,
        amount: 100,
      });
      await checkout.recordAttempt(late, id, "authorized", false);
      // An update changes status, never the original checkout association.
      await checkout.recordAttempt(late, other, "captured", true);
      assert.equal((await purchase.paidInfo(id))?.providerPaymentId, late);
      await checkout.recordAttempt(late, id, "failed", false);
      assert.equal((await purchase.paidInfo(id))?.providerPaymentId, late);
      // Insert in reverse preference order to expose unordered Mongo reads.
      await checkout.recordAttempt(tie, id, "captured", true);
      await checkout.recordAttempt(early, id, "captured", true);
      if (pool) {
        await pool.query("UPDATE razorpay_payment_attempts SET updated_at=$2 WHERE order_id=$1", [
          id,
          timestamp,
        ]);
        await pool.query(
          "UPDATE razorpay_payment_attempts SET updated_at=$2 WHERE provider_payment_id=$1",
          [late, new Date(timestamp.getTime() + 1000)],
        );
      } else {
        const c = mongo!.db.collection<{ _id: string; orderId: string; updatedAt: Date }>(
          "razorpay_payment_attempts",
        );
        await c.updateMany(
          { _id: { $in: [late, early, tie] } },
          { $set: { updatedAt: timestamp } },
        );
        await c.updateOne(
          { _id: late },
          { $set: { updatedAt: new Date(timestamp.getTime() + 1000) } },
        );
      }
      assert.deepEqual(await purchase.paidInfo(id), {
        paidAt: timestamp.toISOString(),
        providerPaymentId: early,
      });
    } finally {
      if (pool) {
        await pool.query(
          "DELETE FROM razorpay_payment_attempts WHERE provider_payment_id=ANY($1::text[])",
          [[late, early, tie]],
        );
        await pool.query("DELETE FROM razorpay_checkouts WHERE order_id=$1", [id]);
        await pool.query("DELETE FROM orders WHERE id=$1", [id]);
        await pool.end();
      } else {
        await mongo!.db
          .collection<{ _id: string }>("razorpay_payment_attempts")
          .deleteMany({ _id: { $in: [late, early, tie] } });
        await mongo!.db.collection<{ _id: string }>("razorpay_checkouts").deleteOne({ _id: id });
        await mongo!.db
          .collection<{ _id: string }>("order_status_history")
          .deleteOne({ _id: event });
        await mongo!.client.close();
      }
    }
  });
}

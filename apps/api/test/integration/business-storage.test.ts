import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createBusinessResources } from "../../src/database/business.js";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { createMongoResources } from "../../src/database/mongo.js";
import { DuplicateSkuError } from "../../src/modules/products/product.repository.js";
import { DuplicateCategorySlugError } from "../../src/modules/categories/category.repository.js";
import { PermanentProcessingError } from "../../src/events/order-notification.repository.js";
import { orderPaid } from "../../src/events/order-paid.js";
import type { Product } from "../../src/modules/products/product.js";
import type { Order } from "../../src/modules/orders/order.types.js";

// Identical assertions against the actual runtime factory, including unused-database isolation.
for (const storage of ["postgres", "mongodb"] as const)
  test(`${storage}: full business persistence contract and non-payment smoke`, async () => {
    loadDatabaseConfig("test");
    const saved = { ...process.env };
    const dbConfig = loadDatabaseConfig("test");
    const mongoUri = process.env.MONGODB_TEST_URI;
    assert.ok(
      mongoUri,
      "MONGODB_TEST_URI is required for both-mode certification",
    );
    Object.assign(process.env, {
      NODE_ENV: "test",
      BUSINESS_STORAGE: storage,
      MONGODB_DB_NAME: "ecommerce_test",
      MONGODB_URI: mongoUri,
    });
    // Invalid configuration for the unused database proves that composition does not open it.
    if (storage === "mongodb") process.env.DB_PASSWORD = "";
    else process.env.MONGODB_URI = "not-a-mongo-uri";
    const business = await createBusinessResources();
    const categoryId = randomUUID(),
      ids = [randomUUID(), randomUUID(), randomUUID()].sort(),
      orderId = randomUUID(),
      eventId = randomUUID();
    const now = "2026-01-01T00:00:00.000Z",
      sku = randomUUID();
    try {
      await business.ready();
      assert.equal(business.storage, storage);
      const category = {
        id: categoryId,
        name: "Parity",
        slug: sku,
        status: "ACTIVE" as const,
        createdAt: now,
        updatedAt: now,
      };
      assert.deepEqual(await business.categories.create(category), category);
      assert.deepEqual(
        await business.categories.findById(categoryId),
        category,
      );
      assert.deepEqual(await business.categories.findBySlug(sku), category);
      assert.ok(
        (await business.categories.findAll()).some((c) => c.id === categoryId),
      );
      await assert.rejects(
        business.categories.create({ ...category, id: randomUUID() }),
        DuplicateCategorySlugError,
      );
      const products: Product[] = ids.map((id, i) => ({
        id,
        sku: sku + i,
        name: "Parity " + i,
        description: null,
        categoryId,
        priceInMinorUnits: 100,
        stock: 5,
        status: i === 1 ? "INACTIVE" : "ACTIVE",
        createdAt: now,
        updatedAt: now,
      }));
      for (const product of products)
        assert.deepEqual(await business.products.create(product), product);
      await assert.rejects(
        business.products.create({ ...products[0]!, id: randomUUID() }),
        DuplicateSkuError,
      );
      assert.deepEqual(
        await business.products.findBySku(products[0]!.sku),
        products[0],
      );
      assert.deepEqual(await business.products.findById(ids[0]!), products[0]);
      const all = await business.products.findAll();
      assert.deepEqual(
        all.filter((p) => ids.includes(p.id)).map((p) => p.id),
        ids,
      );
      for (const status of [undefined, "ACTIVE", "INACTIVE"] as const) {
        const matching = all.filter(
          (p) => status === undefined || p.status === status,
        );
        const query = { limit: 2, offset: 2, ...(status ? { status } : {}) };
        const result = await business.products.list(query);
        assert.equal(result.total, matching.length);
        assert.deepEqual(result.products, matching.slice(2, 4));
        const beyond = await business.products.list({
          ...query,
          offset: matching.length + 10,
        });
        assert.deepEqual(beyond.products, []);
        assert.equal(beyond.total, matching.length);
        if (status)
          assert.deepEqual(
            await business.products.findByStatus(status),
            matching,
          );
      }
      const changed = {
        ...products[0]!,
        categoryId: null,
        status: "INACTIVE" as const,
        stock: 3,
      };
      assert.deepEqual(await business.products.update(changed), changed);
      await assert.rejects(
        business.products.update({ ...changed, categoryId: randomUUID() }),
        { statusCode: 400 },
      );
      const order: Order = {
        id: orderId,
        customerId: randomUUID(),
        status: "CREATED",
        paymentId: null,
        version: 1,
        totalInMinorUnits: 200,
        createdAt: now,
        updatedAt: now,
        items: [
          {
            productId: ids[0]!,
            quantity: 2,
            unitPriceInMinorUnits: 100,
            lineTotalInMinorUnits: 200,
          },
        ],
      };
      await business.orders.save(order);
      assert.deepEqual(await business.orders.findById(orderId), order);
      const pending = {
        ...order,
        status: "PAYMENT_PENDING" as const,
        paymentId: randomUUID(),
        version: 2,
      };
      await business.orders.update(pending);
      await business.checkout.locked(orderId, async (session) => {
        await session.initialize({
          orderId,
          paymentId: pending.paymentId,
          idempotencyKey: `payment:${orderId}`,
          amount: 200,
        });
        await assert.rejects(
          business.checkout.locked(orderId, async () => undefined),
          { statusCode: 409 },
        );
        assert.equal(await session.startCreation(orderId), true);
        assert.equal(await session.startCreation(orderId), false);
        await session.setProviderOrder(
          orderId,
          "order_" + orderId.replaceAll("-", ""),
        );
        assert.equal(
          (await session.findOrder(orderId))?.payment_id,
          pending.paymentId,
        );
        assert.equal(
          (await session.claimEvent(eventId, "hash"))?.processed,
          false,
        );
        assert.equal(
          (await session.claimEvent(eventId, "other"))?.body_hash,
          "hash",
        );
        await session.completeEvent(eventId);
        assert.equal(
          (await session.claimEvent(eventId, "hash"))?.processed,
          true,
        );
      });
      await business.checkout.locked(orderId, async (session) =>
        assert.equal(
          (await session.findOrder(orderId))?.creation_started,
          true,
        ),
      );
      await assert.rejects(business.orders.update(pending), {
        statusCode: 409,
      });
      const event = {
        eventId,
        orderId,
        paymentId: pending.paymentId,
        type: "payment.succeeded" as const,
        occurredAt: now,
      };
      assert.equal(await business.payments.applyEvent(event), true);
      assert.equal(await business.payments.applyEvent(event), false);
      assert.equal((await business.orders.findById(orderId))!.status, "PAID");
      const notification = orderPaid(event);
      const attempts = await Promise.all(
        Array.from({ length: 5 }, () =>
          business.notifications.process(notification),
        ),
      );
      assert.equal(attempts.filter((v) => v === "processed").length, 1);
      await assert.rejects(
        business.notifications.process({
          ...notification,
          aggregateId: randomUUID(),
        }),
        PermanentProcessingError,
      );
      // Lease/retry/claim behavior is covered by the existing shared outbox contract suite.
      assert.equal(await business.products.deleteById(ids[2]!), true);
      assert.equal(await business.products.deleteById(ids[2]!), false);
      assert.equal(await business.products.findById(ids[2]!), null);
    } finally {
      await business.close();
      for (const key of Object.keys(process.env))
        if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
      if (storage === "postgres") {
        const pool = createPool(dbConfig);
        try {
          const outbox = (
            await pool.query(
              "SELECT event_id,status FROM outbox_events WHERE aggregate_id=$1",
              [orderId],
            )
          ).rows;
          assert.equal(outbox.length, 1);
          assert.equal(outbox[0].event_id, eventId);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*) FROM order_status_history WHERE order_id=$1",
                [orderId],
              )
            ).rows[0].count,
            "1",
          );
        } finally {
          await pool.query(
            "DELETE FROM razorpay_webhook_events WHERE provider_event_id=$1",
            [eventId],
          );
          await pool.query("DELETE FROM razorpay_checkouts WHERE order_id=$1", [
            orderId,
          ]);
          await pool.query(
            "DELETE FROM order_notifications WHERE event_id=$1",
            [eventId],
          );
          await pool.query("DELETE FROM outbox_events WHERE aggregate_id=$1", [
            orderId,
          ]);
          await pool.query(
            "DELETE FROM processed_webhook_events WHERE event_id=$1",
            [eventId],
          );
          await pool.query("DELETE FROM orders WHERE id=$1", [orderId]);
          await pool.query("DELETE FROM products WHERE id=ANY($1::uuid[])", [
            ids,
          ]);
          await pool.query("DELETE FROM categories WHERE id=$1", [categoryId]);
          await pool.end();
        }
      } else {
        const mongo = await createMongoResources(mongoUri!, "ecommerce_test");
        try {
          const order = await mongo.db
            .collection<{
              _id: string;
              outbox: { event: { eventId: string } };
            }>("orders")
            .findOne({ _id: orderId });
          assert.equal(order?.outbox.event.eventId, eventId);
          assert.equal(
            await mongo.db
              .collection("order_status_history")
              .countDocuments({ orderId }),
            1,
          );
        } finally {
          for (const [collection, id] of [
            ["razorpay_checkouts", orderId],
            ["razorpay_operation_locks", orderId],
            ["razorpay_webhook_events", eventId],
            ["orders", orderId],
            ["order_notifications", eventId],
            ["processed_webhook_events", eventId],
            ["order_status_history", eventId],
            ["categories", categoryId],
          ] as const)
            await mongo.db
              .collection<{ _id: string }>(collection)
              .deleteOne({ _id: id });
          await mongo.db
            .collection<{ _id: string }>("products")
            .deleteMany({ _id: { $in: ids } });
          await mongo.client.close();
        }
      }
    }
  });

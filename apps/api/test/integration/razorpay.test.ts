import { PostgresCheckoutRepository } from "../../src/modules/payments/postgres-checkout.repository.js";
import {
  MongoCheckoutRepository,
  ensureCheckoutIndexes,
} from "../../src/modules/payments/mongo-checkout.repository.js";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { createMongoResources } from "../../src/database/mongo.js";
import { RazorpayPaymentClient } from "../../src/modules/payments/razorpay.gateway.js";
import type { RazorpayApi } from "../../src/modules/payments/razorpay.api.js";
import {
  razorpayWebhookRouter,
  razorpayCheckoutRouter,
} from "../../src/modules/payments/razorpay.routes.js";
import { PostgresOrderRepository } from "../../src/modules/orders/postgres-order.repository.js";
import { MongoOrderRepository } from "../../src/modules/orders/mongo-order.repository.js";
import { PostgresPaymentWorkflowRepository } from "../../src/modules/payments/postgres-payment.repositories.js";
import { MongoPaymentWorkflowRepository } from "../../src/modules/payments/mongo-payment.repositories.js";
import { errorHandler } from "../../src/middleware/error-handler.js";
import type { Order } from "../../src/modules/orders/order.types.js";

for (const storage of ["postgres", "mongodb"] as const)
  test(
    `Razorpay ${storage}: durable idempotency, HTTPS boundary, raw webhook, retry settlement and one outbox`,
    { skip: storage === "mongodb" && !process.env.MONGODB_TEST_URI },
    async (t) => {
      const pool = createPool(loadDatabaseConfig("test"));
      const mongo =
        storage === "mongodb"
          ? await createMongoResources(process.env.MONGODB_TEST_URI!, "ecommerce_test")
          : null;
      const orders = mongo ? new MongoOrderRepository(mongo.db) : new PostgresOrderRepository(pool);
      const workflow = mongo
        ? new MongoPaymentWorkflowRepository(mongo.db)
        : new PostgresPaymentWorkflowRepository(pool);
      const id = randomUUID(),
        receiptId = randomUUID();
      const remoteId = "order_" + id.replaceAll("-", "");
      let posts = 0,
        finds = 0;
      const secret = randomUUID() + randomUUID(),
        keySecret = randomUUID();
      const headerIds: string[] = [];
      const api: RazorpayApi = {
        createOrder: async (receipt, amount) => {
          posts++;
          return {
            id: remoteId,
            receipt,
            amount,
            currency: "INR",
            status: "created",
          };
        },
        findOrder: async (receipt) => {
          finds++;
          return {
            id: remoteId,
            receipt,
            amount: 1200,
            currency: "INR",
            status: "created",
          };
        },
        payment: async (payment) => ({
          id: payment,
          order_id: remoteId,
          amount: 1200,
          currency: "INR",
          status: "captured",
          created_at: 1700000000,
        }),
      };
      const checkout = mongo
        ? new MongoCheckoutRepository(mongo.db)
        : new PostgresCheckoutRepository(pool);
      if (mongo) await ensureCheckoutIndexes(mongo.db);
      const gateway = new RazorpayPaymentClient(
        checkout,
        api,
        "rzp_test_public",
        keySecret,
        secret,
      );
      const app = express();
      app.use("/webhooks", razorpayWebhookRouter(gateway, orders, workflow));
      app.use(express.json());
      app.use("/orders", (_req, res, next) => {
        res.locals.principal = { subject: "test-manager", roles: ["order_manager"] };
        next();
      });
      app.use("/orders", razorpayCheckoutRouter(gateway, orders));
      app.use(errorHandler);
      const server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}`;
      async function delivery(
        kind: "captured" | "failed",
        pay: string,
        eventId = randomUUID(),
        amount = 1200,
        valid = true,
      ) {
        headerIds.push(eventId);
        const body = JSON.stringify({
          event: "payment." + kind,
          payload: {
            payment: {
              entity: {
                id: pay,
                order_id: remoteId,
                amount,
                currency: "INR",
                status: kind,
                created_at: 1700000000,
              },
            },
          },
        });
        return fetch(base + "/webhooks/razorpay", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Razorpay-Event-Id": eventId,
            "X-Razorpay-Signature": valid
              ? createHmac("sha256", secret).update(body).digest("hex")
              : "0".repeat(64),
          },
          body,
        });
      }
      try {
        const input = {
          orderId: id,
          amountInMinorUnits: 1200,
          idempotencyKey: "payment:" + id,
        };
        const payment = await gateway.createPayment(input);
        assert.deepEqual(await gateway.createPayment(input), payment);
        assert.equal(posts, 1);
        await assert.rejects(gateway.createPayment({ ...input, amountInMinorUnits: 1300 }), {
          statusCode: 409,
        });
        const now = new Date().toISOString();
        const order: Order = {
          id,
          customerId: randomUUID(),
          status: "PAYMENT_PENDING",
          paymentId: payment.paymentId,
          version: 2,
          totalInMinorUnits: 1200,
          items: [
            {
              productId: randomUUID(),
              quantity: 1,
              unitPriceInMinorUnits: 1200,
              lineTotalInMinorUnits: 1200,
            },
          ],
          createdAt: now,
          updatedAt: now,
        };
        await orders.save(order);
        await t.test(
          "checkout response exposes only public key; verified callback never marks PAID",
          async () => {
            const response = await fetch(base + `/orders/${id}/checkout`, {
              method: "POST",
            });
            assert.equal(response.status, 200);
            const body: any = await response.json();
            assert.deepEqual(
              Object.keys(body).sort(),
              ["amount", "currency", "keyId", "orderId", "providerOrderId"].sort(),
            );
            const pay = "pay_" + id.replaceAll("-", "");
            const confirmation = {
              razorpay_order_id: remoteId,
              razorpay_payment_id: pay,
              razorpay_signature: createHmac("sha256", keySecret)
                .update(remoteId + "|" + pay)
                .digest("hex"),
            };
            assert.equal(
              (
                await fetch(base + `/orders/${id}/checkout/verify`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(confirmation),
                })
              ).status,
              200,
            );
            assert.equal((await orders.findById(id))!.status, "PAYMENT_PENDING");
            await assert.rejects(
              gateway.verifyCheckout(id, {
                ...confirmation,
                razorpay_order_id: "order_wrong",
              }),
              { statusCode: 400 },
            );
          },
        );
        await t.test("invalid signature and mismatched amount cannot change Order", async () => {
          assert.equal(
            (await delivery("captured", "pay_invalid", randomUUID(), 1200, false)).status,
            401,
          );
          assert.equal((await delivery("captured", "pay_invalid", randomUUID(), 1201)).status, 409);
          assert.equal((await orders.findById(id))!.status, "PAYMENT_PENDING");
        });
        await t.test(
          "failed attempt then captured payment settles once; duplicate and late failure are acknowledged",
          async () => {
            const failed = "pay_f" + id.replaceAll("-", "");
            const paid = "pay_c" + id.replaceAll("-", "");
            const eventId = randomUUID();
            assert.equal((await delivery("failed", failed)).status, 200);
            assert.equal((await orders.findById(id))!.status, "PAYMENT_FAILED");
            assert.equal((await delivery("captured", paid, eventId)).status, 200);
            assert.equal((await delivery("captured", paid, eventId)).status, 200);
            assert.equal((await delivery("captured", paid)).status, 200);
            assert.equal((await delivery("failed", failed)).status, 200);
            assert.equal((await orders.findById(id))!.status, "PAID");
            assert.equal((await orders.findById(id))!.version, 4);
            if (mongo) {
              assert.equal(
                await mongo.db.collection("order_status_history").countDocuments({ orderId: id }),
                2,
              );
              const row = await mongo.db
                .collection<{ _id: string; outbox: any }>("orders")
                .findOne({ _id: id });
              assert.equal(row!.outbox.event.eventType, "OrderPaid");
            } else {
              assert.equal(
                (
                  await pool.query("SELECT count(*) FROM order_status_history WHERE order_id=$1", [
                    id,
                  ])
                ).rows[0].count,
                "2",
              );
              assert.equal(
                (await pool.query("SELECT count(*) FROM outbox_events WHERE aggregate_id=$1", [id]))
                  .rows[0].count,
                "1",
              );
            }
          },
        );
        await t.test(
          "unknown creation outcome reconciles receipt without repeating POST",
          async () => {
            const ambiguous = new RazorpayPaymentClient(
              checkout,
              {
                ...api,
                createOrder: async () => {
                  posts++;
                  throw new Error("timeout");
                },
                findOrder: async (receipt) => {
                  finds++;
                  return {
                    id: "order_recovered" + receipt.replaceAll("-", ""),
                    receipt,
                    amount: 1200,
                    currency: "INR",
                    status: "created",
                  };
                },
              },
              "rzp_test_public",
              keySecret,
              secret,
            );
            const input = {
              orderId: receiptId,
              amountInMinorUnits: 1200,
              idempotencyKey: "payment:" + receiptId,
            };
            await assert.rejects(ambiguous.createPayment(input));
            const count = posts;
            await ambiguous.createPayment(input);
            assert.equal(posts, count);
            assert.equal(finds, 1);
          },
        );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        if (mongo) {
          await mongo.db
            .collection("razorpay_webhook_events")
            .deleteMany({ _id: { $in: headerIds } } as never);
          await mongo.db
            .collection("razorpay_payment_attempts")
            .deleteMany({ orderId: { $in: [id, receiptId] } });
          await mongo.db
            .collection("razorpay_checkouts")
            .deleteMany({ _id: { $in: [id, receiptId] } } as never);
          await mongo.db
            .collection("razorpay_operation_locks")
            .deleteMany({ _id: { $in: [id, receiptId] } } as never);
        } else {
          await pool.query(
            "DELETE FROM razorpay_webhook_events WHERE provider_event_id=ANY($1::text[])",
            [headerIds],
          );
          await pool.query("DELETE FROM razorpay_payment_attempts WHERE order_id=ANY($1::uuid[])", [
            [id, receiptId],
          ]);
          await pool.query("DELETE FROM razorpay_checkouts WHERE order_id=ANY($1::uuid[])", [
            [id, receiptId],
          ]);
        }
        if (mongo) {
          await mongo.db.collection<{ _id: string }>("orders").deleteOne({ _id: id });
          await mongo.db.collection("order_status_history").deleteMany({ orderId: id });
          await mongo.db
            .collection("processed_webhook_events")
            .deleteMany({ identity: { $regex: id } });
          await mongo.client.close();
        } else {
          await pool.query("DELETE FROM outbox_events WHERE aggregate_id=$1", [id]);
          await pool.query(
            "DELETE FROM processed_webhook_events WHERE event_id IN (SELECT id FROM order_status_history WHERE order_id=$1)",
            [id],
          );
          await pool.query("DELETE FROM orders WHERE id=$1", [id]);
        }
        await pool.end();
      }
    },
  );

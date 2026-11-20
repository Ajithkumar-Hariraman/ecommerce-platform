import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Storage } from "@google-cloud/storage";
import { loadEnv, loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { createMongoResources } from "../../src/database/mongo.js";
import { createBusinessResources } from "../../src/database/business.js";
import { OrderDocumentService, GcsOrderDocumentStore } from "../../src/post-purchase/documents.js";
import {
  PostPurchaseNotificationProcessor,
  SmtpEmailSender,
} from "../../src/post-purchase/email.js";
import { createApp } from "../../src/app.js";
import { createAccessPolicy } from "../../src/auth/middleware.js";
import {
  kafkaClient,
  kafkaProducer,
  ensureOrderTopics,
  KafkaEventPublisher,
} from "../../src/events/kafka.js";
import { startOrderConsumer } from "../../src/events/order-consumer.js";
import { OutboxRelay } from "../../src/outbox/outbox-relay.js";
import { orderPaid } from "../../src/events/order-paid.js";
import type { Order } from "../../src/modules/orders/order.types.js";
const local = process.env.LOCAL_POST_PURCHASE_INTEGRATION === "true";
const gcs = process.env.GCS_POST_PURCHASE_INTEGRATION === "true";
async function until(check: () => Promise<boolean>, label: string) {
  const end = Date.now() + 30000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("Timed out: " + label);
    await delay(100);
  }
}
for (const mode of ["postgres", "mongodb"] as const)
  test(
    `real ${mode}: private ${local ? "local" : "GCS"} PDFs, owner notifications, Kafka and Mailpit`,
    { timeout: 90000, skip: !local && !gcs },
    async () => {
      loadEnv();
      const saved = { ...process.env };
      assert(process.env.MONGODB_TEST_URI);
      process.env.NODE_ENV = "test";
      process.env.BUSINESS_STORAGE = mode;
      process.env.MONGODB_URI = process.env.MONGODB_TEST_URI;
      process.env.MONGODB_DB_NAME = "ecommerce_test";
      const config = loadDatabaseConfig("test"),
        business = await createBusinessResources(),
        pool = createPool(config),
        mongo = await createMongoResources(process.env.MONGODB_TEST_URI, "ecommerce_test");
      const id = randomUUID(),
        pendingId = randomUUID(),
        productId = randomUUID(),
        eventId = randomUUID(),
        owner = "subject-" + randomUUID(),
        email = `${id}@example.invalid`,
        now = new Date().toISOString(),
        paymentId = randomUUID();
      const o: Order = {
        id,
        customerId: null,
        ownerSubject: owner,
        customer: { name: "Verified customer", email },
        items: [
          {
            productId,
            name: "Verified product",
            quantity: 2,
            unitPriceInMinorUnits: 100,
            lineTotalInMinorUnits: 200,
          },
        ],
        status: "PAYMENT_PENDING",
        paymentId,
        version: 1,
        totalInMinorUnits: 200,
        createdAt: now,
        updatedAt: now,
      };
      const storage = local ? undefined : new Storage({
          projectId: "ecommerce-platform-510208",
          retryOptions: { totalTimeout: 10, maxRetries: 1 },
        }),
        bucket = storage?.bucket("ecommerce-platform-510208-product-assets");
      const docs = new OrderDocumentService(
        business.orders,
        business.postPurchase,
        storage && bucket ? new GcsOrderDocumentStore(storage, bucket.name) : undefined,
        "Commerce",
        local,
      );
      const sender = new SmtpEmailSender({
        host: "127.0.0.1",
        port: 1025,
        from: "Commerce <orders@commerce.local>",
        user: "",
        password: "",
      });
      let sendAttempts = 0;
      let processed = 0;
      let smtpFailureObserved = false;
      const processor = new PostPurchaseNotificationProcessor(
        business.notifications,
        business.orders,
        business.postPurchase,
        docs,
        {
          close: () => sender.close(),
          async send(message) {
            sendAttempts++;
            if (local && sendAttempts === 1)
              throw Object.assign(new Error("SMTP unavailable"), { command: "CONN" });
            await sender.send(message);
          },
        },
        "Commerce",
      );
      const prefix = "test-" + randomUUID(),
        c = {
          brokers: ["127.0.0.1:9093"],
          clientId: prefix,
          orderTopic: prefix + "-events",
          retryTopic: prefix + "-retry",
          dlqTopic: prefix + "-dlq",
          consumerGroup: prefix + "-worker",
          maxRetries: 3,
        };
      const kafka = kafkaClient(c),
        producer = kafkaProducer(kafka),
        admin = kafka.admin();
      let worker: Awaited<ReturnType<typeof startOrderConsumer>> | undefined;
      let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
      let mailboxIds: string[] = [];
      try {
        await business.products.create({
          id: productId,
          sku: productId,
          name: "Verified product",
          description: null,
          categoryId: null,
          priceInMinorUnits: 100,
          stock: 10,
          status: "ACTIVE",
          createdAt: now,
          updatedAt: now,
        });
        await business.orders.save(o);
        await business.orders.save({
          ...o,
          id: pendingId,
          customer: { name: "Pending", email },
          paymentId: randomUUID(),
        });
        assert.deepEqual((await business.orders.findById(id))?.customer, o.customer);
        assert.equal((await business.orders.findById(id))?.items[0]?.name, "Verified product");
        const event = {
          eventId,
          type: "payment.succeeded" as const,
          paymentId,
          orderId: id,
          occurredAt: now,
        };
        await business.payments.applyEvent(event);
        const paidOrder = (await business.orders.findById(id))!;
        assert.equal(paidOrder.status, "PAID");
        if (local && mode === "mongodb") {
          const removed = await mongo.db.collection("order_status_history").deleteOne({ orderId: id });
          assert.equal(removed.deletedCount, 1);
          assert.ok(
            await business.postPurchase.paidInfo(id),
            "Embedded receipt survives a missing audit projection",
          );
        }
        await docs.generate(paidOrder, "invoice");
        await docs.generate(paidOrder, "receipt");
        await ensureOrderTopics(kafka, c);
        await producer.connect();
        await admin.connect();
        worker = await startOrderConsumer(kafka, producer, c, {
          async process(event) {
            try {
              const result = await processor.process(event);
              processed++;
              return result;
            } catch (error) {
              if (local && sendAttempts === 1) {
                assert.equal((await business.orders.findById(id))?.status, "PAID");
                assert.equal(await business.postPurchase.state(id), "PENDING");
                smtpFailureObserved = true;
              }
              throw error;
            }
          },
        });
        // Never publish another test's pending work from the shared test database.
        if (mode === "postgres")
          assert.equal(
            Number(
              (
                await pool.query(
                  "SELECT COUNT(*) total FROM outbox_events WHERE aggregate_id<>$1 AND status IN ('PENDING','PROCESSING')",
                  [id],
                )
              ).rows[0].total,
            ),
            0,
            "Unrelated pending outbox records; refuse shared relay",
          );
        else
          assert.equal(
            await mongo.db.collection("orders").countDocuments({
              _id: { $ne: id },
              "outbox.status": { $in: ["PENDING", "PROCESSING"] },
            }),
            0,
            "Unrelated pending outbox records; refuse shared relay",
          );
        const publisher = new KafkaEventPublisher(producer, c.orderTopic),
          relay = new OutboxRelay(business.outbox, publisher, {
            batchSize: 1,
            leaseMs: 30000,
            maxAttempts: 3,
          });
        assert.equal(await relay.runOnce(), 1);
        await until(async () => (await business.postPurchase.state(id)) === "SENT", "SMTP sent");
        await publisher.publish(orderPaid(event));
        await until(async () => processed === 2, "duplicate consumed");
        assert.equal(sendAttempts, local ? 2 : 1);
        assert.equal(smtpFailureObserved, local);
        assert.equal(await business.postPurchase.state(id), "SENT");
        assert.equal((await business.postPurchase.list(owner, 0, 20)).total, 1);
        assert.equal((await business.postPurchase.list("other", 0, 20)).total, 0);
        const app = createApp({
          productRepository: business.products,
          categoryRepository: business.categories,
          orderRepository: business.orders,
          paymentClient: {
            createPayment: async () => {
              throw new Error("No payment should be initiated");
            },
          },
          orderDocuments: docs,
          postPurchase: business.postPurchase,
          checkReady: business.ready,
          accessPolicy: createAccessPolicy(async (token) => ({
            subject: token.startsWith("owner.") ? owner : "other",
            roles: token.startsWith("manager.") ? ["order_manager"] : [],
            scopes: [],
          })),
        });
        server = app.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        assert(address && typeof address !== "string");
        const base = `http://127.0.0.1:${address.port}/api/v1`;
        const get = (path: string, token = "owner") =>
          fetch(base + path, { headers: { Authorization: "Bearer " + token + ".a.b" } });
        for (const kind of ["invoice", "receipt"]) {
          const response = await get(`/orders/${id}/${kind}`);
          assert.equal(response.status, 200);
          assert.equal(response.headers.get("content-type"), "application/pdf");
          assert.match(response.headers.get("cache-control")!, /private/);
          const bytes = Buffer.from(await response.arrayBuffer());
          assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
          await writeFile(`/tmp/ecommerce-${mode}-${kind}.pdf`, bytes);
          assert.equal((await get(`/orders/${id}/${kind}`, "other")).status, 404);
          assert.equal((await get(`/orders/${id}/${kind}`, "manager")).status, 200);
        }
        assert.equal((await get(`/orders/${pendingId}/receipt`)).status, 409);
        assert.equal((await get(`/orders/${pendingId}/invoice`)).status, 200);
        const mine = await (await get("/notifications")).json();
        assert.equal(mine.notifications.length, 1);
        assert.equal(mine.notifications[0].orderId, id);
        assert.deepEqual((await (await get("/notifications", "other")).json()).notifications, []);
        const mailbox = await (
          await fetch(
            "http://127.0.0.1:8025/api/v1/search?query=" + encodeURIComponent("to:" + email),
          )
        ).json();
        assert.equal(mailbox.messages.length, 1, "Duplicate customer email");
        mailboxIds = mailbox.messages.map((m: any) => m.ID);
        const message = await (
          await fetch("http://127.0.0.1:8025/api/v1/message/" + mailboxIds[0])
        ).json();
        assert.equal(message.Attachments.length, 2);
        assert.deepEqual(
          message.Attachments.map((attachment: { FileName: string }) => attachment.FileName).sort(),
          ["invoice.pdf", "receipt.pdf"],
        );
        assert.match(message.Text, /Payment received/);
        assert.match(message.Text, /Verified product x 2 - INR 2\.00/);
        assert.match(message.HTML, /Payment received/);
        assert.equal(
          mode === "postgres"
            ? (await pool.query("SELECT status FROM outbox_events WHERE event_id=$1", [eventId]))
                .rows[0].status
            : (await mongo.db.collection("orders").findOne({ _id: id as any }))!.outbox.status,
          "PUBLISHED",
        );
        console.log({
          storage: mode,
          documents: local ? "private locally rendered PDFs" : "private GCS PDFs",
          mailpitMessages: 1,
          attachments: 2,
          duplicateEmail: false,
        });
      } finally {
        server?.closeAllConnections();
        if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
        await worker?.close();
        sender.close();
        await producer.disconnect();
        await admin.connect().catch(() => {});
        await admin.deleteGroups([c.consumerGroup]).catch(() => {});
        await admin
          .deleteTopics({ topics: [c.orderTopic, c.retryTopic, c.dlqTopic] })
          .catch(() => {});
        await admin.disconnect();
        for (const key of [
          `orders/${id}/invoice-v2.pdf`,
          `orders/${id}/receipt-v2.pdf`,
          `orders/${pendingId}/invoice-v1.pdf`,
        ])
          await bucket
            ?.file(key)
            .delete({ ignoreNotFound: true })
            .catch(() => {});
        const ownedMail = await (
          await fetch(
            "http://127.0.0.1:8025/api/v1/search?query=" + encodeURIComponent("to:" + email),
          )
        ).json();
        mailboxIds = ownedMail.messages.map((m: any) => m.ID);
        if (mailboxIds.length)
          await fetch("http://127.0.0.1:8025/api/v1/messages", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ IDs: mailboxIds }),
          });
        if (mode === "postgres") {
          for (const table of [
            "order_email_deliveries",
            "order_notifications",
            "order_status_history",
          ])
            await pool
              .query(`DELETE FROM ${table} WHERE order_id=ANY($1::uuid[])`, [[id, pendingId]])
              .catch(() => {});
          await pool.query("DELETE FROM processed_webhook_events WHERE event_id=$1", [eventId]);
          await pool.query("DELETE FROM outbox_events WHERE aggregate_id=$1", [id]);
          await pool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])", [[id, pendingId]]);
          await pool.query("DELETE FROM products WHERE id=$1", [productId]);
        } else {
          await mongo.db
            .collection<{ _id: string }>("orders")
            .deleteMany({ _id: { $in: [id, pendingId] } });
          await mongo.db.collection<{ _id: string }>("products").deleteOne({ _id: productId });
          await mongo.db
            .collection<{ _id: string }>("processed_webhook_events")
            .deleteOne({ _id: eventId });
          for (const table of ["order_notifications", "order_status_history"])
            await mongo.db.collection(table).deleteMany({ orderId: id });
          await mongo.db
            .collection<{ _id: string }>("order_email_deliveries")
            .deleteOne({ _id: id });
        }
        await business.close();
        await pool.end();
        await mongo.client.close();
        process.env = saved;
      }
    },
  );

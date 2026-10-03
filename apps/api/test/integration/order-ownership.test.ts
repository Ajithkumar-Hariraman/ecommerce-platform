import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { createApp } from "../../src/app.js";
import { createJwtVerifier } from "../../src/auth/oidc.js";
import { createAccessPolicy } from "../../src/auth/middleware.js";
import { createBusinessResources } from "../../src/database/business.js";
import { loadEnv, loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { createMongoResources } from "../../src/database/mongo.js";
import { RazorpayPaymentClient } from "../../src/modules/payments/razorpay.gateway.js";
import type { Order } from "../../src/modules/orders/order.types.js";

for (const storage of ["postgres", "mongodb"] as const)
  test(`${storage}: verified JWT ownership for create/read/resume/checkout`, async (t) => {
    loadEnv();
    const saved = { ...process.env };
    const config = loadDatabaseConfig("test"),
      uri = process.env.MONGODB_TEST_URI;
    assert.ok(uri, "MONGODB_TEST_URI required");
    Object.assign(process.env, {
      NODE_ENV: "test",
      BUSINESS_STORAGE: storage,
      MONGODB_URI: uri,
      MONGODB_DB_NAME: "ecommerce_test",
    });
    const business = await createBusinessResources();
    const keys = await generateKeyPair("RS256"),
      issuer = "https://ownership.test",
      audience = "ecommerce-api";
    const alice = "subject:" + randomUUID(),
      bob = "subject:" + randomUUID();
    const token = async (subject: string, roles: string[] = []) =>
      new SignJWT({ typ: "Bearer", resource_access: { [audience]: { roles } } })
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setSubject(subject)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(keys.privateKey);
    const gateway = new RazorpayPaymentClient(
      business.checkout,
      {
        createOrder: async (id, amount) => ({
          id: "order_" + id.replaceAll("-", ""),
          receipt: id,
          amount,
          currency: "INR",
          status: "created",
        }),
        findOrder: async () => null,
        payment: async () => {
          throw new Error("Not needed for denied verification");
        },
      },
      "rzp_test_public",
      randomUUID(),
      randomUUID(),
    );
    const app = createApp({
      accessPolicy: createAccessPolicy(
        createJwtVerifier({ enabled: true, issuer, audience }, async () => keys.publicKey),
      ),
      productRepository: business.products,
      categoryRepository: business.categories,
      orderRepository: business.orders,
      paymentClient: gateway,
      razorpay: gateway,
      paymentWorkflow: business.payments,
      checkReady: business.ready,
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/v1/orders`;
    const productId = randomUUID(),
      owned: string[] = [],
      legacyId = randomUUID(),
      now = new Date().toISOString();
    const request = async (
      path: string,
      subject: string,
      roles: string[] = [],
      method = "GET",
      body?: object,
    ) =>
      fetch(base + path, {
        method,
        headers: {
          Authorization: "Bearer " + (await token(subject, roles)),
          "Content-Type": "application/json",
          "X-User-ID": bob,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const input = { items: [{ productId, quantity: 1, unitPriceInMinorUnits: 0 }] };
    try {
      await business.products.create({
        id: productId,
        sku: randomUUID(),
        name: "Owned product",
        description: null,
        categoryId: null,
        priceInMinorUnits: 100,
        stock: 10,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      });
      await t.test("forged customer/owner input rejected and anonymous create denied", async () => {
        for (const extra of [{ customerId: randomUUID() }, { ownerSubject: bob }])
          assert.equal((await request("", alice, [], "POST", { ...input, ...extra })).status, 400);
        assert.equal(
          (
            await fetch(base, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            })
          ).status,
          401,
        );
      });
      const created = await request("", alice, [], "POST", input);
      assert.equal(created.status, 201);
      const order = await created.json();
      owned.push(order.id);
      await t.test("verified sub is durable and cannot be overwritten through update", async () => {
        assert.equal(order.ownerSubject, alice);
        assert.equal(order.customerId, null);
        assert.equal(order.totalInMinorUnits, 100);
        assert.equal((await business.orders.findById(order.id))!.ownerSubject, alice);
        await business.orders.update({ ...order, ownerSubject: bob, version: order.version + 1 });
        assert.equal((await business.orders.findById(order.id))!.ownerSubject, alice);
      });
      await t.test("owner read/status/payment resume/checkout allowed", async () => {
        assert.equal((await request("/" + order.id, alice)).status, 200);
        assert.equal((await request(`/${order.id}/payment`, alice, [], "POST")).status, 200);
        assert.equal((await request(`/${order.id}/checkout`, alice, [], "POST")).status, 200);
      });
      await t.test(
        "cross-user read/resume/checkout/verify denied before provider calls",
        async () => {
          for (const [path, method, body] of [
            [`/${order.id}`, "GET", undefined],
            [`/${order.id}/payment`, "POST", undefined],
            [`/${order.id}/checkout`, "POST", undefined],
            [
              `/${order.id}/checkout/verify`,
              "POST",
              {
                razorpay_order_id: "order_valid",
                razorpay_payment_id: "pay_valid",
                razorpay_signature: "0".repeat(64),
              },
            ],
          ] as const)
            assert.equal((await request(path, bob, [], method, body)).status, 404);
        },
      );
      await t.test("manager and admin elevation retained", async () => {
        for (const role of ["order_manager", "admin"])
          for (const [path, method] of [
            [`/${order.id}`, "GET"],
            [`/${order.id}/payment`, "POST"],
            [`/${order.id}/checkout`, "POST"],
          ])
            assert.equal((await request(path!, bob, [role], method!)).status, 200);
      });
      const legacy: Order = {
        id: legacyId,
        customerId: randomUUID(),
        items: [],
        status: "CREATED",
        paymentId: null,
        version: 1,
        totalInMinorUnits: 0,
        createdAt: now,
        updatedAt: now,
      };
      await business.orders.save(legacy);
      await t.test("historical orders have no implicit owner", async () => {
        assert.equal((await request("/" + legacyId, legacy.customerId!)).status, 404);
        assert.equal((await request("/" + legacyId, alice)).status, 404);
        assert.equal((await request("/" + legacyId, bob, ["order_manager"])).status, 200);
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await business.close();
      process.env = saved;
      if (storage === "postgres") {
        const pool = createPool(config);
        try {
          await pool.query("DELETE FROM razorpay_checkouts WHERE order_id=ANY($1::uuid[])", [
            owned,
          ]);
          await pool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])", [[...owned, legacyId]]);
          await pool.query("DELETE FROM products WHERE id=$1", [productId]);
        } finally {
          await pool.end();
        }
      } else {
        const mongo = await createMongoResources(uri, "ecommerce_test");
        try {
          for (const c of ["orders", "razorpay_checkouts", "razorpay_operation_locks"])
            await mongo.db
              .collection<{ _id: string }>(c)
              .deleteMany({ _id: { $in: [...owned, legacyId] } });
          await mongo.db.collection<{ _id: string }>("products").deleteOne({ _id: productId });
        } finally {
          await mongo.client.close();
        }
      }
    }
  });

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../src/app.js";
import { InMemoryProductRepository } from "../src/modules/products/in-memory-product.repository.js";
import { InMemoryCategoryRepository } from "../src/modules/categories/in-memory-category.repository.js";
import type { Order } from "../src/modules/orders/order.types.js";
import { assertOrderPricing } from "../src/modules/orders/order.service.js";
import { createAccessPolicy } from "../src/auth/middleware.js";
import { generateKeyPair, SignJWT } from "jose";
import { createJwtVerifier } from "../src/auth/oidc.js";

test("local checkout uses catalog prices, ownership, stable payment retries and explicit simulator capability", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const products = new InMemoryProductRepository(),
    categories = new InMemoryCategoryRepository();
  const productId = randomUUID(),
    now = new Date().toISOString();
  await products.create({
    id: productId,
    sku: productId,
    name: "Server-priced product",
    description: null,
    categoryId: null,
    priceInMinorUnits: 34900,
    stock: 5,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
  const orders = new Map<string, Order>();
  let payments = 0,
    finalizations = 0;
  const repository = {
    list: async () => ({ orders: [...orders.values()], total: orders.size }),
    save: async (o: Order) => {
      orders.set(o.id, o);
    },
    findById: async (id: string) => orders.get(id) ?? null,
    update: async (o: Order) => {
      orders.set(o.id, o);
    },
  };
  const keys = await generateKeyPair("RS256"),
    issuer = "https://checkout.test",
    audience = "ecommerce-api";
  const token = async (subject: string) =>
    new SignJWT({ typ: "Bearer", resource_access: { [audience]: { roles: [] } } })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setSubject(subject)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);
  const dependencies = {
    productRepository: products,
    categoryRepository: categories,
    orderRepository: repository,
    paymentClient: {
      createPayment: async () => {
        payments++;
        return { paymentId: randomUUID(), status: "PENDING" as const };
      },
    },
    simulatorCheckout: {
      finalize: async (id: string, outcome: "succeed" | "fail") => {
        finalizations++;
        const o = [...orders.values()].find((o) => o.paymentId === id)!;
        orders.set(o.id, {
          ...o,
          status: outcome === "succeed" ? "PAID" : "PAYMENT_FAILED",
          version: o.version + 1,
        });
      },
    },
    accessPolicy: createAccessPolicy(
      createJwtVerifier({ enabled: true, issuer, audience }, async () => keys.publicKey),
    ),
    checkReady: async () => {},
  };
  const server = createApp(dependencies).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1/orders`;
  const request = async (path: string, method = "GET", body?: unknown, subject = "alice") =>
    fetch(base + path, {
      method,
      headers: {
        Authorization: "Bearer " + (await token(subject)),
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal((await fetch(base + "/checkout-config")).status, 401);
    assert.deepEqual(await (await request("/checkout-config")).json(), {
      provider: "local",
      simulationEnabled: true,
    });
    const created = await request("", "POST", {
      items: [
        { productId, quantity: 1, unitPriceInMinorUnits: 0 },
        { productId, quantity: 2, unitPriceInMinorUnits: 1 },
      ],
    });
    assert.equal(created.status, 201);
    const order = await created.json();
    assert.equal(order.totalInMinorUnits, 104700);
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].quantity, 3);
    assert.equal(order.items[0].unitPriceInMinorUnits, 34900);
    assert.equal((await request("/" + order.id)).status, 200);
    const missing = await request("/" + randomUUID());
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.message, "Order not found");
    const route = await request("/" + order.id + "/checkout", "POST");
    assert.equal(route.status, 404);
    assert.equal((await route.json()).error.message, "Route not found");
    for (const path of [
      "/" + order.id,
      "/" + order.id + "/payment",
      "/" + order.id + "/simulator-payment",
    ])
      assert.equal(
        (
          await request(
            path,
            path.endsWith(order.id) ? "GET" : "POST",
            path.endsWith("simulator-payment") ? { outcome: "succeed" } : undefined,
            "bob",
          )
        ).status,
        404,
      );
    await Promise.all([
      request("/" + order.id + "/payment", "POST"),
      request("/" + order.id + "/payment", "POST"),
    ]);
    assert.equal(payments, 1);
    assert.equal(
      (await request("/" + order.id + "/simulator-payment", "POST", { outcome: "succeed" })).status,
      200,
    );
    assert.equal(
      (await request("/" + order.id + "/simulator-payment", "POST", { outcome: "succeed" })).status,
      200,
    );
    assert.equal(finalizations, 1);
    assert.equal(
      (await request("/" + order.id + "/simulator-payment", "POST", { outcome: "fail" })).status,
      409,
    );
    const failed = await (
      await request("", "POST", { items: [{ productId, quantity: 1 }] })
    ).json();
    assert.equal(
      (await request("/" + failed.id + "/simulator-payment", "POST", { outcome: "fail" })).status,
      200,
    );
    assert.equal(
      (await request("/" + failed.id + "/simulator-payment", "POST", { outcome: "fail" })).status,
      200,
    );
    assert.equal(
      (await request("/" + failed.id + "/simulator-payment", "POST", { outcome: "succeed" }))
        .status,
      409,
    );
    assert.equal(
      (
        await request("", "POST", {
          items: [
            { productId, quantity: 3 },
            { productId, quantity: 3 },
          ],
        })
      ).status,
      409,
    );
    const product = (await products.findById(productId))!;
    await products.update({ ...product, priceInMinorUnits: Number.MAX_SAFE_INTEGER });
    assert.equal((await request("", "POST", { items: [{ productId, quantity: 2 }] })).status, 400);
    await products.update({ ...product, priceInMinorUnits: 0 });
    assert.equal((await request("", "POST", { items: [{ productId, quantity: 1 }] })).status, 409);
    await products.update({ ...product, status: "INACTIVE" });
    assert.equal((await request("", "POST", { items: [{ productId, quantity: 1 }] })).status, 400);
    assert.throws(() => assertOrderPricing({ ...order, totalInMinorUnits: 0 }), {
      statusCode: 409,
    });
    assert.throws(
      () =>
        assertOrderPricing({ ...order, items: [{ ...order.items[0], unitPriceInMinorUnits: 0 }] }),
      { statusCode: 409 },
    );
    process.env.NODE_ENV = "production";
    const disabled = createApp(dependencies).listen(0, "127.0.0.1");
    await once(disabled, "listening");
    try {
      const a = disabled.address();
      assert.ok(a && typeof a !== "string");
      const response = await fetch(`http://127.0.0.1:${a.port}/api/v1/orders/checkout-config`, {
        headers: { Authorization: "Bearer " + (await token("alice")) },
      });
      assert.equal((await response.json()).simulationEnabled, false);
      const r = await fetch(
        `http://127.0.0.1:${a.port}/api/v1/orders/${order.id}/simulator-payment`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + (await token("alice")),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ outcome: "succeed" }),
        },
      );
      assert.equal(r.status, 404);
    } finally {
      disabled.closeAllConnections();
      await new Promise<void>((resolve) => disabled.close(() => resolve()));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

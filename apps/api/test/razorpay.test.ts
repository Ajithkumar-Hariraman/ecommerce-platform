import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { RazorpayHttpApi, razorpayPayment } from "../src/modules/payments/razorpay.api.js";
import { verifyRazorpaySignature } from "../src/modules/payments/razorpay.gateway.js";
import { webhookAudit, paymentEventSchema } from "../src/modules/payments/payment-workflow.js";

test("Razorpay signatures use exact raw bytes and reject malformed/tampered signatures", () => {
  const raw = Buffer.from('{ "event": "payment.captured" }');
  const secret = randomUUID();
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  verifyRazorpaySignature(raw, signature, secret);
  for (const invalid of ["", "abc", "g".repeat(64), "0".repeat(64)])
    assert.throws(() => verifyRazorpaySignature(raw, invalid, secret), {
      statusCode: 401,
    });
  assert.throws(
    () => verifyRazorpaySignature(JSON.stringify(JSON.parse(raw.toString())), signature, secret),
    { statusCode: 401 },
  );
  assert.throws(() => verifyRazorpaySignature(raw, signature, randomUUID()), {
    statusCode: 401,
  });
});
test("Razorpay HTTPS adapter uses Basic auth, receipt, INR and no undocumented idempotency header", async () => {
  const id = randomUUID();
  let calls = 0;
  const api = new RazorpayHttpApi("test-key", "test-secret", 100, async (url, options) => {
    calls++;
    assert.equal(url, "https://api.razorpay.com/v1/orders");
    assert.equal(options?.method, "POST");
    const headers = new Headers(options?.headers);
    assert.equal(
      headers.get("Authorization"),
      "Basic " + Buffer.from("test-key:test-secret").toString("base64"),
    );
    assert.equal(headers.has("Idempotency-Key"), false);
    assert.ok(options?.signal);
    assert.deepEqual(JSON.parse(options!.body as string), {
      amount: 1200,
      currency: "INR",
      receipt: id,
      partial_payment: false,
      notes: { internal_order_id: id },
    });
    return Response.json({
      id: "order_example",
      amount: 1200,
      currency: "INR",
      receipt: id,
      status: "created",
    });
  });
  assert.equal((await api.createOrder(id, 1200)).id, "order_example");
  assert.equal(calls, 1);
});
test("Razorpay provider failures, oversized bodies and malformed responses are safe and never retried", async () => {
  for (const transport of [
    async () => {
      throw new Error("private provider failure");
    },
    async () => new Response("private", { status: 401 }),
    async () => Response.json({ secret: "private" }),
    async () => new Response("x".repeat(65537)),
  ]) {
    let calls = 0;
    const api = new RazorpayHttpApi("key", "secret", 10, async () => {
      calls++;
      return transport();
    });
    await assert.rejects(
      api.createOrder(randomUUID(), 100),
      (e: any) => e.statusCode === 502 && !e.message.includes("private"),
    );
    assert.equal(calls, 1);
  }
});
test("Razorpay receipt reconciliation filters matches and rejects ambiguous provider Orders", async () => {
  const id = randomUUID();
  const order = {
    id: "order_a",
    amount: 100,
    currency: "INR",
    receipt: id,
    status: "created",
  };
  const api = (items: unknown[]) =>
    new RazorpayHttpApi("key", "secret", 100, async (url) => {
      assert.ok(String(url).includes("receipt=" + id));
      return Response.json({ items });
    });
  assert.equal(await api([]).findOrder(id), null);
  assert.deepEqual(await api([order]).findOrder(id), order);
  await assert.rejects(api([order, { ...order, id: "order_b" }]).findOrder(id), {
    statusCode: 409,
  });
});
test("Razorpay failed attempts may later settle; late failure never reverses PAID; local workflow unchanged", () => {
  const event = {
    eventId: randomUUID(),
    orderId: randomUUID(),
    paymentId: randomUUID(),
    type: "payment.succeeded" as const,
    occurredAt: new Date().toISOString(),
  };
  assert.equal(
    webhookAudit(
      { ...event, provider: "razorpay" },
      { paymentId: event.paymentId, status: "PAYMENT_FAILED", totalInMinorUnits: 100 },
    )!.toStatus,
    "PAID",
  );
  assert.equal(
    webhookAudit(
      { ...event, provider: "razorpay", type: "payment.failed" },
      { paymentId: event.paymentId, status: "PAID", totalInMinorUnits: 100 },
    ),
    null,
  );
  assert.throws(
    () =>
      webhookAudit(event, {
        paymentId: event.paymentId,
        status: "PAYMENT_FAILED",
        totalInMinorUnits: 100,
      }),
    { statusCode: 409 },
  );
  assert.equal(paymentEventSchema.safeParse({ ...event, provider: "razorpay" }).success, false);
  assert.equal(
    razorpayPayment.safeParse({
      id: "pay_a",
      order_id: "order_a",
      amount: 100,
      currency: "INR",
      status: "captured",
      created_at: Number.MAX_SAFE_INTEGER,
    }).success,
    false,
  );
});

import { OrderService } from "../src/modules/orders/order.service.js";
import type { Order } from "../src/modules/orders/order.types.js";
import { InMemoryProductRepository } from "../src/modules/products/in-memory-product.repository.js";
import { loadEnv, loadRazorpayConfig, loadPaymentProvider } from "../src/config/env.js";
test("Razorpay Order pricing comes from Product repository, never client-supplied amount", async () => {
  const products = new InMemoryProductRepository();
  const id = randomUUID();
  const now = new Date().toISOString();
  await products.create({
    id,
    sku: id,
    name: "Checkout product",
    description: null,
    categoryId: null,
    priceInMinorUnits: 1200,
    stock: 5,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
  let saved: Order | undefined;
  let charged = 0;
  const service = new OrderService(
    {
      async list() {
        return { orders: saved ? [saved] : [], total: saved ? 1 : 0 };
      },
      async save(o) {
        saved = o;
      },
      async findById() {
        return saved ?? null;
      },
      async update(o) {
        saved = o;
      },
    },
    {
      async createPayment(input) {
        charged = input.amountInMinorUnits;
        return { paymentId: randomUUID(), status: "PENDING" };
      },
    },
    products,
  );
  const ownerSubject = "pricing-test-owner";
  const order = await service.create({
    items: [{ productId: id, quantity: 2, unitPriceInMinorUnits: 0 }],
  }, ownerSubject);
  assert.equal(order.ownerSubject, ownerSubject);
  assert.equal(charged, 2400);
  assert.equal(order.totalInMinorUnits, 2400);
  assert.equal(order.status, "PAYMENT_PENDING");
  await assert.rejects(
    service.create({
      items: [{ productId: randomUUID(), quantity: 1, unitPriceInMinorUnits: 1 }],
    }, ownerSubject),
    { statusCode: 400 },
  );
});
test("Razorpay configuration validates Test Mode, currency, bounded timeout and webhook secret", () => {
  loadEnv();
  const keys = [
    "PAYMENT_PROVIDER",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "RAZORPAY_CURRENCY",
    "RAZORPAY_TIMEOUT_MS",
  ];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    Object.assign(process.env, {
      PAYMENT_PROVIDER: "razorpay",
      RAZORPAY_KEY_ID: "rzp_test_example",
      RAZORPAY_KEY_SECRET: "test-secret",
      RAZORPAY_WEBHOOK_SECRET: "x".repeat(32),
      RAZORPAY_CURRENCY: "INR",
      RAZORPAY_TIMEOUT_MS: "8000",
    });
    assert.equal(loadPaymentProvider(), "razorpay");
    assert.equal(loadRazorpayConfig().timeoutMs, 8000);
    for (const [key, value] of [
      ["RAZORPAY_KEY_ID", "rzp_live_example"],
      ["RAZORPAY_WEBHOOK_SECRET", "short"],
      ["RAZORPAY_CURRENCY", "USD"],
      ["RAZORPAY_TIMEOUT_MS", "Infinity"],
      ["RAZORPAY_TIMEOUT_MS", "10001"],
    ]) {
      const before = process.env[key!];
      process.env[key!] = value;
      assert.throws(() => loadRazorpayConfig());
      process.env[key!] = before;
    }
  } finally {
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
});
test("Razorpay HTTP timeout aborts the request without retry", async () => {
  let calls = 0;
  const api = new RazorpayHttpApi("key", "secret", 20, async (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new Error("timeout")), {
        once: true,
      });
    });
  });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(api.createOrder(randomUUID(), 100), {
      statusCode: 502,
    });
    assert.equal(calls, 1);
  } finally {
    clearTimeout(keepAlive);
  }
});

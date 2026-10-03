import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { HttpPaymentClient } from "../src/modules/payments/payment.client.js";
import { assertTransition, paymentEventSchema } from "../src/modules/payments/payment-workflow.js";
import { startProvider } from "./helpers/payment-provider.js";

test("payment workflow rejects backward transitions and invalid external events", () => {
  assertTransition("CREATED", "PAYMENT_PENDING");
  assertTransition("PAYMENT_PENDING", "PAID");
  assertTransition("PAYMENT_PENDING", "PAYMENT_FAILED");
  assert.throws(() => assertTransition("PAID", "CREATED"), { statusCode: 409 });
  const event = {
    eventId: randomUUID(),
    orderId: randomUUID(),
    paymentId: randomUUID(),
    type: "payment.succeeded",
    occurredAt: new Date().toISOString(),
  };
  assert.ok(paymentEventSchema.safeParse(event).success);
  for (const invalid of [
    { ...event, type: "other" },
    { ...event, occurredAt: "yesterday" },
    { ...event, paymentId: "bad" },
    { ...event, extra: 1 },
  ])
    assert.equal(paymentEventSchema.safeParse(invalid).success, false);
});

test("real HTTP provider persists idempotency across timeout and process restart", async () => {
  const secret = randomUUID() + randomUUID();
  const provider = await startProvider("http://127.0.0.1:1/webhook", secret, {
    responseDelay: 150,
  });
  let restarted: Awaited<ReturnType<typeof startProvider>> | undefined;
  const input = {
    orderId: randomUUID(),
    amountInMinorUnits: 100,
    idempotencyKey: "payment:" + randomUUID(),
  };
  try {
    await assert.rejects(new HttpPaymentClient(provider.baseUrl, 60).createPayment(input), {
      statusCode: 502,
    });
    const client = new HttpPaymentClient(provider.baseUrl);
    const a = await client.createPayment(input);
    const b = await client.createPayment(input);
    assert.deepEqual(a, b);
    const conflict = await fetch(provider.baseUrl + "/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ orderId: input.orderId, amountInMinorUnits: 101 }),
    });
    assert.equal(conflict.status, 409);
    await provider.stop();
    restarted = await startProvider("http://127.0.0.1:1/webhook", secret, {
      databasePath: provider.databasePath,
    });
    assert.deepEqual(await new HttpPaymentClient(restarted.baseUrl).createPayment(input), a);
    await assert.rejects(new HttpPaymentClient("http://127.0.0.1:1", 50).createPayment(input), {
      statusCode: 502,
    });
  } finally {
    await restarted?.cleanup();
    await provider.cleanup();
  }
});

import { createServer } from "node:http";
import { once } from "node:events";
test("HTTP client validates provider response and hides raw details", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ paymentId: "private invalid provider value", status: "PENDING" }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await assert.rejects(
      new HttpPaymentClient(`http://127.0.0.1:${address.port}`).createPayment({
        orderId: randomUUID(),
        amountInMinorUnits: 1,
        idempotencyKey: randomUUID(),
      }),
      { statusCode: 502, message: "Payment provider unavailable or returned an invalid response" },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

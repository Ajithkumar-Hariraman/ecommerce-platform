import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { startProvider } from "../helpers/payment-provider.js";

// Explicit real-IdP opt-in; never silently substitute generated tokens here.
test(
  "real Keycloak service identities protect API while HMAC provider callback remains independent",
  { skip: !process.env.OIDC_TEST_ISSUER, timeout: 30000 },
  async () => {
    const issuer = process.env.OIDC_TEST_ISSUER!;
    const tokens: Record<string, string> = {};
    for (const name of ["reader", "manager", "unprivileged"]) {
      const secret = process.env[`ECOMMERCE_${name.toUpperCase()}_CLIENT_SECRET`];
      assert.ok(secret, "Configure private client credentials");
      const response = await fetch(issuer + "/protocol/openid-connect/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: "ecommerce-cli-" + name,
          client_secret: secret,
        }),
      });
      assert.equal(response.status, 200);
      tokens[name] = (await response.json()).access_token;
    }
    const pool = createPool(loadDatabaseConfig("test"));
    const probe = createServer().listen(0, "127.0.0.1");
    await once(probe, "listening");
    const address = probe.address();
    assert.ok(address && typeof address !== "string");
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const base = `http://127.0.0.1:${address.port}`;
    const webhookSecret = randomUUID() + randomUUID();
    const provider = await startProvider(base + "/api/v1/webhooks/payments", webhookSecret);
    const child = spawn(process.execPath, ["dist/server.js"], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(address.port),
        ORDER_STORAGE: "postgres",
        BUSINESS_STORAGE: "postgres",
        PAYMENT_PROVIDER: "local",
        AUTH_ENABLED: "true",
        OIDC_ISSUER: issuer,
        OIDC_AUDIENCE: "ecommerce-api",
        PAYMENT_PROVIDER_BASE_URL: provider.baseUrl,
        PAYMENT_WEBHOOK_SECRET: webhookSecret,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    let output = "";
    child.stdout!.on("data", (data) => (output += data));
    child.stderr!.on("data", () => {});
    const products: string[] = [];
    const orders: string[] = [];
    const events: string[] = [];
    const call = (path: string, token?: string, method = "GET", body?: unknown) =>
      fetch(base + path, {
        method,
        headers: {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    try {
      for (let i = 0; i < 150 && !output.includes("API listening"); i++) {
        if (child.exitCode !== null) throw new Error("Authenticated API failed startup");
        await delay(50);
      }
      assert.match(output, /API listening/);
      assert.equal((await call("/api/v1/products")).status, 401);
      assert.equal((await call("/api/v1/products", "invalid")).status, 401);
      assert.equal((await call("/api/v1/products", tokens.unprivileged)).status, 403);
      assert.equal((await call("/api/v1/products", tokens.reader)).status, 200);
      assert.equal((await call("/api/v1/products", tokens.reader, "POST", {})).status, 403);
      assert.equal((await call("/api/v1/products/import", tokens.reader, "POST")).status, 403);
      const created = await call("/api/v1/products", tokens.manager, "POST", {
        sku: "OIDC-" + randomUUID(),
        name: "OIDC test",
        priceInMinorUnits: 100,
        stock: 1,
      });
      assert.equal(created.status, 201);
      products.push((await created.json()).id);
      assert.equal((await call("/api/v1/orders/" + randomUUID(), tokens.reader)).status, 404);
      assert.equal((await call("/api/v1/orders", tokens.reader, "POST", {})).status, 400);
      const response = await call("/api/v1/orders", tokens.manager, "POST", {
        items: [{ productId: products[0], quantity: 1, unitPriceInMinorUnits: 100 }],
      });
      assert.equal(response.status, 201);
      const order = await response.json();
      orders.push(order.id);
      assert.equal(order.status, "PAYMENT_PENDING");
      assert.equal((await call(`/api/v1/orders/${order.id}`, tokens.reader)).status, 404);
      assert.equal(
        (await call(`/api/v1/orders/${order.id}/payment`, tokens.reader, "POST", {})).status,
        404,
      );
      // Provider supplies no Bearer token; HMAC is its only authentication.
      const delivered = await fetch(provider.baseUrl + `/payments/${order.paymentId}/succeed`, {
        method: "POST",
      });
      assert.equal(delivered.status, 200);
      events.push((await delivered.json()).eventId);
      assert.equal(
        (await call(`/api/v1/orders/${order.id}`, tokens.manager).then((r) => r.json())).status,
        "PAID",
      );
      assert.equal(
        (await call("/api/v1/webhooks/payments", tokens.manager, "POST", {})).status,
        401,
      );
      assert.equal((await call("/health")).status, 200);
      console.info(
        "Real Keycloak/API checks: missing=401 invalid=401 no-role=403 reader=200 manager Product/Order=201 HMAC-only callback=200",
      );
      child.kill("SIGTERM");
      assert.equal((await exited)[0], 0);
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
      await provider.cleanup();
      try {
        await pool.query("DELETE FROM outbox_events WHERE event_id=ANY($1::uuid[])", [events]);
        await pool.query("DELETE FROM processed_webhook_events WHERE event_id=ANY($1::uuid[])", [
          events,
        ]);
        await pool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])", [orders]);
        await pool.query("DELETE FROM products WHERE id=ANY($1::uuid[])", [products]);
      } finally {
        await pool.end();
      }
    }
  },
);

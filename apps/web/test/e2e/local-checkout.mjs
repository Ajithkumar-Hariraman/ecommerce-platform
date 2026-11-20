// Real local Docker + Keycloak checkout regression. No real provider or external email.
// Only newly created smoke users are removed; order/payment evidence is retained.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
loadEnvFile(new URL("../../../../infra/.env", import.meta.url));
const base = "http://localhost:8088",
  issuer = "http://127.0.0.1:8180",
  tag = "checkout-smoke-" + randomUUID(),
  password = randomUUID() + "Aa1!";
const label = process.env.CHECKOUT_SMOKE_STORAGE ?? "postgres";
assert.ok(["postgres", "mongodb"].includes(label));
const users = [],
  evidence = [],
  created = [];
let browser,
  bearer = "";
async function json(url, options = {}) {
  const r = await fetch(url, options);
  assert.ok(r.ok, `HTTP ${r.status}: ${new URL(url).pathname}`);
  return r.status === 204 ? undefined : r.json();
}
async function token(realm, values) {
  return (
    await json(`${issuer}/realms/${realm}/protocol/openid-connect/token`, {
      method: "POST",
      body: new URLSearchParams(values),
    })
  ).access_token;
}
const adminToken = await token("master", {
  grant_type: "password",
  client_id: "admin-cli",
  username: process.env.KC_BOOTSTRAP_ADMIN_USERNAME,
  password: process.env.KC_BOOTSTRAP_ADMIN_PASSWORD,
});
const admin = (path, method = "GET", body) =>
  json(`${issuer}/admin/realms/ecommerce${path}`, {
    method,
    headers: { Authorization: "Bearer " + adminToken, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
async function user(suffix) {
  const username = tag + suffix;
  const r = await fetch(`${issuer}/admin/realms/ecommerce/users`, {
    method: "POST",
    headers: { Authorization: "Bearer " + adminToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      enabled: true,
      email: username + "@example.invalid",
      emailVerified: true,
      firstName: "Checkout",
      lastName: "Smoke",
      credentials: [{ type: "password", value: password, temporary: false }],
    }),
  });
  assert.equal(r.status, 201);
  users.push(r.headers.get("location").split("/").at(-1));
  return username;
}
async function login(page, username) {
  await page.goto(base + "/login");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await page.waitForURL(base + "/**");
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
async function api(path, method = "GET", body, auth = bearer) {
  const r = await fetch(base + "/api/v1" + path, {
    method,
    headers: { ...(auth ? { Authorization: auth } : {}), "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await r.json();
  evidence.push({
    method,
    path,
    status: r.status,
    ...(value.error
      ? { error: value.error.message }
      : value.id
        ? {
            id: value.id,
            total: value.totalInMinorUnits,
            paymentId: value.paymentId,
            statusValue: value.status,
            version: value.version,
          }
        : {}),
  });
  return { response: r, value };
}
try {
  const customer = await user("-owner"),
    foreign = await user("-foreign");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const page = await browser.newPage();
  let razorpayRequests = 0;
  await page.route(/razorpay\.com/, (route) => {
    razorpayRequests++;
    return route.abort();
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/orders")) {
      const auth = request.headers().authorization;
      if (auth) bearer = auth;
    }
  });
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/v1/orders"))
      evidence.push({
        browser: true,
        method: response.request().method(),
        path: url.pathname,
        status: response.status(),
      });
  });
  await login(page, customer);
  const configuration = page.waitForResponse(r => r.url().endsWith("/api/v1/orders/checkout-config"));
  await page.goto(base + "/checkout");
  const config = await (await configuration).json();
  assert.equal(config.provider, "local");
  assert.equal(config.simulationEnabled, true);
  const products = (await json(base + "/api/v1/storefront/products?limit=2")).products;
  assert.equal(products.length, 2);
  async function add(product) {
    await page.goto(base + "/products/" + product.id);
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await page.getByRole("heading", { name: product.name, exact: true }).waitFor();
    await page.getByRole("button", { name: "Add to cart", exact: true }).click();
    await page.getByText("Added to your cart.").waitFor();
  }
  for (const p of products) await add(p);
  await page.goto(base + "/checkout");
  const create = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/orders",
  );
  await page.getByRole("button", { name: "Place order & simulate payment", exact: true }).click();
  const cr = await create;
  assert.equal(cr.status(), 201);
  const order = await cr.json();
  created.push(order.id);
  assert.equal(
    order.totalInMinorUnits,
    products.reduce((sum, p) => sum + p.priceInMinorUnits, 0),
  );
  assert.ok(order.totalInMinorUnits > 0);
  await page.getByRole("button", { name: "Simulate successful payment", exact: true }).waitFor();
  assert.match(page.url(), new RegExp(order.id));
  await page.reload();
  await page.getByRole("button", { name: "Simulate successful payment", exact: true }).waitFor();
  for (let n = 0; n < 2; n++) {
    const result = await api("/orders/" + order.id + "/payment", "POST");
    assert.equal(result.response.status, 200);
    assert.equal(result.value.paymentId, order.paymentId);
  }
  const settle = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/simulator-payment"),
  );
  await page.getByRole("button", { name: "Simulate successful payment", exact: true }).click();
  assert.equal((await settle).status(), 200);
  await page.getByRole("heading", { name: "Thank you for your order", exact: true }).waitFor();
  const paid = await api("/orders/" + order.id);
  assert.equal(paid.value.status, "PAID");
  assert.equal(paid.value.version, 3);
  const duplicate = await api("/orders/" + order.id + "/simulator-payment", "POST", {
    outcome: "succeed",
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.value.version, 3);
  assert.equal(
    (await api("/orders/" + order.id + "/simulator-payment", "POST", { outcome: "fail" })).response
      .status,
    409,
  );
  await page.getByRole("button", { name: "Refresh status", exact: true }).click();
  await page.goto(base + "/orders");
  await page.getByRole("heading", { name: "My orders", exact: true }).waitFor();
  await page
    .getByRole("link", { name: "Order #" + order.id.slice(0, 8).toUpperCase(), exact: true })
    .waitFor();
  await add(products[0]);
  await page.goto(base + "/checkout");
  const createFailed = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/orders",
  );
  await page.getByRole("button", { name: "Place order & simulate payment", exact: true }).click();
  const fr = await createFailed;
  assert.equal(fr.status(), 201);
  const failed = await fr.json();
  created.push(failed.id);
  const failedResponse = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/simulator-payment"),
  );
  await page.getByRole("button", { name: "Simulate failed payment", exact: true }).click();
  assert.equal((await failedResponse).status(), 200);
  await page.getByText(/This simulated payment failed/).waitFor();
  const failure = await api("/orders/" + failed.id);
  assert.equal(failure.value.status, "PAYMENT_FAILED");
  assert.equal(
    (await api("/orders/" + failed.id + "/simulator-payment", "POST", { outcome: "fail" })).response
      .status,
    200,
  );
  await page.reload();
  await page.getByText(/This simulated payment failed/).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Continue payment", exact: true }).count(),
    0,
  );
  const foreignPage = await browser.newPage();
  await login(foreignPage, foreign);
  let foreignBearer = "";
  foreignPage.on("request", (r) => {
    if (r.url().includes("/api/v1/orders") && r.headers().authorization)
      foreignBearer = r.headers().authorization;
  });
  await foreignPage.goto(base + "/orders/" + order.id);
  await foreignPage.getByRole("alert").waitFor();
  assert.ok(foreignBearer);
  for (const path of [
    "/orders/" + order.id,
    "/orders/" + order.id + "/payment",
    "/orders/" + order.id + "/simulator-payment",
  ]) {
    const r = await api(
      path,
      path.endsWith(order.id) ? "GET" : "POST",
      path.endsWith("simulator-payment") ? { outcome: "succeed" } : undefined,
      foreignBearer,
    );
    assert.equal(r.response.status, 404);
    assert.equal(r.value.error.message, "Order not found");
  }
  const other = await api("/orders", "GET", undefined, foreignBearer);
  assert.equal(other.value.orders.length, 0);
  assert.equal((await api("/orders/" + order.id, "GET", undefined, "")).response.status, 401);
  assert.equal(
    (
      await api("/orders", "POST", {
        items: [
          { productId: products[0].id, quantity: products[0].stock },
          { productId: products[0].id, quantity: 1 },
        ],
      })
    ).response.status,
    409,
  );
  assert.equal(
    (await api("/orders", "POST", { items: [{ productId: randomUUID(), quantity: 1 }] })).response
      .status,
    400,
  );
  assert.equal(razorpayRequests, 0);
  await page.screenshot({ path: "/tmp/checkout-simulator.png", fullPage: true });
  // Exercise the hosted widget lifecycle with a browser stub and no external payment calls.
  const mockOrder = { ...order, id: randomUUID() };
  let mockStatus = "PAYMENT_PENDING", verificationCalls = 0;
  await page.route("**/api/v1/orders/checkout-config", (route) =>
    route.fulfill({ json: { provider: "razorpay", simulationEnabled: false } }));
  await page.route(new RegExp("/api/v1/orders/" + mockOrder.id + "(?:/.*)?$"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/checkout")) {
      await route.fulfill({ json: {
        keyId: "rzp_test_browser", providerOrderId: "order_browser", amount: order.totalInMinorUnits,
        currency: "INR", orderId: mockOrder.id,
      } });
    } else if (path.endsWith("/verify")) {
      verificationCalls++;
      assert.equal(route.request().postDataJSON().razorpay_order_id, "order_browser");
      mockStatus = "PAID";
      await route.fulfill({ json: { verified: true, paymentStatus: "PAID" } });
    } else {
      await route.fulfill({ json: { ...mockOrder, status: mockStatus, version: mockStatus === "PAID" ? 3 : 2 } });
    }
  });
  await page.route("https://checkout.razorpay.com/v1/checkout.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `
      window.Razorpay = class {
        constructor(options) { this.options = options; }
        open() { window.checkoutWidget = this; }
        close() { this.options.modal.ondismiss(); }
        on(event, handler) { this.fail = handler; }
      };
    ` }));
  await page.goto(base + "/checkout?order=" + mockOrder.id);
  const continuePayment = page.getByRole("button", { name: "Continue payment", exact: true });
  await continuePayment.click();
  await page.waitForFunction(() => !!window.checkoutWidget);
  await page.evaluate(() => window.checkoutWidget.fail());
  await page.getByText(/This payment attempt failed/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Processing…" }).isDisabled(), true);
  await page.evaluate(() => {
    window.checkoutWidget.close();
    window.checkoutWidget = undefined;
  });
  await page.getByText(/Payment window closed/).waitFor();
  assert.equal(verificationCalls, 0);
  await continuePayment.click();
  await page.waitForFunction(() => !!window.checkoutWidget);
  await page.evaluate(() => {
    const { handler } = window.checkoutWidget.options;
    const payment = { razorpay_order_id: "order_browser", razorpay_payment_id: "pay_browser",
      razorpay_signature: "fixture" };
    handler(payment);
    window.checkoutWidget.close();
    handler(payment);
  });
  await page.getByRole("heading", { name: "Thank you for your order", exact: true }).waitFor();
  assert.equal(verificationCalls, 1);

  console.log(
    JSON.stringify({
      result: "PASS",
      orders: created,
      paidTotal: order.totalInMinorUnits,
      paymentIds: [order.paymentId, failed.paymentId],
      razorpayRequests,
      mockedRazorpayBrowser: "PASS",
    }),
  );
} finally {
  writeFileSync(
    `/tmp/checkout-browser-${label}-requests.json`,
    JSON.stringify({ createdOrders: created, requests: evidence }, null, 2),
  );
  await browser?.close();
  for (const id of users) await admin("/users/" + id, "DELETE");
}

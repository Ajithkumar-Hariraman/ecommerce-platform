// Real local browser + Keycloak + API. Temporary customer/staff/product only;
// payment execution is covered separately by ecommerce_test simulator regressions.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { chromium } from "playwright";
loadEnvFile(new URL("../../../../infra/.env", import.meta.url));
const base = "http://localhost:8088";
const issuer = "http://127.0.0.1:8180";
const tag = "audit-" + randomUUID();
const password = randomUUID() + "Aa1!";
const ids = [];
let productId, managerToken, browser;
const check = async (label, action) => {
  await action();
  console.log("PASS " + label);
};
async function json(url, options = {}) {
  const response = await fetch(url, options);
  assert(response.ok, `HTTP ${response.status} at ${new URL(url).pathname}`);
  return response.status === 204 ? undefined : response.json();
}
async function token(realm, data) {
  return (
    await json(`${issuer}/realms/${realm}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(data),
    })
  ).access_token;
}
const adminCredentials = {
  grant_type: "password",
  client_id: "admin-cli",
  username: process.env.KC_BOOTSTRAP_ADMIN_USERNAME,
  password: process.env.KC_BOOTSTRAP_ADMIN_PASSWORD,
};
let adminToken = await token("master", adminCredentials);
const admin = (path, method = "GET", body) =>
  json(`${issuer}/admin/realms/ecommerce${path}`, {
    method,
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const api = (path, method = "GET", body) =>
  json(`${base}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
async function user(suffix, staff = false) {
  const username = tag + suffix;
  const response = await fetch(`${issuer}/admin/realms/ecommerce/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      enabled: true,
      email: `${username}@example.invalid`,
      emailVerified: true,
      firstName: "Local",
      lastName: "Audit",
      credentials: [{ type: "password", value: password, temporary: false }],
    }),
  });
  assert.equal(response.status, 201);
  const id = response.headers.get("location").split("/").at(-1);
  ids.push(id);
  if (staff) {
    const [client] = await admin("/clients?clientId=ecommerce-api");
    const role = await admin(`/clients/${client.id}/roles/admin`);
    await admin(`/users/${id}/role-mappings/clients/${client.id}`, "POST", [role]);
  }
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
try {
  const customer = await user("-customer");
  const staff = await user("-staff", true);
  managerToken = await token("ecommerce", {
    grant_type: "client_credentials",
    client_id: "ecommerce-cli-manager",
    client_secret: process.env.ECOMMERCE_MANAGER_CLIENT_SECRET,
  });
  productId = (
    await api("/products", "POST", {
      sku: tag,
      name: tag,
      description: "Temporary browser audit fixture",
      priceInMinorUnits: 100,
      stock: 5,
    })
  ).id;
  browser = await chromium.launch({
    headless: true,
    ignoreDefaultArgs: ["--disable-back-forward-cache"],
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  let refreshToken = "",
    customerAccessToken = "";
  page.on("response", async (response) => {
    if (response.url().endsWith("/protocol/openid-connect/token") && response.ok()) {
      const body = await response.json().catch(() => ({}));
      refreshToken = body.refresh_token ?? refreshToken;
      customerAccessToken = body.access_token ?? customerAccessToken;
    }
  });
  await check("guest home and native registration", async () => {
    await page.goto(base);
    await page.locator('.account-callout a[href="/register"]').waitFor();
    await page.locator('.account-callout a[href="/register"]').click();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.locator("#kc-register-form").waitFor();
  });
  await check("failed native login remains unauthenticated", async () => {
    await page.goto(base + "/login");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.locator("#username").fill(customer);
    await page.locator("#password").fill("incorrect-password");
    await page.locator("#kc-login").click();
    await page.locator("#input-error, .kc-feedback-text").first().waitFor();
  });
  const secondTab = await page.context().newPage();
  await secondTab.goto(base + "/orders");
  await secondTab.getByRole("heading", { name: "Sign in to continue" }).waitFor();
  await check("guest routes and anonymous API remain separated", async () => {
    for (const path of ["/checkout", "/account", "/orders", "/notifications", "/admin"]) {
      await secondTab.goto(base + path);
      await secondTab.getByRole("heading", { name: "Sign in to continue" }).waitFor();
    }
    for (const path of ["/shop", "/cart"]) {
      await secondTab.goto(base + path);
      await secondTab.getByRole("link", { name: "Sign in", exact: true }).first().waitFor();
      assert.equal(
        await secondTab.getByRole("heading", { name: "Sign in to continue" }).count(),
        0,
      );
    }
    await secondTab.goto(base + "/orders");
    assert.equal((await fetch(base + "/api/v1/orders")).status, 401);
  });
  await check("customer login, authenticated home, reload and route navigation", async () => {
    await login(page, customer);
    await secondTab.getByRole("heading", { name: "My orders" }).waitFor();
    let checkedInitialization = false;
    await page.route(
      "**/protocol/openid-connect/token",
      async (route) => {
        await page.getByText("Checking your session…", { exact: true }).last().waitFor();
        assert.equal(await page.getByRole("heading", { name: "My orders" }).count(), 0);
        checkedInitialization = true;
        await route.continue();
      },
      { times: 1 },
    );
    await page.goto(base + "/orders");
    await page.getByRole("heading", { name: "My orders" }).waitFor();
    assert(checkedInitialization);
    const customerCannotManage = await fetch(base + "/api/v1/products", {
      method: "POST",
      headers: { Authorization: "Bearer " + customerAccessToken },
    });
    assert.equal(customerCannotManage.status, 403);
    assert.match(customerCannotManage.headers.get("cache-control") ?? "", /no-store/);
    await page.goto(base);
    await page.locator('.account-callout a[href="/orders"]').waitFor();
    assert.equal(await page.locator('.account-callout a[href="/register"]').count(), 0);
    await page.reload();
    await page.locator('.account-callout a[href="/orders"]').waitFor();
    for (const path of ["/login", "/register"]) {
      await page.goto(base + path);
      await page.getByRole("heading", { name: "You’re signed in" }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Create account", exact: true }).count(),
        0,
      );
    }
    for (const [path, heading] of [
      ["/account", "Hello"],
      ["/orders", "My orders"],
      ["/notifications", "Notifications"],
    ]) {
      await page.goto(base + path);
      await page
        .getByRole("heading", { name: new RegExp(heading) })
        .first()
        .waitFor();
    }
    await page.goto(base + "/admin");
    await page.getByRole("heading", { name: "Access restricted" }).waitFor();
  });
  await check("real Keycloak refresh issues a token accepted by the API", async () => {
    assert(refreshToken);
    const response = await fetch(issuer + "/realms/ecommerce/protocol/openid-connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: "ecommerce-web",
        refresh_token: refreshToken,
      }),
    });
    assert.equal(response.status, 200);
    const refreshed = await response.json();
    refreshToken = refreshed.refresh_token;
    assert.equal(
      (
        await fetch(base + "/api/v1/orders", {
          headers: { Authorization: "Bearer " + refreshed.access_token },
        })
      ).status,
      200,
    );
  });
  await check("browser expiry timer refreshes through Keycloak", async () => {
    await page.clock.install();
    await page.goto(base + "/orders");
    await page.getByRole("heading", { name: "My orders" }).waitFor();
    const endpoint = "**/protocol/openid-connect/token";
    let refreshed;
    const refresh = new Promise((resolve) => {
      refreshed = resolve;
    });
    await page.route(
      endpoint,
      async (route) => {
        assert.match(route.request().postData(), /grant_type=refresh_token/);
        // Advance the browser timer only. Restore wall time before receiving a real signed token.
        await page.clock.setSystemTime(Date.now());
        const response = await route.fetch();
        const status = response.status();
        await route.fulfill({ response });
        refreshed(status);
      },
      { times: 1 },
    );
    await page.clock.fastForward(305_000);
    assert.equal(
      await Promise.race([
        refresh,
        new Promise((_, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Browser did not refresh on expiry")),
            10_000,
          );
          timeout.unref();
        }),
      ]),
      200,
    );
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await page.getByRole("heading", { name: "My orders" }).waitFor();
  });
  await check("temporary token endpoint failure recovers in the same browser session", async () => {
    await page.route(
      "**/api/v1/orders?*",
      async (route) => {
        await route.fulfill({ status: 401, json: { error: { message: "Invalid access token" } } });
      },
      { times: 1 },
    );
    const endpoint = "**/protocol/openid-connect/token";
    await page.route(endpoint, async (route) => {
      if (!route.request().postData()?.includes("grant_type=refresh_token"))
        return route.fallback();
      await route.fulfill({
        status: 503,
        headers: {
          "Access-Control-Allow-Origin": base,
          "Access-Control-Allow-Credentials": "true",
        },
      });
    });
    await page.getByRole("link", { name: "My account", exact: true }).first().click();
    await page.getByRole("link", { name: "My orders", exact: true }).first().click();
    await page.getByRole("alert").filter({ hasText: "Unable to reconnect" }).first().waitFor();
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await page.unroute(endpoint);
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/protocol/openid-connect/token") && r.ok(),
    );
    await page.clock.fastForward(6000);
    await response;
    await page.locator(".session-error").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Refresh orders" }).click();
    await page.getByRole("heading", { name: "No orders on this page" }).waitFor();
  });
  await check("real catalog/detail/cart quantity, reload, remove and checkout review", async () => {
    await page.goto(base + "/products/" + productId);
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await page.getByRole("button", { name: "Add to cart", exact: true }).click();
    await page.getByRole("link", { name: /^Cart / }).click();
    await page.getByRole("spinbutton").fill("3");
    await page.reload();
    assert.equal(await page.getByRole("spinbutton").inputValue(), "3");
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await page.getByRole("link", { name: "Proceed to checkout" }).click();
    await page.getByRole("heading", { name: "Checkout", exact: true }).waitFor();
    await page.goto(base + "/cart");
    await page.getByRole("button", { name: "Remove " + tag, exact: true }).click();
    await page.getByRole("heading", { name: "Your cart is waiting" }).waitFor();
  });
  await check("customer logout clears protected views and home CTA", async () => {
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "My account" })
      .click();
    await page.getByRole("heading", { name: /Hello/ }).waitFor();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await page.waitForURL(base + "/");
    await secondTab.getByRole("heading", { name: "Sign in to continue" }).waitFor();
    await page.goBack();
    await page.getByRole("heading", { name: "Sign in to continue" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: /Hello/ }).count(), 0);
    await page.goto(base);
    await page.locator('.account-callout a[href="/register"]').waitFor();
    const revoked = await fetch(issuer + "/realms/ecommerce/protocol/openid-connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: "ecommerce-web",
        refresh_token: refreshToken,
      }),
    });
    assert.equal(revoked.status, 400);
    await page.goto(base + "/orders");
    await page.getByRole("heading", { name: "Sign in to continue" }).waitFor();
  });
  await check("provider-side revocation ends an active browser session", async () => {
    await login(page, customer);
    await page.goto(base + "/orders");
    await page.getByRole("heading", { name: "No orders on this page" }).waitFor();
    assert(customerAccessToken);
    await admin(`/users/${ids[0]}/logout`, "POST");
    // Advance the renewal trigger without waiting for the existing JWT to expire.
    await page.route(
      "**/api/v1/orders?*",
      (route) => route.fulfill({ status: 401, json: { error: { message: "Invalid access token" } } }),
      { times: 1 },
    );
    await page.getByRole("button", { name: "Refresh orders" }).click();
    await page.getByRole("heading", { name: "Sign in to continue" }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Sign in to continue" }).waitFor();
    // The API validates JWTs offline. Record the residual lifetime of an issued JWT.
    const replay = await fetch(base + "/api/v1/orders", {
      headers: { Authorization: "Bearer " + customerAccessToken },
    });
    console.log(
      "OBSERVED issued access JWT HTTP status immediately after session revocation:",
      replay.status,
    );
  });
  await check("rejected renewal requires explicit sign-in even with an SSO cookie", async () => {
    await login(page, customer);
    await page.goto(base + "/orders");
    await page.getByRole("heading", { name: "No orders on this page" }).waitFor();
    await page.route(
      "**/api/v1/orders?*",
      async (route) => {
        await route.fulfill({ status: 401, json: { error: { message: "Invalid access token" } } });
      },
      { times: 1 },
    );
    await page.route(
      "**/protocol/openid-connect/token",
      async (route) => {
        assert.match(route.request().postData(), /grant_type=refresh_token/);
        await route.fulfill({
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": base,
            "Access-Control-Allow-Credentials": "true",
          },
          json: { error: "invalid_grant" },
        });
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "Refresh orders" }).click();
    await page.getByRole("heading", { name: "Sign in to continue" }).waitFor();
    await page.getByRole("alert").filter({ hasText: "Your session has ended" }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Sign in to continue" }).waitFor();
  });
  await check("staff admin catalog/categories/orders and authenticated home", async () => {
    const staffContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await staffContext.newPage();
    await login(page, staff);
    for (const path of ["/admin/products", "/admin/categories", "/admin/orders"]) {
      await page.goto(base + path);
      await page.getByRole("navigation", { name: "Administration" }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "Access restricted" }).count(), 0);
    }
    await page.goto(base);
    await page.locator('.account-callout a[href="/orders"]').waitFor();
    await page.setViewportSize({ width: 375, height: 812 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
  });
} catch (error) {
  console.error("FAIL", error.message.split("\n")[0].replace(/https?:\/\/\S+/g, "[URL redacted]"));
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (productId) await api("/products/" + productId, "DELETE");
  if (ids.length) adminToken = await token("master", adminCredentials);
  for (const id of ids) await admin("/users/" + id, "DELETE");
}

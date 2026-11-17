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
const adminToken = await token("master", {
  grant_type: "password",
  client_id: "admin-cli",
  username: process.env.KC_BOOTSTRAP_ADMIN_USERNAME,
  password: process.env.KC_BOOTSTRAP_ADMIN_PASSWORD,
});
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
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(30000);
  let refreshToken = "";
  page.on("response", async (response) => {
    if (response.url().endsWith("/protocol/openid-connect/token") && response.ok()) {
      const body = await response.json().catch(() => ({}));
      refreshToken = body.refresh_token ?? refreshToken;
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
  await check("customer login, authenticated home, reload and route navigation", async () => {
    await login(page, customer);
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
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(base + "/");
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
  await check("staff admin catalog/categories/orders and authenticated home", async () => {
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
} finally {
  await browser?.close();
  if (productId) await api("/products/" + productId, "DELETE");
  for (const id of ids) await admin("/users/" + id, "DELETE");
}

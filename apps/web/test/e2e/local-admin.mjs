// Runs only against the fixed local Compose endpoints. Creates and cleans up owned fixtures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { chromium } from "playwright";
loadEnvFile(new URL("../../../../infra/.env", import.meta.url));
const base = "http://localhost:8088";
const issuer = "http://127.0.0.1:8180";
const tag = "milestone-2d-" + randomUUID();
const password = randomUUID() + "Aa1!";
const ids = [];
let managerToken, browser;
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
const imageFixture = new URL("../../../../apps/api/assets/local-catalog/", import.meta.url);
const { readdir } = await import("node:fs/promises");
const imageFile = new URL(
  (await readdir(imageFixture)).find((name) => name.endsWith(".png")),
  imageFixture,
);
const ownedProducts = new Set();
const ownedCategories = new Set();

async function expectStatus(path, method, status, bearer, body) {
  const response = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(response.status, status, method + " " + path);
  return response;
}

async function listProduct(page, name) {
  const row = page.getByRole("row").filter({ hasText: name });
  const next = page.getByRole("button", { name: "Next", exact: true });
  for (;;) {
    await row.or(next).first().waitFor({ state: "visible" });
    if (await row.count()) return row;
    assert(!(await next.isDisabled()), "Fixture product must appear in the catalog");
    const loaded = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" && response.url().includes("/api/v1/products?page="),
    );
    await next.click();
    assert.equal((await loaded).status(), 200);
  }
}

async function filterProducts(page, status) {
  const loaded = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/products" &&
      url.searchParams.get("status") === (status === "ALL" ? null : status)
    );
  });
  await page.getByLabel("Show status").selectOption(status);
  assert.equal((await loaded).status(), 200);
}

try {
  const customer = await user("-customer");
  const staff = await user("-staff", true);
  managerToken = await token("ecommerce", {
    grant_type: "client_credentials",
    client_id: "ecommerce-cli-manager",
    client_secret: process.env.ECOMMERCE_MANAGER_CLIENT_SECRET,
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const anonymous = await browser.newPage();
  await anonymous.goto(base + "/admin/products");
  await anonymous.getByRole("heading", { name: "Sign in to continue" }).waitFor();
  await anonymous.close();

  const shopper = await browser.newPage();
  const customerToken = shopper
    .waitForRequest(
      (request) =>
        request.url().startsWith(base + "/api/v1/orders") && !!request.headers().authorization,
    )
    .then((request) => request.headers().authorization.slice("Bearer ".length));
  await login(shopper, customer);
  await shopper.goto(base + "/orders");
  const bearer = await customerToken;
  for (const path of ["/admin", "/admin/products", "/admin/categories", "/admin/orders"]) {
    await shopper.goto(base + path);
    await shopper.getByRole("heading", { name: "Access restricted" }).waitFor();
    assert.equal(await shopper.getByRole("link", { name: "Operations", exact: true }).count(), 0);
  }
  const missingId = randomUUID();
  for (const [method, path] of [
    ["GET", "/products"],
    ["POST", "/products"],
    ["PUT", "/products/" + missingId],
    ["DELETE", "/products/" + missingId],
    ["POST", "/products/import"],
    ["POST", "/products/" + missingId + "/image-upload"],
    ["PUT", "/products/" + missingId + "/image"],
    ["GET", "/orders?scope=all"],
    ["GET", "/categories"],
    ["POST", "/categories"],
    ["PUT", "/categories/" + missingId],
    ["DELETE", "/categories/" + missingId],
  ]) {
    await expectStatus(path, method, 401);
    await expectStatus(path, method, 403, bearer);
  }
  await expectStatus("/local-product-image", "PUT", 403);
  console.log("PASS anonymous/customer route protection and API 401/403");

  const page = await browser.newPage();
  await login(page, staff);
  await page.getByRole("link", { name: "Operations", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome to your workspace" }).waitFor();
  await page.locator(".dashboard-cards strong").first().filter({ hasText: /^\d+$/ }).waitFor();
  const nav = page.getByRole("navigation", { name: "Administration" });
  await nav.getByRole("link", { name: "Categories" }).click();
  await page.getByText("+ New category", { exact: true }).click();
  const categoryName = tag + "-category";
  await page.getByLabel("Category name").fill(categoryName);
  await page.getByLabel("Slug").fill(categoryName);
  const createdCategory = page.waitForResponse(
    (res) => res.url().endsWith("/api/v1/categories") && res.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create category" }).click();
  const categoryResponse = await createdCategory;
  assert.equal(categoryResponse.status(), 201);
  const category = await categoryResponse.json();
  ownedCategories.add(category.id);
  const adminBearer = (await categoryResponse.request().allHeaders()).authorization.slice(
    "Bearer ".length,
  );
  const categoryRow = page.locator("li").filter({ hasText: categoryName });
  await categoryRow.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Edit category" }) });
  await editor.getByLabel("Category name").fill(categoryName + " edited");
  await editor.getByLabel("Category status").selectOption("INACTIVE");
  await editor.getByRole("button", { name: "Save category" }).click();
  await page.getByText("Category updated.", { exact: true }).waitFor();
  const updatedCategory = await (
    await expectStatus("/categories/" + category.id, "GET", 200, adminBearer)
  ).json();
  assert.equal(updatedCategory.name, categoryName + " edited");
  assert.equal(updatedCategory.status, "INACTIVE");
  assert.equal(updatedCategory.createdAt, category.createdAt);
  await expectStatus("/categories", "POST", 409, adminBearer, {
    name: categoryName,
    slug: categoryName,
  });

  await nav.getByRole("link", { name: "Products" }).click();
  await page.getByRole("button", { name: "+ Add product" }).click();
  const productName = tag + "-product";
  await page.getByLabel("Product name").fill(productName);
  await page.getByLabel("SKU").fill(productName);
  await page.getByLabel("Price (major units)").fill("0");
  await page.getByRole("button", { name: "Save product" }).click();
  await page.getByText("Enter a price greater than zero.").waitFor();
  await page.getByLabel("Price (major units)").fill("12.34");
  await page.getByLabel("Stock", { exact: true }).fill("3");
  await page.locator(".editor select").first().selectOption(category.id);
  await page.getByLabel(/Product image/).setInputFiles(decodeURIComponent(imageFile.pathname));
  const productCreated = page.waitForResponse(
    (res) => res.url().endsWith("/api/v1/products") && res.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save product" }).click();
  const created = await productCreated;
  assert.equal(created.status(), 201);
  const product = await created.json();
  ownedProducts.add(product.id);
  await page.getByText("Product saved.", { exact: false }).waitFor();
  assert.equal(product.priceInMinorUnits, 1234);
  assert.equal(product.stock, 3);
  await expectStatus("/categories/" + category.id, "DELETE", 409, adminBearer);
  await expectStatus("/products/" + product.id, "PUT", 400, adminBearer, { stock: -1 });
  const invalidUpload = await (
    await expectStatus("/products/" + product.id + "/image-upload", "POST", 200, adminBearer, {
      size: 4,
      contentType: "image/png",
    })
  ).json();
  for (const [url, status] of [
    [invalidUpload.url, 400],
    [invalidUpload.url.replace("size=4", "size=3"), 403],
  ]) {
    const result = await fetch(base + url, {
      method: "PUT",
      headers: invalidUpload.headers,
      body: "text",
    });
    assert.equal(result.status, status);
  }

  const detail = base + "/products/" + product.id;
  await shopper.goto(detail);
  await shopper.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  await shopper.getByRole("heading", { name: productName }).waitFor();
  await shopper.waitForFunction(
    () => document.querySelector(".product-detail img")?.naturalWidth > 0,
  );

  const row = await listProduct(page, productName);
  await row.locator("img").evaluate((image) => image.decode());
  await row.getByRole("button", { name: "Edit " + productName }).click();
  await page.getByLabel("Product name").fill(productName + " edited");
  await page.getByLabel("Price (major units)").fill("19.99");
  await page.getByLabel("Stock", { exact: true }).fill("0");
  await page.getByLabel("Product status").selectOption("INACTIVE");
  await page.getByRole("button", { name: "Save product" }).click();
  await page.getByText("Product saved.", { exact: false }).waitFor();
  await shopper.reload();
  await shopper.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  await shopper.getByRole("heading", { name: "Product unavailable" }).waitFor();
  await expectStatus("/storefront/products/" + product.id + "/image-url", "GET", 404);

  await row.getByRole("button", { name: "Edit " + productName + " edited" }).click();
  await page.getByLabel("Product status").selectOption("ACTIVE");
  await page.getByRole("button", { name: "Save product" }).click();
  await page.getByText("Product saved.", { exact: false }).waitFor();
  await shopper.reload();
  await shopper.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  await shopper.getByRole("heading", { name: productName + " edited" }).waitFor();
  await shopper.getByText("Currently unavailable", { exact: true }).waitFor();
  assert.match(await shopper.locator(".product-detail").innerText(), /19\.99/);
  console.log(
    "PASS admin login, dashboard, category edit, product status/price/stock and image in admin/storefront",
  );

  await page.getByText("Import products from CSV", { exact: true }).click();
  const csvName = tag + "-csv";
  await page.getByLabel("Product CSV").setInputFiles({
    name: "products.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "sku,name,priceInMinorUnits,stock,status\n" +
        csvName +
        "," +
        csvName +
        ",100,2,INACTIVE\n" +
        csvName +
        "-invalid,Invalid,0,2,ACTIVE\n",
    ),
  });
  await page.getByRole("button", { name: "Import CSV" }).click();
  await page.getByText("1 imported · 1 failed", { exact: true }).waitFor();
  await filterProducts(page, "INACTIVE");
  const imported = await listProduct(page, csvName);
  await imported.getByRole("button", { name: "Delete " + csvName }).click();
  await page.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await page.getByText("Product deleted.", { exact: true }).waitFor();
  await filterProducts(page, "ALL");
  const active = await listProduct(page, productName);
  const deletedProduct = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/products/" + product.id) &&
      response.request().method() === "DELETE",
  );
  await active.getByRole("button", { name: "Delete " + productName + " edited" }).click();
  await page.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await page.getByText("Product deleted.", { exact: true }).waitFor();
  assert.equal((await deletedProduct).status(), 204);
  ownedProducts.delete(product.id);
  await shopper.reload();
  await shopper.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  await shopper.getByRole("heading", { name: "Product unavailable" }).waitFor();
  await nav.getByRole("link", { name: "Categories" }).click();
  await categoryRow.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Confirm category deletion" }).click();
  await page.getByText("Category deleted.", { exact: true }).waitFor();
  ownedCategories.delete(category.id);
  await expectStatus("/categories/" + category.id, "GET", 404, adminBearer);
  console.log("PASS partial CSV import and browser product/category deletion");
} finally {
  await browser?.close();
  try {
    if (managerToken) {
      const csvSku = tag + "-csv";
      for (let page = 1; ; page++) {
        const query = await api("/products?status=INACTIVE&limit=100&page=" + page);
        const fixture = query.products.find((product) => product.sku === csvSku);
        if (fixture) ownedProducts.add(fixture.id);
        if (fixture || !query.pagination.hasNextPage) break;
      }
      for (const id of ownedProducts) await api("/products/" + id, "DELETE");
      for (const id of ownedCategories) await api("/categories/" + id, "DELETE");
    }
  } finally {
    for (const id of ids) await admin("/users/" + id, "DELETE");
  }
}

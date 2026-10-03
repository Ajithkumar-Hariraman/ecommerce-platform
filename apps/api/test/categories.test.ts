import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createTestApp } from "./helpers/app.js";
import { CategoryService } from "../src/modules/categories/category.service.js";
import { InMemoryCategoryRepository } from "../src/modules/categories/in-memory-category.repository.js";
import { AppError } from "../src/errors/app-error.js";

test("Category HTTP and optional Product relationship", async (t) => {
  const server = createServer(createTestApp()).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const call = (method: string, path: string, body?: unknown) =>
    fetch(base + path, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
  let categoryId = "";
  let secondId = "";
  let productId = "";
  const productInput = { sku: "RELATION", name: "Coffee", priceInMinorUnits: 49999, stock: 2 };
  try {
    await t.test("empty Category collection is a 200 array", async () => {
      const response = await call("GET", "/categories");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), []);
    });
    await t.test("create Category trims values and generates identity and timestamps", async () => {
      const response = await call("POST", "/categories", { slug: " coffee ", name: " Coffee " });
      assert.equal(response.status, 201);
      const category = await response.json();
      categoryId = category.id;
      assert.match(categoryId, /^[0-9a-f-]{36}$/);
      assert.equal(response.headers.get("location"), "/api/v1/categories/" + categoryId);
      assert.equal(category.slug, "coffee");
      assert.equal(category.name, "Coffee");
      assert.equal(category.status, "ACTIVE");
      assert.equal(new Date(category.createdAt).toISOString(), category.createdAt);
      assert.equal(category.updatedAt, category.createdAt);
    });
    await t.test("list and get Category return the created record", async () => {
      const response = await call("GET", "/categories/" + categoryId);
      assert.equal(response.status, 200);
      const category = await response.json();
      const list = await call("GET", "/categories");
      assert.equal(list.status, 200);
      assert.deepEqual(await list.json(), [category]);
    });
    await t.test("duplicate trimmed Category slug returns safe 409", async () => {
      const response = await call("POST", "/categories", { slug: " coffee ", name: "Other" });
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error: { message: "Category slug already exists" },
      });
    });
    for (const [index, body] of [
      {},
      { slug: " ", name: "Coffee" },
      { slug: "x", name: " " },
      { slug: 5, name: "Coffee" },
      { slug: "x", name: "Coffee", status: "ARCHIVED" },
      { slug: "x", name: "Coffee", id: randomUUID() },
      { slug: "x", name: "Coffee", createdAt: "2000-01-01" },
    ].entries()) {
      await t.test("invalid Category body " + (index + 1) + " returns 400", async () => {
        assert.equal((await call("POST", "/categories", body)).status, 400);
      });
    }
    await t.test("missing Category is 404 and invalid UUID is 400", async () => {
      const response = await call("GET", "/categories/" + randomUUID());
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: { message: "Category not found" } });
      assert.equal((await call("GET", "/categories/not-a-uuid")).status, 400);
    });
    await t.test("create Product without category defaults to null", async () => {
      const response = await call("POST", "/products", productInput);
      assert.equal(response.status, 201);
      const product = await response.json();
      productId = product.id;
      assert.equal(product.categoryId, null);
    });
    await t.test("create Product accepts existing Category and explicit null", async () => {
      const response = await call("POST", "/products", {
        ...productInput,
        sku: "ASSIGNED",
        categoryId,
      });
      assert.equal(response.status, 201);
      assert.equal((await response.json()).categoryId, categoryId);
      const uncategorized = await call("POST", "/products", {
        ...productInput,
        sku: "NULL",
        categoryId: null,
      });
      assert.equal(uncategorized.status, 201);
      assert.equal((await uncategorized.json()).categoryId, null);
    });
    await t.test(
      "unknown Category and malformed categoryId are safe 400 on Product creation",
      async () => {
        const response = await call("POST", "/products", {
          ...productInput,
          sku: "UNKNOWN",
          categoryId: randomUUID(),
        });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
          error: { message: "Referenced category does not exist" },
        });
        assert.equal(
          (await call("POST", "/products", { ...productInput, sku: "BAD", categoryId: "invalid" }))
            .status,
          400,
        );
      },
    );
    await t.test(
      "Product category can be assigned, changed to an INACTIVE Category, and preserved when omitted",
      async () => {
        const second = await call("POST", "/categories", {
          slug: "tea",
          name: "Tea",
          status: "INACTIVE",
        });
        assert.equal(second.status, 201);
        const secondCategory = await second.json();
        secondId = secondCategory.id;
        assert.equal(secondCategory.status, "INACTIVE");
        for (const id of [categoryId, secondId]) {
          const response = await call("PUT", "/products/" + productId, { categoryId: id });
          assert.equal(response.status, 200);
          assert.equal((await response.json()).categoryId, id);
        }
        const response = await call("PUT", "/products/" + productId, { stock: 3 });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).categoryId, secondId);
      },
    );
    await t.test("unknown Category update does not mutate Product association", async () => {
      assert.equal(
        (await call("PUT", "/products/" + productId, { categoryId: randomUUID() })).status,
        400,
      );
      assert.equal(
        (await call("PUT", "/products/" + productId, { categoryId: "invalid" })).status,
        400,
      );
      const response = await call("GET", "/products/" + productId);
      assert.equal((await response.json()).categoryId, secondId);
    });
    await t.test("Product category clears back to null", async () => {
      const response = await call("PUT", "/products/" + productId, { categoryId: null });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).categoryId, null);
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("Category memory adapter copies and concurrent slug creation", async () => {
  const repository = new InMemoryCategoryRepository();
  const service = new CategoryService(repository);
  const results = await Promise.allSettled([
    service.create({ slug: "coffee", name: "Coffee" }),
    service.create({ slug: "coffee", name: "Other" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const conflict = results.find((result) => result.status === "rejected");
  assert(conflict && conflict.status === "rejected");
  assert(conflict.reason instanceof AppError && conflict.reason.statusCode === 409);
  const category = (await repository.findBySlug("coffee"))!;
  category.name = "External mutation";
  assert.equal((await repository.findById(category.id))?.name, "Coffee");
});

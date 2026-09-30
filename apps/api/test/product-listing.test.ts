import { disabledAccessPolicy } from "../src/auth/middleware.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";
import { InMemoryProductRepository } from "../src/modules/products/in-memory-product.repository.js";
import { InMemoryCategoryRepository } from "../src/modules/categories/in-memory-category.repository.js";
import { ProductService } from "../src/modules/products/product.service.js";
import { AppError } from "../src/errors/app-error.js";
import { verifyListing } from "./helpers/listing-contract.js";

test("in-memory paginated listing contract", async t => {
  await verifyListing(t, new InMemoryProductRepository());
});

test("listing service guards direct caller bounds", async () => {
  const service = new ProductService(new InMemoryProductRepository(), new InMemoryCategoryRepository());
  for (const input of [{ page: 0 }, { page: 1.5 }, { page: Infinity }, { limit: 0 }, { limit: 101 },
    { limit: NaN }, { page: Number.MAX_SAFE_INTEGER, limit: 100 }]) {
    await assert.rejects(service.list(input), error => error instanceof AppError && error.statusCode === 400);
  }
  assert.deepEqual(await service.list(), { products: [], pagination: {
    page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false,
  } });
});

test("paginated Product HTTP contract", async t => {
  const repository = new InMemoryProductRepository();
  const categories = new InMemoryCategoryRepository();
  const server = createServer(createApp({ accessPolicy: disabledAccessPolicy(), productRepository: repository, categoryRepository: categories, checkReady: async () => {} })).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1/products`;
  const get = (query = "") => fetch(base + query);
  try {
    const ids: string[] = [];
    for (let i = 0; i < 23; i++) {
      const id = randomUUID(); ids.push(id);
      await repository.create({ id, sku: "HTTP-PAGE-" + i, name: "Product " + i,
        description: null, categoryId: null, priceInMinorUnits: 100, stock: 0, status: "ACTIVE",
        createdAt: new Date(Date.UTC(2020, 0, i + 1)).toISOString(), updatedAt: new Date().toISOString() });
    }
    await t.test("defaults page 1 limit 20 and bounded envelope", async () => {
      const response = await get(); assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.products.map((p: { id: string }) => p.id), ids.slice(0, 20));
      assert.deepEqual(body.pagination, { page: 1, limit: 20, total: 23, totalPages: 2, hasNextPage: true, hasPreviousPage: false });
    });
    await t.test("zero status matches returns empty products and zero metadata", async () => {
      const response = await get("?status=INACTIVE"); assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { products: [], pagination: {
        page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false,
      } });
    });
    const first = (await repository.findById(ids[0]!))!;
    await repository.update({ ...first, status: "INACTIVE" });
    await t.test("explicit second page combines status with matching count", async () => {
      const response = await get("?status=ACTIVE&page=2&limit=5"); assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.products.map((p: { id: string }) => p.id), ids.slice(6, 11));
      assert.deepEqual(body.pagination, { page: 2, limit: 5, total: 22, totalPages: 5, hasNextPage: true, hasPreviousPage: true });
    });
    await t.test("last and beyond-last pages retain real totals", async () => {
      const last = await (await get("?page=2")).json();
      assert.deepEqual(last.products.map((p: { id: string }) => p.id), ids.slice(20));
      assert.equal(last.pagination.hasNextPage, false);
      const response = await get("?page=9&limit=5"); assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { products: [], pagination: {
        page: 9, limit: 5, total: 23, totalPages: 5, hasNextPage: false, hasPreviousPage: true,
      } });
    });
    await t.test("limit 100 accepted", async () => {
      const response = await get("?limit=100"); assert.equal(response.status, 200);
      assert.equal((await response.json()).products.length, 23);
    });
    for (const query of ["page=0", "page=-1", "page=1.5", "page=", "page=abc", "page=1e2",
      "page=9007199254740992", "page=9007199254740991&limit=100", "page=1&page=2",
      "limit=0", "limit=-1", "limit=1.5", "limit=", "limit=abc", "limit=101", "limit=5&limit=6",
      "status=INVALID", "status=ACTIVE&status=INACTIVE", "search=phone", "categoryId=x", "sortBy=price"]) {
      await t.test("safe 400 for " + query, async () => {
        const response = await get("?" + query); assert.equal(response.status, 400);
        const body = await response.json(); assert.equal(typeof body.error.message, "string");
        assert.deepEqual(Object.keys(body), ["error"]);
        assert(!JSON.stringify(body).includes("stack"));
      });
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

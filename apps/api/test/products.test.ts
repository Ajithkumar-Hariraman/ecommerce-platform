import { verifyStatusCollection } from "./helpers/status-contract.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createTestApp as createApp } from "./helpers/app.js";
import { ProductService } from "../src/modules/products/product.service.js";
import { InMemoryProductRepository } from "../src/modules/products/in-memory-product.repository.js";
import { AppError } from "../src/errors/app-error.js";

const valid = { sku: "SKU-1", name: "Coffee", priceInMinorUnits: 49999, stock: 0 };

test("Product HTTP contract", async t => {
  const server = createServer(createApp()).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1/products`;
  const call = (method: string, path = "", body?: unknown) => fetch(base + path, {
    method,
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }),
  });
  let id = "";
  let createdAt = "";
  try {
    await t.test("GET empty collection returns 200 and []", async () => {
      const response = await call("GET");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), []);
    });
    await t.test("POST creates normalized product with server ID, timestamps and defaults", async () => {
      const response = await call("POST", "", { ...valid, sku: "  SKU-1  ", name: " Coffee " });
      assert.equal(response.status, 201);
      const product = await response.json();
      id = product.id;
      createdAt = product.createdAt;
      assert.match(id, /^[0-9a-f-]{36}$/);
      assert.equal(response.headers.get("location"), `/api/v1/products/${id}`);
      assert.equal(new Date(createdAt).toISOString(), createdAt);
      assert.deepEqual(product, {
        ...valid, id, description: null, status: "ACTIVE", createdAt, updatedAt: createdAt,
      });
    });
    await t.test("POST duplicate trimmed SKU returns safe 409", async () => {
      const response = await call("POST", "", { ...valid, sku: " SKU-1 " });
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: { message: "SKU already exists" } });
    });
    await t.test("GET collection and existing ID return 200", async () => {
      const list = await call("GET");
      assert.equal(list.status, 200);
      const products = await list.json();
      assert.equal(products.length, 1);
      assert.equal(products[0].id, id);
      const single = await call("GET", "/" + id);
      assert.equal(single.status, 200);
      assert.deepEqual(await single.json(), products[0]);
    });
    await t.test("PUT preserves omitted fields and server ownership", async () => {
      await delay(5);
      const response = await call("PUT", "/" + id, { name: " New name ", description: "Details", status: "INACTIVE" });
      assert.equal(response.status, 200);
      const product = await response.json();
      assert.equal(product.name, "New name");
      assert.equal(product.sku, valid.sku);
      assert.equal(product.priceInMinorUnits, valid.priceInMinorUnits);
      assert.equal(product.stock, 0);
      assert.equal(product.status, "INACTIVE");
      assert.equal(product.description, "Details");
      assert.equal(product.id, id);
      assert.equal(product.createdAt, createdAt);
      assert(Date.parse(product.updatedAt) > Date.parse(createdAt));
      const cleared = await call("PUT", "/" + id, { description: null });
      assert.equal(cleared.status, 200);
      assert.equal((await cleared.json()).description, null);
    });

    const badBodies: unknown[] = [
      {}, null, [], "text", { ...valid, sku: "" }, { ...valid, sku: "  " },
      { ...valid, name: " " }, { ...valid, stock: -1 }, { ...valid, stock: 1.5 },
      { ...valid, stock: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, priceInMinorUnits: 0 }, { ...valid, priceInMinorUnits: -1 },
      { ...valid, priceInMinorUnits: 499.99 },
      { ...valid, priceInMinorUnits: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, priceInMinorUnits: "49999" }, { ...valid, description: 123 },
      { ...valid, id: randomUUID() }, { ...valid, createdAt: "2000-01-01" },
      { ...valid, updatedAt: "2000-01-01" }, { ...valid, status: "ACTIVE" },
      { ...valid, extra: true }, { sku: "x", name: "x", stock: 0 },
    ];
    for (const [index, body] of badBodies.entries()) {
      await t.test(`POST invalid body ${index + 1} returns 400`, async () => {
        const response = await call("POST", "", body);
        assert.equal(response.status, 400);
        assert.equal(typeof (await response.json()).error.message, "string");
      });
    }
    const badUpdates: unknown[] = [
      {}, null, [], { id: randomUUID() }, { createdAt: "old" }, { updatedAt: "old" },
      { name: " " }, { sku: " " }, { stock: -1 }, { stock: 1.1 },
      { priceInMinorUnits: 0 }, { priceInMinorUnits: 1.5 },
      { priceInMinorUnits: Number.MAX_SAFE_INTEGER + 1 },
      { status: "ARCHIVED" }, { name: null }, { extra: true },
    ];
    for (const [index, body] of badUpdates.entries()) {
      await t.test(`PUT invalid body ${index + 1} returns 400`, async () => {
        assert.equal((await call("PUT", "/" + id, body)).status, 400);
      });
    }
    await t.test("failed updates do not mutate stored fields", async () => {
      const product = await (await call("GET", "/" + id)).json();
      assert.equal(product.stock, 0);
      assert.equal(product.name, "New name");
      assert.equal(product.priceInMinorUnits, valid.priceInMinorUnits);
    });
    await t.test("PUT duplicate SKU returns 409; same own SKU is allowed", async () => {
      const other = await (await call("POST", "", { ...valid, sku: "OTHER" })).json();
      assert.equal((await call("PUT", "/" + other.id, { sku: " SKU-1 " })).status, 409);
      assert.equal((await call("PUT", "/" + id, { sku: "SKU-1" })).status, 200);
    });
    for (const method of ["GET", "PUT", "DELETE"]) {
      await t.test(`${method} missing UUID returns 404; malformed ID returns 400`, async () => {
        const body = method === "PUT" ? { stock: 2 } : undefined;
        assert.equal((await call(method, "/" + randomUUID(), body)).status, 404);
        assert.equal((await call(method, "/not-a-uuid", body)).status, 400);
      });
    }
    await t.test("DELETE returns empty 204, then GET and DELETE return 404", async () => {
      const response = await call("DELETE", "/" + id);
      assert.equal(response.status, 204);
      assert.equal(await response.text(), "");
      assert.equal((await call("GET", "/" + id)).status, 404);
      assert.equal((await call("DELETE", "/" + id)).status, 404);
      assert.equal((await call("POST", "", valid)).status, 201, "deleted SKU can be reused");
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("repository copies and service rules protect non-HTTP callers", async () => {
  const repository = new InMemoryProductRepository();
  const service = new ProductService(repository);
  const product = await service.create(valid);
  product.name = "External mutation";
  assert.equal((await service.findById(product.id)).name, "Coffee");
  const list = await service.findAll();
  list[0]!.stock = -9;
  assert.equal((await service.findById(product.id)).stock, 0);
  await assert.rejects(service.update(product.id, { stock: -1 }), error =>
    error instanceof AppError && error.statusCode === 400);
  await assert.rejects(service.create({ ...valid, sku: "X", priceInMinorUnits: 1.5 }), error =>
    error instanceof AppError && error.statusCode === 400);
  const otherAppRepository = new InMemoryProductRepository();
  assert.deepEqual(await otherAppRepository.findAll(), []);
});

test("concurrent service creates and updates cannot duplicate SKU", async () => {
  const service = new ProductService(new InMemoryProductRepository());
  const created = await Promise.allSettled([service.create(valid), service.create(valid)]);
  assert.equal(created.filter(result => result.status === "fulfilled").length, 1);
  const failed = created.find(result => result.status === "rejected");
  assert(failed && failed.status === "rejected");
  assert(failed.reason instanceof AppError && failed.reason.statusCode === 409);
  const first = await service.create({ ...valid, sku: "A" });
  const second = await service.create({ ...valid, sku: "B" });
  const updates = await Promise.allSettled([
    service.update(first.id, { sku: "TARGET" }),
    service.update(second.id, { sku: "TARGET" }),
  ]);
  assert.equal(updates.filter(result => result.status === "fulfilled").length, 1);
  const conflict = updates.find(result => result.status === "rejected");
  assert(conflict && conflict.status === "rejected");
  assert(conflict.reason instanceof AppError && conflict.reason.statusCode === 409);
  assert.equal((await service.findAll()).filter(product => product.sku === "TARGET").length, 1);
});

test("status query HTTP contract", async t => {
  const server = createServer(createApp()).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1/products`;
  const call = (method: string, path = "", body?: unknown) => fetch(base + path, {
    method,
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }),
  });
  const create = async (name: string) => {
    const response = await call("POST", "", { ...valid, sku: "STATUS-" + randomUUID(), name });
    assert.equal(response.status, 201);
    return await response.json();
  };
  try {
    const a = await create("Product A");
    const c = await create("Product C");
    await t.test("status HTTP no matches returns 200 and [] with ACTIVE products present", async () => {
      const response = await call("GET", "?status=INACTIVE");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), []);
    });

    const b = await create("Product B");
    const update = await call("PUT", "/" + b.id, { status: "INACTIVE" });
    assert.equal(update.status, 200);
    const inactiveB = await update.json();

    await t.test("status HTTP ACTIVE returns exactly A and C", async () => {
      const response = await call("GET", "?status=ACTIVE");
      assert.equal(response.status, 200);
      const products = await response.json();
      assert(Array.isArray(products));
      assert.equal(products.length, 2);
      assert.deepEqual(products.map(product => product.id).sort(), [a.id, c.id].sort());
      assert(products.every(product => product.status === "ACTIVE"));
    });
    await t.test("status HTTP INACTIVE returns exactly B", async () => {
      const response = await call("GET", "?status=INACTIVE");
      assert.equal(response.status, 200);
      const products = await response.json();
      assert(Array.isArray(products));
      assert.equal(products.length, 1);
      assert.deepEqual(products, [inactiveB]);
      assert(products.every(product => product.status === "INACTIVE"));
    });
    await t.test("status HTTP invalid status returns a safe 400 response", async () => {
      const response = await call("GET", "?status=INVALID");
      assert.equal(response.status, 400);
      assert.match(response.headers.get("content-type") ?? "", /application\/json/);
      assert.deepEqual(await response.json(), {
        error: {
          message: "Invalid product query: only optional status=ACTIVE or status=INACTIVE is supported",
        },
      });
    });
    await t.test("status HTTP absent query still returns all products", async () => {
      const response = await call("GET");
      assert.equal(response.status, 200);
      const products = await response.json();
      assert(Array.isArray(products));
      assert.equal(products.length, 3);
      assert.deepEqual(products.map(product => product.id).sort(), [a.id, b.id, c.id].sort());
    });
    await t.test("status HTTP filtering leaves the product ID route working", async () => {
      const response = await call("GET", "/" + a.id);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), a);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("in-memory status collection contract", async t => {
  await verifyStatusCollection(t, new InMemoryProductRepository());
});

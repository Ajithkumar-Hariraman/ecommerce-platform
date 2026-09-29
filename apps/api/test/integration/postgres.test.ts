import { verifyListing } from "../helpers/listing-contract.js";
import { AppError } from "../../src/errors/app-error.js";
import { DuplicateCategorySlugError } from "../../src/modules/categories/category.repository.js";
import { verifyStatusCollection } from "../helpers/status-contract.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer as httpServer } from "node:http";
import { createServer as tcpServer, connect } from "node:net";
import type { Socket } from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { DatabaseError, Pool } from "pg";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool, verifyDatabase } from "../../src/database/pool.js";
import { PostgresProductRepository } from "../../src/modules/products/postgres-product.repository.js";
import { DuplicateSkuError } from "../../src/modules/products/product.repository.js";
import { PostgresCategoryRepository } from "../../src/modules/categories/postgres-category.repository.js";
import { createApp } from "../../src/app.js";
import type { Product } from "../../src/modules/products/product.js";

function product(): Product {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), sku: "TEST-" + randomUUID(), name: "Coffee",
    description: null, categoryId: null, priceInMinorUnits: 49999, stock: 0,
    status: "ACTIVE", createdAt: now, updatedAt: now,
  };
}

test("real PostgreSQL repository and database constraints", async t => {
  const pool = createPool(loadDatabaseConfig("test"));
  const repository = new PostgresProductRepository(pool);
  const ids: string[] = [];
  const make = () => { const p = product(); ids.push(p.id); return p; };
  try {
    assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "ecommerce_test");
    await verifyDatabase(pool);
    await t.test("create, map exact bigint limits, find ID/SKU and list", async () => {
      const p = { ...make(), stock: Number.MAX_SAFE_INTEGER, priceInMinorUnits: Number.MAX_SAFE_INTEGER };
      assert.deepEqual(await repository.create(p), p);
      assert.deepEqual(await repository.findById(p.id), p);
      assert.deepEqual(await repository.findBySku(p.sku), p);
      assert((await repository.findAll()).some(row => row.id === p.id));
      const row = (await pool.query("SELECT price_in_minor_units, stock FROM products WHERE id=$1", [p.id])).rows[0];
      assert.equal(typeof row.price_in_minor_units, "string");
      assert.equal(row.stock, String(Number.MAX_SAFE_INTEGER));
    });
    await t.test("update preserves created_at, deletes and returns absent results", async () => {
      const p = await repository.create(make());
      const changed = { ...p, stock: 9, description: "Updated", status: "INACTIVE" as const,
        createdAt: "2000-01-01T00:00:00.000Z", updatedAt: new Date(Date.now() + 5).toISOString() };
      const updated = await repository.update(changed);
      assert.deepEqual(updated, { ...changed, createdAt: p.createdAt });
      assert.equal(await repository.deleteById(p.id), true);
      assert.equal(await repository.findById(p.id), null);
      assert.equal(await repository.findBySku(p.sku), null);
      assert.equal(await repository.update(changed), null);
      assert.equal(await repository.deleteById(p.id), false);
    });
    await t.test("data survives new pool and repository", async () => {
      const p = await repository.create(make());
      const secondPool = createPool(loadDatabaseConfig("test"));
      try { assert.deepEqual(await new PostgresProductRepository(secondPool).findById(p.id), p); }
      finally { await secondPool.end(); }
    });
    await t.test("concurrent INSERT has one unique violation translated to DuplicateSkuError", async () => {
      const a = make();
      const b = { ...make(), sku: a.sku };
      const results = await Promise.allSettled([repository.create(a), repository.create(b)]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const rejected = results.find(result => result.status === "rejected");
      assert(rejected && rejected.status === "rejected" && rejected.reason instanceof DuplicateSkuError);
    });
    await t.test("concurrent UPDATE also protects SKU uniqueness", async () => {
      const a = await repository.create(make());
      const b = await repository.create(make());
      const sku = "COMMON-" + randomUUID();
      const results = await Promise.allSettled([
        repository.update({ ...a, sku }), repository.update({ ...b, sku }),
      ]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const rejected = results.find(result => result.status === "rejected");
      assert(rejected && rejected.status === "rejected" && rejected.reason instanceof DuplicateSkuError);
    });
    await t.test("parameter values containing SQL remain data", async () => {
      const p = { ...make(), sku: "x'; DROP TABLE products; -- " + randomUUID() };
      await repository.create(p);
      assert.deepEqual(await repository.findBySku(p.sku), p);
      await verifyDatabase(pool);
    });
    const invalid = [
      { label: "negative stock", stock: "-1", price: "10", status: "ACTIVE", code: "23514" },
      { label: "unsafe stock", stock: "9007199254740992", price: "10", status: "ACTIVE", code: "23514" },
      { label: "zero price", stock: "0", price: "0", status: "ACTIVE", code: "23514" },
      { label: "negative price", stock: "0", price: "-1", status: "ACTIVE", code: "23514" },
      { label: "unsafe price", stock: "0", price: "9007199254740992", status: "ACTIVE", code: "23514" },
      { label: "fractional price", stock: "0", price: "1.5", status: "ACTIVE", code: "22P02" },
      { label: "invalid status", stock: "0", price: "10", status: "ARCHIVED", code: "23514" },
    ];
    for (const invalidRow of invalid) {
      await t.test("direct SQL rejects " + invalidRow.label, async () => {
        const p = make();
        await assert.rejects(pool.query(`INSERT INTO products
          (id,sku,name,price_in_minor_units,stock,status,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
          [p.id, p.sku, p.name, invalidRow.price, invalidRow.stock, invalidRow.status, p.createdAt]),
          error => error instanceof DatabaseError && error.code === invalidRow.code);
      });
    }
    await t.test("NOT NULL and blank-name constraints protect direct SQL", async () => {
      const p = await repository.create(make());
      await assert.rejects(pool.query("UPDATE products SET name=NULL WHERE id=$1", [p.id]),
        error => error instanceof DatabaseError && error.code === "23502");
      await assert.rejects(pool.query("UPDATE products SET name='   ' WHERE id=$1", [p.id]),
        error => error instanceof DatabaseError && error.code === "23514");
    });
  } finally {
    try { await pool.query("DELETE FROM products WHERE id = ANY($1::uuid[])", [ids]); }
    finally { await pool.end(); }
  }
});

test("PostgreSQL HTTP CRUD and isolated connectivity failure/recovery", { timeout: 20000 }, async () => {
  const config = loadDatabaseConfig("test");
  let available = true;
  const sockets = new Set<Socket>();
  // Fault injection affects only this test's database connection, not the WSL service.
  const proxy = tcpServer(client => {
    if (!available) { client.destroy(); return; }
    const upstream = connect(config.port, config.host);
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => { client.destroy(); upstream.destroy(); });
    }
    client.pipe(upstream).pipe(client);
  }).listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const proxyAddress = proxy.address();
  assert(proxyAddress && typeof proxyAddress !== "string");
  const pool = createPool({ ...config, host: "127.0.0.1", port: proxyAddress.port });
  const app = createApp({ productRepository: new PostgresProductRepository(pool), categoryRepository: new PostgresCategoryRepository(pool), checkReady: () => verifyDatabase(pool) });
  const server = httpServer(app).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const ids: string[] = [];
  try {
    assert.equal((await fetch(base + "/health")).status, 200);
    assert.equal((await fetch(base + "/ready")).status, 200);
    const input = { sku: "HTTP-" + randomUUID(), name: "Coffee", priceInMinorUnits: 100, stock: 1 };
    const post = () => fetch(base + "/api/v1/products", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    });
    const created = await post();
    assert.equal(created.status, 201);
    const p = await created.json();
    ids.push(p.id);
    assert.equal((await post()).status, 409);
    const url = base + "/api/v1/products/" + p.id;
    assert.equal((await fetch(url)).status, 200);
    const update = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: '{"stock":7}' });
    assert.equal(update.status, 200);
    assert.equal((await update.json()).stock, 7);
    const direct = await pool.query("SELECT stock FROM products WHERE id=$1", [p.id]);
    assert.equal(direct.rows[0].stock, "7");
    assert.equal((await fetch(base + "/api/v1/products")).status, 200);
    available = false;
    for (const socket of sockets) socket.destroy();
    await delay(100);
    assert.equal((await fetch(base + "/health")).status, 200);
    const notReady = await fetch(base + "/ready");
    assert.equal(notReady.status, 503);
    assert.deepEqual(await notReady.json(), { error: { message: "Required database is unavailable" } });
    const failed = await fetch(url);
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: { message: "Internal server error" } });
    available = true;
    assert.equal((await fetch(base + "/ready")).status, 200);
    assert.equal((await fetch(url, { method: "DELETE" })).status, 204);
    assert.equal((await fetch(url)).status, 404);
  } finally {
    available = true;
    await new Promise<void>(resolve => server.close(() => resolve()));
    try { await pool.query("DELETE FROM products WHERE id=ANY($1::uuid[])", [ids]); }
    finally {
      await pool.end();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => proxy.close(() => resolve()));
    }
  }
});

test("real runtime startup failure and ordered PostgreSQL shutdown", { timeout: 20000 }, async () => {
  loadDatabaseConfig("test");
  async function launch(extra: Record<string, string>) {
    const child = spawn(process.execPath, ["dist/server.js"], {
      env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", ...extra },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", data => { output += data.toString(); });
    child.stderr.on("data", data => { output += data.toString(); });
    const exited = once(child, "exit");
    return { child, exited, output: () => output };
  }
  const unavailable = await launch({ DB_PORT: "1" });
  assert.equal((await unavailable.exited)[0], 1);
  assert.match(unavailable.output(), /Database startup check failed/);
  assert.doesNotMatch(unavailable.output(), /API listening/);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const probe = httpServer().listen(0, "127.0.0.1");
    await once(probe, "listening");
    const address = probe.address();
    assert(address && typeof address !== "string");
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const proc = await launch({ PORT: String(address.port) });
    try {
      for (let i = 0; i < 100 && !proc.output().includes("API listening"); i++) {
        if (proc.child.exitCode !== null) throw new Error(proc.output());
        await delay(50);
      }
      assert.match(proc.output(), /API listening/);
      assert.equal((await fetch(`http://127.0.0.1:${address.port}/ready`)).status, 200);
      proc.child.kill(signal);
      assert.equal((await proc.exited)[0], 0);
      assert.match(proc.output(), /HTTP server closed\.[\s\S]*PostgreSQL pool closed\./);
    } finally { if (proc.child.exitCode === null) proc.child.kill("SIGKILL"); }
  }
});

test("PostgreSQL status collection contract", async t => {
  // One connection keeps BEGIN, repository pool.query calls, and ROLLBACK on
  // the same session. No production pool configuration is changed.
  const pool = new Pool({ ...loadDatabaseConfig("test"), max: 1, connectionTimeoutMillis: 3000 });
  try {
    assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "ecommerce_test");
    await pool.query("BEGIN");
    try {
      await pool.query("SET LOCAL lock_timeout = '5s'");
      await pool.query("SET LOCAL statement_timeout = '5s'");
      // Prevent concurrent test writers from contaminating a status-only filter.
      await pool.query("LOCK TABLE public.products IN EXCLUSIVE MODE");
      const count = (await pool.query("SELECT count(*)::int AS count FROM public.products")).rows[0].count;
      assert.equal(count, 0,
        "Status contract fixture requires an empty ecommerce_test products table; unrelated rows were left untouched");
      await verifyStatusCollection(t, new PostgresProductRepository(pool));
    } finally {
      // Revert only this transaction's test writes; never TRUNCATE or clear other rows.
      await pool.query("ROLLBACK");
    }
  } finally {
    await pool.end();
  }
});

test("Category persistence and Product foreign-key relationship", async t => {
  const pool = createPool(loadDatabaseConfig("test"));
  const categories = new PostgresCategoryRepository(pool);
  const products = new PostgresProductRepository(pool);
  const categoryIds: string[] = [];
  const productIds: string[] = [];
  const category = () => {
    const now = new Date().toISOString();
    const value = { id: randomUUID(), slug: "CATEGORY-" + randomUUID(), name: "Coffee",
      status: "ACTIVE" as const, createdAt: now, updatedAt: now };
    categoryIds.push(value.id);
    return value;
  };
  const makeProduct = (categoryId: string | null = null) => {
    const value = { ...product(), categoryId };
    productIds.push(value.id);
    return value;
  };
  try {
    assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "ecommerce_test");
    await t.test("Category persists and survives pool/repository recreation", async () => {
      const input = category();
      assert.deepEqual(await categories.create(input), input);
      assert.deepEqual(await categories.findBySlug(input.slug), input);
      assert((await categories.findAll()).some(value => value.id === input.id));
      const otherPool = createPool(loadDatabaseConfig("test"));
      try { assert.deepEqual(await new PostgresCategoryRepository(otherPool).findById(input.id), input); }
      finally { await otherPool.end(); }
    });
    await t.test("PostgreSQL enforces slug uniqueness for simultaneous inserts", async () => {
      const a = category();
      const b = { ...category(), slug: a.slug };
      const results = await Promise.allSettled([categories.create(a), categories.create(b)]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const conflict = results.find(result => result.status === "rejected");
      assert(conflict && conflict.status === "rejected");
      assert(conflict.reason instanceof DuplicateCategorySlugError);
    });
    await t.test("Category constraints reject blank names/slugs and invalid status through raw SQL", async () => {
      const c = await categories.create(category());
      for (const sql of [
        "UPDATE categories SET name=' ' WHERE id=$1",
        "UPDATE categories SET slug=' ' WHERE id=$1",
        "UPDATE categories SET status='ARCHIVED' WHERE id=$1",
      ]) {
        await assert.rejects(pool.query(sql, [c.id]), error => error instanceof DatabaseError && error.code === "23514");
      }
    });
    await t.test("multiple Products reference one Category and map category_id to categoryId", async () => {
      const c = await categories.create(category());
      const a = makeProduct(c.id);
      const b = makeProduct(c.id);
      assert.deepEqual(await products.create(a), a);
      assert.deepEqual(await products.create(b), b);
      assert.deepEqual(await products.findById(a.id), a);
      const row = (await pool.query("SELECT category_id FROM products WHERE id=$1", [a.id])).rows[0];
      assert.equal(row.category_id, c.id);
      const otherPool = createPool(loadDatabaseConfig("test"));
      try { assert.deepEqual(await new PostgresProductRepository(otherPool).findById(a.id), a); }
      finally { await otherPool.end(); }
    });
    await t.test("null Product category persists and UPDATE changes then clears category", async () => {
      const a = await categories.create(category());
      const b = await categories.create(category());
      const p = await products.create(makeProduct());
      assert.equal(p.categoryId, null);
      for (const categoryId of [a.id, b.id, null]) {
        const changed = await products.update({ ...p, categoryId });
        assert.equal(changed?.categoryId, categoryId);
        assert.equal((await products.findById(p.id))?.categoryId, categoryId);
      }
    });
    await t.test("raw SQL foreign key rejects an unknown Category", async () => {
      const p = await products.create(makeProduct());
      await assert.rejects(pool.query("UPDATE products SET category_id=$1 WHERE id=$2", [randomUUID(), p.id]),
        error => error instanceof DatabaseError && error.code === "23503" && error.constraint === "products_category_id_fkey");
    });
    await t.test("adapter translates insert/update foreign-key errors safely", async () => {
      const invalid = makeProduct(randomUUID());
      await assert.rejects(products.create(invalid), error =>
        error instanceof AppError && error.statusCode === 400 && error.message === "Referenced category does not exist");
      const p = await products.create(makeProduct());
      await assert.rejects(products.update({ ...p, categoryId: randomUUID() }), error =>
        error instanceof AppError && error.statusCode === 400);
      assert.equal((await products.findById(p.id))?.categoryId, null);
    });
    await t.test("ON DELETE RESTRICT preserves a referenced Category and its Product", async () => {
      const c = await categories.create(category());
      const p = await products.create(makeProduct(c.id));
      await assert.rejects(pool.query("DELETE FROM categories WHERE id=$1", [c.id]),
        error => error instanceof DatabaseError && error.code === "23503");
      assert.equal((await categories.findById(c.id))?.id, c.id);
      assert.equal((await products.findById(p.id))?.categoryId, c.id);
    });
    await t.test("PostgreSQL-backed HTTP Category and Product wiring shares the same Category repository", async () => {
      const server = httpServer(createApp({
        productRepository: products, categoryRepository: categories, checkReady: () => verifyDatabase(pool),
      })).listen(0, "127.0.0.1");
      await once(server, "listening");
      const addr = server.address();
      assert(addr && typeof addr !== "string");
      const base = `http://127.0.0.1:${addr.port}/api/v1`;
      try {
        const response = await fetch(base + "/categories", { method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: "HTTP-" + randomUUID(), name: "Coffee" }) });
        assert.equal(response.status, 201);
        const c = await response.json();
        categoryIds.push(c.id);
        assert.equal((await fetch(base + "/categories/" + c.id)).status, 200);
        const create = await fetch(base + "/products", { method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sku: "HTTP-CATEGORY-" + randomUUID(), name: "Coffee", stock: 0,
            priceInMinorUnits: 100, categoryId: c.id }) });
        assert.equal(create.status, 201);
        const p = await create.json();
        productIds.push(p.id);
        assert.equal(p.categoryId, c.id);
        const unknown = await fetch(base + "/products/" + p.id, { method: "PUT",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ categoryId: randomUUID() }) });
        assert.equal(unknown.status, 400);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  } finally {
    try {
      await pool.query("DELETE FROM products WHERE id=ANY($1::uuid[])", [productIds]);
      await pool.query("DELETE FROM categories WHERE id=ANY($1::uuid[])", [categoryIds]);
    } finally { await pool.end(); }
  }
});

test("PostgreSQL paginated listing contract", async t => {
  const pool = createPool(loadDatabaseConfig("test"));
  try {
    assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "ecommerce_test");
    await verifyListing(t, new PostgresProductRepository(pool));
  } finally { await pool.end(); }
});

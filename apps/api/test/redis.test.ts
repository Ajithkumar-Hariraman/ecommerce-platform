import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { ProductService } from "../src/modules/products/product.service.js";
import { RedisProductCache } from "../src/modules/products/redis-product.cache.js";
import { InMemoryProductRepository } from "../src/modules/products/in-memory-product.repository.js";
import { InMemoryCategoryRepository } from "../src/modules/categories/in-memory-category.repository.js";
import { createApp } from "../src/app.js";
import { createAccessPolicy } from "../src/auth/middleware.js";
import { rateLimit } from "../src/middleware/rate-limit.js";
import { loadEnv, loadRedisConfig } from "../src/config/env.js";

const quiet = () => {};
test("Product cache-aside, corruption, invalidation and fail-open contract", async (t) => {
  const repo = new InMemoryProductRepository();
  let reads = 0;
  const find = repo.findById.bind(repo);
  repo.findById = async (id) => {
    reads++;
    return find(id);
  };
  // Isolated test double only; runtime always uses the network Redis adapter.
  const entries = new Map<string, string>();
  let failure = "";
  const cache = new RedisProductCache(
    {
      async command(args) {
        if (args[0] === failure) throw new Error("private connection detail");
        const key = args[1]!;
        if (args[0] === "GET") return entries.get(key) ?? null;
        if (args[0] === "SET") {
          assert.equal(args[3], "EX");
          assert.equal(args[4], "60");
          entries.set(key, args[2]!);
          return "OK";
        }
        if (args[0] === "DEL") return entries.delete(key);
        throw new Error("Unexpected test command");
      },
    },
    60,
    "",
    quiet,
  );
  const service = new ProductService(repo, new InMemoryCategoryRepository(), cache);
  const product = await service.create({
    sku: randomUUID(),
    name: "Cached",
    priceInMinorUnits: 100,
    stock: 1,
  });
  const key = "product:v1:" + product.id;
  await t.test("miss reads repository, writes with atomic TTL; hit avoids repository", async () => {
    assert.equal(entries.size, 0);
    assert.deepEqual(await service.findById(product.id), product);
    assert.equal(reads, 1);
    assert.ok(entries.has(key));
    assert.deepEqual(await service.findById(product.id), product);
    assert.equal(reads, 1);
  });
  await t.test("malformed JSON, invalid shape and mismatched identity are rebuilt", async () => {
    for (const raw of [
      "{",
      "{}",
      JSON.stringify({ ...product, id: randomUUID() }),
      JSON.stringify({ ...product, stock: 1.2 }),
    ]) {
      entries.set(key, raw);
      const before = reads;
      assert.deepEqual(await service.findById(product.id), product);
      assert.equal(reads, before + 1);
      assert.deepEqual(JSON.parse(entries.get(key)!), product);
    }
  });
  await t.test("GET and SET errors retain database result", async () => {
    failure = "GET";
    assert.deepEqual(await service.findById(product.id), product);
    failure = "SET";
    entries.delete(key);
    assert.deepEqual(await service.findById(product.id), product);
    assert.equal(entries.has(key), false);
    failure = "";
  });
  await t.test("UUID case variants share cache keys and invalidation", async () => {
    await cache.set(product);
    assert.deepEqual(await cache.get(product.id.toUpperCase()), product);
    await cache.delete(product.id.toUpperCase());
    assert.equal(entries.has(key), false);
  });
  await t.test(
    "updates read authoritative state, invalidate only after successful save",
    async () => {
      await service.findById(product.id);
      await repo.update({ ...product, stock: 7 }); // cache deliberately stale
      const updated = await service.update(product.id, { name: "Updated" });
      assert.equal(updated.stock, 7);
      assert.equal(entries.has(key), false);
      await service.findById(product.id);
      await assert.rejects(service.update(product.id, { stock: -1 }));
      assert.ok(entries.has(key));
    },
  );
  await t.test("invalidation failure cannot undo successful update/delete", async () => {
    failure = "DEL";
    assert.equal((await service.update(product.id, { stock: 8 })).stock, 8);
    await service.deleteById(product.id);
    assert.equal(await find(product.id), null);
    failure = "";
  });
  await t.test(
    "successful deletion removes cached product; missing products are not cached",
    async () => {
      const p = await service.create({
        sku: randomUUID(),
        name: "Delete",
        priceInMinorUnits: 1,
        stock: 0,
      });
      await service.findById(p.id);
      await service.deleteById(p.id);
      assert.equal(entries.has("product:v1:" + p.id), false);
      await assert.rejects(service.findById(p.id), { statusCode: 404 });
    },
  );
});

test("rate middleware follows authentication, precedes RBAC, emits safe 429 and fails open", async () => {
  let calls = 0;
  let allowed = true;
  let failure = false;
  const app = createApp({
    accessPolicy: createAccessPolicy(async () => ({
      subject: "verified-subject",
      roles: ["catalog_reader"],
      scopes: [],
    })),
    rateLimiter: rateLimit(
      {
        async consume(subject) {
          assert.equal(subject, "verified-subject");
          calls++;
          if (failure) throw new Error("private");
          return { allowed, retryAfter: 12 };
        },
      },
      quiet,
    ),
    productRepository: new InMemoryProductRepository(),
    categoryRepository: new InMemoryCategoryRepository(),
    checkReady: async () => {},
  });
  const server = createServer(app).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/v1/products`;
  const headers = { Authorization: "Bearer a.b.c", "X-User-ID": "untrusted" };
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal(calls, 0);
    assert.equal((await fetch(url, { headers })).status, 200);
    assert.equal((await fetch(url, { headers, method: "POST" })).status, 403);
    allowed = false;
    const limited = await fetch(url, { headers });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "12");
    assert.deepEqual(await limited.json(), { error: { message: "Too many requests" } });
    failure = true;
    assert.equal((await fetch(url, { headers })).status, 200);
    assert.equal((await fetch(url, { headers, method: "POST" })).status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Redis configuration validates positive bounded integers and isolates test keys", () => {
  loadEnv();
  const keys = [
    "NODE_ENV",
    "REDIS_URL",
    "PRODUCT_CACHE_TTL_SECONDS",
    "RATE_LIMIT_WINDOW_SECONDS",
    "RATE_LIMIT_MAX_REQUESTS",
  ];
  const saved = keys.map((key) => process.env[key]);
  try {
    keys.forEach((key) => delete process.env[key]);
    process.env.NODE_ENV = "test";
    const config = loadRedisConfig();
    assert.equal(config.productTtlSeconds, 60);
    assert.equal(config.rateMaxRequests, 100);
    assert.match(config.keyPrefix, /^test:/);
    for (const key of keys.slice(2)) {
      for (const value of ["0", "-1", "1.5", "1e2", "9007199254740992"]) {
        process.env[key] = value;
        assert.throws(loadRedisConfig);
      }
      delete process.env[key];
    }
    process.env.REDIS_URL = "http://localhost";
    assert.throws(loadRedisConfig);
  } finally {
    keys.forEach((key, i) => {
      const v = saved[i];
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    });
  }
});

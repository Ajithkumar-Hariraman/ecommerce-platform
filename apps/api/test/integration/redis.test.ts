import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createRedisResources } from "../../src/database/redis.js";
import { RedisProductCache } from "../../src/modules/products/redis-product.cache.js";
import { RedisRateLimiter, rateLimit } from "../../src/middleware/rate-limit.js";
import { ProductService } from "../../src/modules/products/product.service.js";
import { PostgresProductRepository } from "../../src/modules/products/postgres-product.repository.js";
import { PostgresCategoryRepository } from "../../src/modules/categories/postgres-category.repository.js";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { createApp } from "../../src/app.js";
import { createAccessPolicy } from "../../src/auth/middleware.js";
import { createOidcVerifier } from "../../src/auth/oidc.js";

const url = "redis://127.0.0.1:6381";
const quiet = () => {};
test("real Redis cache, PostgreSQL source of truth and distributed atomic counters", async (t) => {
  const prefix = `test:${randomUUID()}:`;
  const a = await createRedisResources(url);
  const b = await createRedisResources(url);
  const pool = createPool(loadDatabaseConfig("test"));
  const repo = new PostgresProductRepository(pool);
  const categories = new PostgresCategoryRepository(pool);
  let reads = 0;
  const find = repo.findById.bind(repo);
  repo.findById = async (id) => {
    reads++;
    return find(id);
  };
  const cache = new RedisProductCache(a.commands, 2, prefix);
  const service = new ProductService(repo, categories, cache);
  const ids: string[] = [];
  const keys: string[] = [];
  const key = (id: string) => prefix + "product:v1:" + id;
  const rateKey = (subject: string) =>
    prefix + "rate:v1:" + createHash("sha256").update(subject).digest("hex") + ":api";
  try {
    assert.equal(await a.commands.command(["PING"]), "PONG");
    assert.equal(
      (await pool.query("SELECT current_database() AS name")).rows[0].name,
      "ecommerce_test",
    );
    const product = await service.create({
      sku: "REDIS-" + randomUUID(),
      name: "Redis integration",
      priceInMinorUnits: 100,
      stock: 1,
    });
    ids.push(product.id);
    keys.push(key(product.id));
    await t.test(
      "cache miss writes with TTL; cache hit avoids PostgreSQL; expiry reloads",
      async () => {
        assert.equal(await a.commands.command(["GET", key(product.id)]), null);
        assert.deepEqual(await service.findById(product.id), product);
        assert.equal(reads, 1);
        assert.ok(Number(await a.commands.command(["TTL", key(product.id)])) > 0);
        assert.deepEqual(await service.findById(product.id), product);
        assert.equal(reads, 1);
        await delay(2100);
        assert.equal(await a.commands.command(["GET", key(product.id)]), null);
        await service.findById(product.id);
        assert.equal(reads, 2);
      },
    );
    await t.test(
      "corrupt entry rebuilt; update invalidates then next read repopulates",
      async () => {
        await a.commands.command(["SET", key(product.id), "{bad", "EX", "10"]);
        assert.deepEqual(await service.findById(product.id), product);
        await service.update(product.id, { stock: 2 });
        assert.equal(await a.commands.command(["GET", key(product.id)]), null);
        assert.equal((await service.findById(product.id)).stock, 2);
        assert.ok(await a.commands.command(["GET", key(product.id)]));
      },
    );
    await t.test("two independent Redis connections share one atomic fixed window", async () => {
      const subject = randomUUID();
      const other = randomUUID();
      keys.push(rateKey(subject), rateKey(other));
      const limiters = [
        new RedisRateLimiter(a.commands, 2, 5, prefix),
        new RedisRateLimiter(b.commands, 2, 5, prefix),
      ];
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, i) => limiters[i % 2]!.consume(subject)),
      );
      assert.equal(results.filter((r) => r.allowed).length, 5);
      assert.ok(results.every((r) => r.retryAfter > 0));
      assert.equal(await a.commands.command(["GET", rateKey(subject)]), "40");
      assert.equal((await limiters[0]!.consume(other)).allowed, true);
      assert.ok(Number(await a.commands.command(["TTL", rateKey(subject)])) > 0);
      await delay(2100);
      assert.equal((await limiters[1]!.consume(subject)).allowed, true);
    });
    await t.test(
      "real disconnected Redis GET/SET/DEL failures preserve database operations",
      async () => {
        await b.close();
        const disconnected = new RedisProductCache(b.commands, 60, prefix, quiet);
        const degraded = new ProductService(repo, categories, disconnected);
        assert.equal((await degraded.findById(product.id)).stock, 2);
        assert.equal((await degraded.update(product.id, { stock: 3 })).stock, 3);
        await degraded.deleteById(product.id);
        assert.equal(await find(product.id), null);
      },
    );
  } finally {
    try {
      if (keys.length) await a.commands.command(["DEL", ...keys]);
    } finally {
      await Promise.all([
        a.close(),
        b.close(),
        pool.query("DELETE FROM products WHERE id=ANY($1::uuid[])", [ids]).then(() => pool.end()),
      ]);
    }
  }
});

test(
  "real Keycloak HTTP cache and rate limit smoke",
  { skip: !process.env.OIDC_TEST_ISSUER },
  async () => {
    const prefix = `test:${randomUUID()}:`;
    const redis = await createRedisResources(url);
    const pool = createPool(loadDatabaseConfig("test"));
    const repo = new PostgresProductRepository(pool);
    const categories = new PostgresCategoryRepository(pool);
    const ids: string[] = [];
    const subjects: string[] = [];
    const issuer = process.env.OIDC_TEST_ISSUER!;
    const tokens: Record<string, string> = {};
    let server: ReturnType<typeof createServer> | undefined;
    try {
      const verifier = await createOidcVerifier({
        enabled: true,
        issuer,
        audience: "ecommerce-api",
      });
      for (const name of ["manager", "reader"]) {
        const secret = process.env[`ECOMMERCE_${name.toUpperCase()}_CLIENT_SECRET`];
        assert.ok(secret);
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
        subjects.push((await verifier(tokens[name]!)).subject);
      }
      let reads = 0;
      const find = repo.findById.bind(repo);
      repo.findById = async (id) => {
        reads++;
        return find(id);
      };
      const service = new ProductService(repo, categories);
      const product = await service.create({
        sku: "REDIS-HTTP-" + randomUUID(),
        name: "HTTP cache",
        priceInMinorUnits: 100,
        stock: 1,
      });
      ids.push(product.id);
      const cache = new RedisProductCache(redis.commands, 60, prefix);
      const limiter = new RedisRateLimiter(redis.commands, 60, 3, prefix);
      server = createServer(
        createApp({
          accessPolicy: createAccessPolicy(verifier),
          productRepository: repo,
          categoryRepository: categories,
          productCache: cache,
          rateLimiter: rateLimit(limiter, quiet),
          checkReady: async () => {
            await pool.query("SELECT 1");
          },
        }),
      ).listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}`;
      const path = "/api/v1/products/" + product.id;
      const key = prefix + "product:v1:" + product.id;
      const call = (name = "reader", method = "GET", body?: unknown) =>
        fetch(base + path, {
          method,
          headers: { Authorization: "Bearer " + tokens[name], "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      assert.equal((await fetch(base + path)).status, 401);
      assert.equal(await redis.commands.command(["GET", key]), null);
      assert.equal((await call()).status, 200);
      assert.ok(await redis.commands.command(["GET", key]));
      assert.ok(Number(await redis.commands.command(["TTL", key])) > 0);
      const afterMiss = reads;
      assert.equal((await call()).status, 200);
      assert.equal(reads, afterMiss);
      assert.equal((await call()).status, 200);
      const blocked = await call();
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get("retry-after")) > 0);
      assert.equal((await call("manager", "PUT", { stock: 2 })).status, 200);
      assert.equal(await redis.commands.command(["GET", key]), null);
      assert.equal((await call("manager")).status, 200);
      assert.equal(JSON.parse(String(await redis.commands.command(["GET", key]))).stock, 2);
      assert.equal((await call("manager", "DELETE")).status, 204);
      assert.equal(await redis.commands.command(["GET", key]), null);
      for (const subject of subjects)
        assert.ok(
          Number(
            await redis.commands.command([
              "TTL",
              prefix + "rate:v1:" + createHash("sha256").update(subject).digest("hex") + ":api",
            ]),
          ) > 0,
        );
      // Actual socket closure, not an in-process fake; authenticated requests fail open.
      await redis.close();
      assert.equal(
        (
          await fetch(base + "/api/v1/products", {
            headers: { Authorization: "Bearer " + tokens.reader },
          })
        ).status,
        200,
      );
      assert.equal((await fetch(base + "/ready")).status, 200);
      assert.equal((await fetch(base + "/health")).status, 200);
      console.info(
        "Real Redis/Keycloak HTTP: cache miss/hit/TTL/update/delete PASS; reader 200,200,200,429; manager independent; Redis outage/readiness PASS",
      );
    } finally {
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      const cleanup = await createRedisResources(url);
      try {
        const keys = [
          ...ids.map((id) => prefix + "product:v1:" + id),
          ...subjects.map(
            (subject) =>
              prefix + "rate:v1:" + createHash("sha256").update(subject).digest("hex") + ":api",
          ),
        ];
        if (keys.length) await cleanup.commands.command(["DEL", ...keys]);
        await pool.query("DELETE FROM products WHERE id=ANY($1::uuid[])", [ids]);
      } finally {
        await Promise.all([cleanup.close(), redis.close(), pool.end()]);
      }
    }
  },
);

test("Redis command deadline recovers a stalled connection and startup outage closes promptly", async () => {
  const resource = await createRedisResources(url, quiet);
  const key = `test:${randomUUID()}:blocked`;
  try {
    const started = Date.now();
    // Blocks only this connection on a unique empty key, never the Redis server.
    await assert.rejects(resource.commands.command(["BLPOP", key, "5"]));
    assert.ok(Date.now() - started < 2000);
    let recovered = false;
    for (let i = 0; i < 30; i++) {
      try {
        recovered = (await resource.commands.command(["PING"])) === "PONG";
      } catch {
        /* reconnecting */
      }
      if (recovered) break;
      await delay(100);
    }
    assert.equal(recovered, true);
  } finally {
    await resource.close();
  }
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const started = Date.now();
  const unavailable = await createRedisResources(`redis://127.0.0.1:${address.port}`, quiet);
  await assert.rejects(unavailable.commands.command(["GET", key]));
  await unavailable.close();
  assert.ok(Date.now() - started < 3000);
});

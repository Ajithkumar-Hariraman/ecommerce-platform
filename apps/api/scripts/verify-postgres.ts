// Explicit developer smoke check against ecommerce_dev; NOT an automated integration test.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { loadDatabaseConfig } from "../src/config/env.js";
import { createPool } from "../src/database/pool.js";

const config = loadDatabaseConfig();
if (config.database !== "ecommerce_dev")
  throw new Error("Manual verification requires ecommerce_dev");
const pool = createPool(config);
const ids: string[] = [];
const probe = createServer().listen(0, "127.0.0.1");
await once(probe, "listening");
const address = probe.address();
assert(address && typeof address !== "string");
const port = address.port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://127.0.0.1:${port}`;
let running: ReturnType<typeof start> | undefined;
function start() {
  const child = spawn("npm", ["run", "dev"], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data.toString();
  });
  child.stderr.on("data", (data) => {
    output += data.toString();
  });
  const exited = once(child, "exit");
  return { child, exited, output: () => output };
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    if (running?.output().includes("API listening")) return;
    if (running?.child.exitCode !== null)
      throw new Error("Development startup failed");
    await delay(50);
  }
  throw new Error("Development startup timeout");
}
async function stop() {
  if (!running) return;
  if (running.child.pid) process.kill(-running.child.pid, "SIGTERM");
  await running.exited;
  await delay(200);
  console.log(running.output().trim());
  running = undefined;
}
async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(base + path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  console.log(method, path, response.status, JSON.stringify(data));
  return { status: response.status, data };
}

try {
  console.log(
    "CONNECTION",
    (
      await pool.query(`SELECT current_database() AS database,
    current_user AS role, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user`)
    ).rows,
  );
  console.log(
    "DATABASE OWNERS",
    (
      await pool.query(`SELECT datname, pg_get_userbyid(datdba) AS owner
    FROM pg_database WHERE datname IN ('ecommerce_dev','ecommerce_test') ORDER BY datname`)
    ).rows,
  );
  console.log(
    "COLUMNS",
    (
      await pool.query(`SELECT column_name,data_type,is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' ORDER BY ordinal_position`)
    ).rows,
  );
  console.log(
    "CONSTRAINTS",
    (
      await pool.query(`SELECT conname,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid='public.products'::regclass ORDER BY conname`)
    ).rows,
  );
  console.log(
    "INDEXES",
    (
      await pool.query(
        "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='products'",
      )
    ).rows,
  );
  running = start();
  await ready();
  assert.equal((await call("GET", "/health")).status, 200);
  assert.equal((await call("GET", "/ready")).status, 200);
  const body = {
    sku: "MANUAL-" + randomUUID(),
    name: "Coffee",
    priceInMinorUnits: 49999,
    stock: 2,
  };
  const created = await call("POST", "/api/v1/products", body);
  assert.equal(created.status, 201);
  ids.push(created.data.id);
  console.log(
    "INSERTED SQL ROW",
    (await pool.query("SELECT * FROM products WHERE id=$1", [ids[0]])).rows,
  );
  await stop();
  running = start();
  await ready();
  const path = "/api/v1/products/" + ids[0];
  assert.equal((await call("GET", path)).status, 200);
  assert.equal((await call("POST", "/api/v1/products", body)).status, 409);
  assert.equal(
    (await call("PUT", path, { stock: 8, status: "INACTIVE" })).status,
    200,
  );
  console.log(
    "UPDATED SQL ROW",
    (await pool.query("SELECT * FROM products WHERE id=$1", [ids[0]])).rows,
  );
  assert.equal((await call("PUT", path, { stock: -1 })).status, 400);
  assert.equal((await call("GET", "/api/v1/products")).status, 200);
  await pool.query("ANALYZE public.products");
  console.log(
    "EXPLAIN SKU",
    (
      await pool.query("EXPLAIN SELECT * FROM products WHERE sku=$1", [
        body.sku,
      ])
    ).rows,
  );
  console.log(
    "EXPLAIN ID",
    (await pool.query("EXPLAIN SELECT * FROM products WHERE id=$1", [ids[0]]))
      .rows,
  );
  assert.equal((await call("DELETE", path)).status, 204);
  console.log(
    "DELETED SQL COUNT",
    (await pool.query("SELECT count(*) FROM products WHERE id=$1", [ids[0]]))
      .rows,
  );
  assert.equal((await call("GET", path)).status, 404);
  assert.equal((await call("GET", "/unknown")).status, 404);
} finally {
  await stop();
  try {
    await pool.query("DELETE FROM products WHERE id=ANY($1::uuid[])", [ids]);
  } finally {
    await pool.end();
  }
}

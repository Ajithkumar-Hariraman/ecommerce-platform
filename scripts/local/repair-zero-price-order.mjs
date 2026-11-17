// Opt-in, existing local PostgreSQL + simulator only; preserves Order/payment/line IDs.
import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const { Client } = require("pg");
const id = process.argv[2];
assert.match(id ?? "", /^[a-f0-9-]{36}$/);
assert.ok(!process.env.NODE_ENV || process.env.NODE_ENV === "development");
loadEnvFile(new URL("../../infra/.env", import.meta.url));
const docker = ["compose", "--env-file", "infra/.env", "-f", "infra/compose.yaml"];
const runtime = JSON.parse(
  execFileSync(
    "docker",
    [
      ...docker,
      "exec",
      "-T",
      "api",
      "node",
      "-e",
      `console.log(JSON.stringify({db:process.env.DB_NAME,storage:process.env.BUSINESS_STORAGE??process.env.ORDER_STORAGE,provider:process.env.PAYMENT_PROVIDER??'local',env:process.env.NODE_ENV}))`,
    ],
    { encoding: "utf8" },
  ),
);
assert.deepEqual(runtime, {
  db: "ecommerce_dev",
  storage: "postgres",
  provider: "local",
  env: "development",
});
const client = new Client({
  host: "127.0.0.1",
  port: 5433,
  database: "ecommerce_dev",
  user: "ecommerce_app",
  password: process.env.DB_PASSWORD,
  ssl: false,
});
try {
  await client.connect();
  await client.query("BEGIN");
  assert.equal(
    (await client.query("SELECT current_database() AS name")).rows[0].name,
    "ecommerce_dev",
  );
  const order = (await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [id])).rows[0];
  assert.ok(order);
  assert.equal(order.status, "PAYMENT_PENDING");
  assert.equal(Number(order.total_in_minor_units), 0);
  const rows = (
    await client.query(
      "SELECT i.*, p.name, p.status AS product_status, p.stock, p.price_in_minor_units FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=$1 FOR UPDATE OF i,p",
      [id],
    )
  ).rows;
  assert.ok(rows.length > 0);
  assert.equal(
    rows.length,
    (await client.query("SELECT count(*) FROM order_items WHERE order_id=$1", [id])).rows[0].count *
      1,
  );
  const quantities = new Map();
  let total = 0;
  for (const row of rows) {
    assert.equal(Number(row.unit_price_in_minor_units), 0);
    assert.equal(Number(row.line_total_in_minor_units), 0);
    assert.equal(row.product_status, "ACTIVE");
    assert.ok(row.quantity > 0);
    quantities.set(row.product_id, (quantities.get(row.product_id) ?? 0) + row.quantity);
    assert.ok(quantities.get(row.product_id) <= row.stock);
    const price = Number(row.price_in_minor_units);
    assert.ok(Number.isSafeInteger(price) && price > 0);
    total += row.quantity * price;
    assert.ok(Number.isSafeInteger(total));
  }
  console.log(
    JSON.stringify({
      orderId: id,
      paymentId: order.payment_id,
      previousTotal: 0,
      newTotalInMinorUnits: total,
      lines: rows.length,
      apply: process.argv.includes("--apply"),
    }),
  );
  if (process.argv.includes("--apply")) {
    // Private recovery snapshot, no credentials. Never touches a finalized provider payment.
    const snapshot = "/tmp/ecommerce-zero-price-" + id + ".json";
    if (!existsSync(snapshot))
      writeFileSync(snapshot, JSON.stringify({ order, rows, total }, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
    const code = `const {DatabaseSync}=require('node:sqlite'); const assert=require('node:assert/strict'); const v=JSON.parse(process.argv[1]); const db=new DatabaseSync(process.env.PAYMENT_DATABASE_PATH); db.exec('BEGIN IMMEDIATE'); try { const row=db.prepare('SELECT * FROM payments WHERE payment_id=?').get(v.payment); assert.equal(row.order_id,v.order); assert.equal(row.idempotency_key,'payment:'+v.order); assert.equal(row.event_id,null); assert.equal(row.event_type,null); assert.ok(row.amount===0||row.amount===v.total); db.prepare('UPDATE payments SET amount=? WHERE payment_id=? AND event_id IS NULL').run(v.total,v.payment); db.exec('COMMIT'); console.log('Pending simulator amount corrected; payment identity retained'); } catch(e){db.exec('ROLLBACK');throw e;} finally{db.close();}`;
    execFileSync(
      "docker",
      [
        ...docker,
        "exec",
        "-T",
        "payment-provider",
        "node",
        "-e",
        code,
        JSON.stringify({ order: id, payment: order.payment_id, total }),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    for (const row of rows)
      await client.query(
        "UPDATE order_items SET unit_price_in_minor_units=$1,line_total_in_minor_units=$2,product_name=$3 WHERE id=$4 AND order_id=$5",
        [
          row.price_in_minor_units,
          row.quantity * Number(row.price_in_minor_units),
          row.name,
          row.id,
          id,
        ],
      );
    await client.query(
      "UPDATE orders SET total_in_minor_units=$1,version=version+1,updated_at=now() WHERE id=$2",
      [total, id],
    );
    await client.query("COMMIT");
    console.log(
      "PASS: existing Order and simulator payment repriced in place; no payment completed.",
    );
  } else await client.query("ROLLBACK");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(
    "Repair refused/failed. Existing identities retained. If provider correction succeeded before DB commit failure, retry after reviewing the private recovery snapshot.",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}

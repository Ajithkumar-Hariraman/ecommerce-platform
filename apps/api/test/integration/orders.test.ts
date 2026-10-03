import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { createMongoResources } from "../../src/database/mongo.js";
import { ensureOrderIndexes } from "../../src/modules/orders/mongo-order.indexes.js";
import { MongoOrderRepository } from "../../src/modules/orders/mongo-order.repository.js";
import { PostgresOrderRepository } from "../../src/modules/orders/postgres-order.repository.js";
import type { OrderRepository } from "../../src/modules/orders/order.repository.js";
import type { Order } from "../../src/modules/orders/order.types.js";

function order(): Order {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    customerId: randomUUID(),
    status: "CREATED",
    paymentId: null,
    totalInMinorUnits: 400,
    version: 1,
    createdAt: now,
    updatedAt: now,
    items: [
      {
        productId: randomUUID(),
        quantity: 2,
        unitPriceInMinorUnits: 100,
        lineTotalInMinorUnits: 200,
      },
      {
        productId: randomUUID(),
        quantity: 1,
        unitPriceInMinorUnits: 200,
        lineTotalInMinorUnits: 200,
      },
    ],
  };
}
function normalized(value: Order | null) {
  return (
    value && {
      ...value,
      items: [...value.items].sort((a, b) => a.productId.localeCompare(b.productId)),
    }
  );
}
async function contract(repository: OrderRepository, input: Order) {
  assert.equal(await repository.findById(input.id), null);
  await repository.save(input);
  assert.deepEqual(normalized(await repository.findById(input.id)), normalized(input));
  await assert.rejects(repository.save(input));
  const updated = {
    ...input,
    status: "PAID" as const,
    paymentId: randomUUID(),
    version: 2,
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  };
  await repository.update({ ...updated, items: [], totalInMinorUnits: 0 });
  assert.deepEqual(normalized(await repository.findById(input.id)), normalized(updated));
  await assert.rejects(repository.update(updated), { statusCode: 409 });
  await assert.rejects(repository.update({ ...updated, id: randomUUID() }), { statusCode: 409 });
  const results = await Promise.allSettled([
    repository.update({ ...updated, version: 3, status: "SHIPPED" }),
    repository.update({ ...updated, version: 3, status: "PROCESSING" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
}

test("PostgreSQL Order contract, atomic save rollback and cascading owned cleanup", async () => {
  const config = loadDatabaseConfig("test");
  assert.equal(config.database, "ecommerce_test");
  const pool = createPool(config);
  const repository = new PostgresOrderRepository(pool);
  const input = order();
  const invalid = order();
  invalid.items[1]!.quantity = 0;
  try {
    await contract(repository, input);
    await assert.rejects(repository.save(invalid));
    assert.equal(await repository.findById(invalid.id), null);
    assert.equal(
      (await pool.query("SELECT count(*) FROM order_items WHERE order_id=$1", [invalid.id])).rows[0]
        .count,
      "0",
    );
    await pool.query("DELETE FROM orders WHERE id=$1", [input.id]);
    assert.equal(
      (await pool.query("SELECT count(*) FROM order_items WHERE order_id=$1", [input.id])).rows[0]
        .count,
      "0",
    );
  } finally {
    try {
      await pool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])", [[input.id, invalid.id]]);
    } finally {
      await pool.end();
    }
  }
});

test(
  "MongoDB Order contract and named indexes",
  { skip: !process.env.MONGODB_TEST_URI },
  async () => {
    const resources = await createMongoResources(process.env.MONGODB_TEST_URI!, "ecommerce_test");
    const input = order();
    try {
      assert.equal(resources.db.databaseName, "ecommerce_test");
      await ensureOrderIndexes(resources.db);
      await contract(new MongoOrderRepository(resources.db), input);
      const document = await resources.db
        .collection<{ _id: string; createdAt: Date }>("orders")
        .findOne({ _id: input.id });
      assert.ok(document?.createdAt instanceof Date);
      const names = (await resources.db.collection("orders").indexes()).map((index) => index.name);
      assert.ok(names.includes("orders_customer_created_idx"));
      assert.ok(names.includes("orders_status_created_idx"));
    } finally {
      try {
        await resources.db.collection<{ _id: string }>("orders").deleteOne({ _id: input.id });
      } finally {
        await resources.client.close();
      }
    }
  },
);

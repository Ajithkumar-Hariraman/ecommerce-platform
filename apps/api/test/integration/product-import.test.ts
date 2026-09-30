import assert from "node:assert/strict";
import test from "node:test";
import { verifyImport } from "../helpers/import-contract.js";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { PostgresProductRepository } from "../../src/modules/products/postgres-product.repository.js";
import { PostgresCategoryRepository } from "../../src/modules/categories/postgres-category.repository.js";
test("PostgreSQL CSV import persists statuses and isolates row failures", async () => {
  const config = loadDatabaseConfig("test");
  assert.equal(config.database, "ecommerce_test");
  const pool = createPool(config);
  try {
    assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "ecommerce_test");
    await verifyImport(new PostgresProductRepository(pool), new PostgresCategoryRepository(pool));
  } finally { await pool.end(); }
});

import { Pool } from "pg";
import type { DatabaseConfig } from "../config/env.js";

export function createPool(config: DatabaseConfig): Pool {
  const pool = new Pool({
    ...config,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
    query_timeout: 6000,
    application_name: "ecommerce-api",
  });
  pool.on("error", (error) => {
    // Do not log connection config, SQL parameters, or database error detail.
    console.error("Idle PostgreSQL connection failed", { name: error.name });
  });
  return pool;
}

export async function verifyDatabase(pool: Pool): Promise<void> {
  // Checks connectivity AND the migrated table/columns. Does not create schema.
  await pool.query(`SELECT id, sku, name, description, price_in_minor_units,
    stock, status, created_at, updated_at FROM public.products LIMIT 0`);
}

import { randomUUID } from "node:crypto";
import { loadDatabaseConfig } from "../config/env.js";
import { createPool } from "./pool.js";
async function main() {
  const config = loadDatabaseConfig();
  if (
    config.database !== "ecommerce_prod" ||
    !config.ssl ||
    !config.host.endsWith(".rds.amazonaws.com")
  )
    throw new Error("Seed requires verified AWS RDS ecommerce_prod");
  const pool = createPool(config);
  try {
    await pool.query(
      `INSERT INTO products(id,sku,name,description,price_in_minor_units,stock,status,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',now(),now()) ON CONFLICT(sku) DO NOTHING`,
      [
        randomUUID(),
        "CLASSIC-EVERYDAY-TOTE",
        "Classic Everyday Tote",
        "A durable everyday tote for your daily essentials.",
        79900,
        100,
      ],
    );
    console.info({ operation: "aws-safe-seed", outcome: "complete" });
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error({ operation: "aws-safe-seed", outcome: "failed" });
  process.exitCode = 1;
});

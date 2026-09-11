import { PostgresCategoryRepository } from "./modules/categories/postgres-category.repository.js";
import { createApp } from "./app.js";
import { loadEnv, loadDatabaseConfig } from "./config/env.js";
import { createPool, verifyDatabase } from "./database/pool.js";
import { PostgresProductRepository } from "./modules/products/postgres-product.repository.js";
import { startServer } from "./lifecycle.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(
    loadDatabaseConfig(env.nodeEnv === "test" ? "test" : "application"),
  );
  try {
    await verifyDatabase(pool);
  } catch {
    await pool.end();
    throw new Error(
      "Database startup check failed; verify configuration and run migrations",
    );
  }
  const app = createApp({
    productRepository: new PostgresProductRepository(pool),
    categoryRepository: new PostgresCategoryRepository(pool),
    checkReady: () => verifyDatabase(pool),
  });
  await startServer(app, env, async () => {
    await pool.end();
    console.info("PostgreSQL pool closed.");
  });
}

main().catch((error: unknown) => {
  console.error(
    "API startup failed",
    error instanceof Error ? error.message : "Unknown failure",
  );
  process.exitCode = 1;
});

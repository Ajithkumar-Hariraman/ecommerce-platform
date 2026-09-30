import { HttpPaymentClient } from "./modules/payments/payment.client.js";
import { PostgresPaymentWorkflowRepository } from "./modules/payments/postgres-payment.repositories.js";
import { MongoPaymentWorkflowRepository, ensurePaymentIndexes } from "./modules/payments/mongo-payment.repositories.js";
import type { PaymentWorkflowRepository } from "./modules/payments/payment-workflow.js";
import { createMongoResources } from "./database/mongo.js";
import type { MongoResources } from "./database/mongo.js";
import { ensureOrderIndexes } from "./modules/orders/mongo-order.indexes.js";
import { MongoOrderRepository } from "./modules/orders/mongo-order.repository.js";
import { PostgresOrderRepository } from "./modules/orders/postgres-order.repository.js";
import type { OrderRepository } from "./modules/orders/order.repository.js";
import { PostgresCategoryRepository } from "./modules/categories/postgres-category.repository.js";
import { createApp } from "./app.js";
import { loadEnv, loadDatabaseConfig, loadOrderStorageConfig, loadPaymentConfig } from "./config/env.js";
import { createPool, verifyDatabase } from "./database/pool.js";
import { PostgresProductRepository } from "./modules/products/postgres-product.repository.js";
import { startServer } from "./lifecycle.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(
    loadDatabaseConfig(env.nodeEnv === "test" ? "test" : "application"),
  );
  let mongo: MongoResources | undefined;
  let closed = false;
  const closeResources = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    const results = await Promise.allSettled([
      pool.end().then(() => { console.info("PostgreSQL pool closed."); }),
      ...(mongo ? [mongo.client.close().then(() => { console.info("MongoDB client closed."); })] : []),
    ]);
    if (results.some(result => result.status === "rejected")) throw new Error("Resource shutdown failed");
  };
  try {
    const orderConfig = loadOrderStorageConfig();
    const paymentConfig = loadPaymentConfig();
    try { await verifyDatabase(pool); }
    catch { throw new Error("Database startup check failed; verify configuration and run migrations"); }
    let orderRepository: OrderRepository;
    let paymentWorkflow: PaymentWorkflowRepository;
    if (orderConfig.storage === "mongodb") {
      mongo = await createMongoResources(orderConfig.uri, orderConfig.databaseName);
      try { await ensureOrderIndexes(mongo.db); await ensurePaymentIndexes(mongo.db); }
      catch { throw new Error("MongoDB index initialization failed"); }
      orderRepository = new MongoOrderRepository(mongo.db);
      paymentWorkflow = new MongoPaymentWorkflowRepository(mongo.db);
    } else {
      await pool.query("SELECT id, version FROM public.orders LIMIT 0");
      await pool.query("SELECT order_id FROM public.order_items LIMIT 0");
      await pool.query("SELECT id FROM order_status_history LIMIT 0");
      await pool.query("SELECT event_id FROM processed_webhook_events LIMIT 0");
      orderRepository = new PostgresOrderRepository(pool);
      paymentWorkflow = new PostgresPaymentWorkflowRepository(pool);
    }
    const app = createApp({
      productRepository: new PostgresProductRepository(pool),
      categoryRepository: new PostgresCategoryRepository(pool),
      orderRepository,
      paymentClient: new HttpPaymentClient(paymentConfig.baseUrl),
      paymentWorkflow,
      paymentWebhookSecret: paymentConfig.webhookSecret,
      checkReady: async () => {
        await verifyDatabase(pool);
        if (mongo) await mongo.db.command({ ping: 1 });
      },
    });
    await startServer(app, env, closeResources);
  } catch (error) {
    await closeResources();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(
    "API startup failed",
    error instanceof Error ? error.message : "Unknown failure",
  );
  process.exitCode = 1;
});

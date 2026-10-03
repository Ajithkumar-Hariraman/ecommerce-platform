import { createHash } from "node:crypto";
import { loadBusinessStorageConfig, loadDatabaseConfig, loadEnv } from "../config/env.js";
import { createPool, verifyDatabase } from "./pool.js";
import { createMongoResources } from "./mongo.js";
import { PostgresProductRepository } from "../modules/products/postgres-product.repository.js";
import {
  MongoProductRepository,
  ensureProductIndexes,
} from "../modules/products/mongo-product.repository.js";
import { PostgresCategoryRepository } from "../modules/categories/postgres-category.repository.js";
import {
  MongoCategoryRepository,
  ensureCategoryIndexes,
} from "../modules/categories/mongo-category.repository.js";
import { PostgresOrderRepository } from "../modules/orders/postgres-order.repository.js";
import { MongoOrderRepository } from "../modules/orders/mongo-order.repository.js";
import { ensureOrderIndexes } from "../modules/orders/mongo-order.indexes.js";
import { PostgresPaymentWorkflowRepository } from "../modules/payments/postgres-payment.repositories.js";
import {
  MongoPaymentWorkflowRepository,
  ensurePaymentIndexes,
} from "../modules/payments/mongo-payment.repositories.js";
import { PostgresCheckoutRepository } from "../modules/payments/postgres-checkout.repository.js";
import {
  MongoCheckoutRepository,
  ensureCheckoutIndexes,
} from "../modules/payments/mongo-checkout.repository.js";
import { PostgresOutboxRepository } from "../outbox/postgres-outbox.repository.js";
import { MongoOutboxRepository } from "../outbox/mongo-outbox.repository.js";
import { PostgresOrderNotificationRepository } from "../events/order-notification.repository.js";
import {
  MongoOrderNotificationRepository,
  ensureNotificationIndexes,
} from "../events/mongo-order-notification.repository.js";

export async function createBusinessResources() {
  const config = loadBusinessStorageConfig();
  if (config.storage === "mongodb") {
    const mongo = await createMongoResources(config.uri, config.databaseName);
    try {
      await ensureCategoryIndexes(mongo.db);
      await ensureProductIndexes(mongo.db);
      await ensureOrderIndexes(mongo.db);
      await ensurePaymentIndexes(mongo.db);
      await ensureCheckoutIndexes(mongo.db);
      await ensureNotificationIndexes(mongo.db);
      return {
        storage: config.storage,
        cacheNamespace: `mongodb:${createHash("sha256")
          .update(config.uri + "/" + config.databaseName)
          .digest("hex")
          .slice(0, 16)}:`,
        products: new MongoProductRepository(mongo.db),
        categories: new MongoCategoryRepository(mongo.db),
        orders: new MongoOrderRepository(mongo.db),
        payments: new MongoPaymentWorkflowRepository(mongo.db),
        checkout: new MongoCheckoutRepository(mongo.db),
        outbox: new MongoOutboxRepository(mongo.db),
        notifications: new MongoOrderNotificationRepository(mongo.db),
        ready: async () => {
          await mongo.db.command({ ping: 1 });
        },
        close: () => mongo.client.close(),
      };
    } catch (error) {
      await mongo.client.close();
      throw error;
    }
  }
  const db = loadDatabaseConfig(loadEnv().nodeEnv === "test" ? "test" : "application");
  const pool = createPool(db);
  try {
    await verifyDatabase(pool);
    await pool.query("SELECT id FROM products LIMIT 0");
    await pool.query("SELECT id FROM categories LIMIT 0");
    await pool.query("SELECT id,version FROM orders LIMIT 0");
    await pool.query("SELECT order_id FROM order_items LIMIT 0");
    await pool.query("SELECT id FROM order_status_history LIMIT 0");
    await pool.query("SELECT event_id FROM processed_webhook_events LIMIT 0");
    await pool.query("SELECT event_id FROM outbox_events LIMIT 0");
    await pool.query("SELECT event_id FROM order_notifications LIMIT 0");
    await pool.query("SELECT order_id FROM razorpay_checkouts LIMIT 0");
    await pool.query("SELECT provider_payment_id FROM razorpay_payment_attempts LIMIT 0");
    await pool.query("SELECT provider_event_id FROM razorpay_webhook_events LIMIT 0");
    return {
      storage: config.storage,
      cacheNamespace: `postgres:${createHash("sha256").update(`${db.host}:${db.port}/${db.database}`).digest("hex").slice(0, 16)}:`,
      products: new PostgresProductRepository(pool),
      categories: new PostgresCategoryRepository(pool),
      orders: new PostgresOrderRepository(pool),
      payments: new PostgresPaymentWorkflowRepository(pool),
      checkout: new PostgresCheckoutRepository(pool),
      outbox: new PostgresOutboxRepository(pool),
      notifications: new PostgresOrderNotificationRepository(pool),
      ready: () => verifyDatabase(pool),
      close: () => pool.end(),
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

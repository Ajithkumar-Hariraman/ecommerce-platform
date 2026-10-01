import { kafkaClient, kafkaProducer, KafkaEventPublisher } from "./events/kafka.js";
import { PublishingPaymentWorkflow } from "./modules/payments/publishing-payment.workflow.js";
import { createRedisResources } from "./database/redis.js";
import { RedisProductCache } from "./modules/products/redis-product.cache.js";
import { rateLimit, RedisRateLimiter } from "./middleware/rate-limit.js";
import { createOidcVerifier } from "./auth/oidc.js";
import { createAccessPolicy, disabledAccessPolicy } from "./auth/middleware.js";
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
import { loadEnv, loadDatabaseConfig, loadOrderStorageConfig, loadPaymentConfig, loadAuthConfig, loadRedisConfig, loadKafkaConfig } from "./config/env.js";
import { createPool, verifyDatabase } from "./database/pool.js";
import { PostgresProductRepository } from "./modules/products/postgres-product.repository.js";
import { startServer } from "./lifecycle.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(
    loadDatabaseConfig(env.nodeEnv === "test" ? "test" : "application"),
  );
  let mongo: MongoResources | undefined;
  let redis: Awaited<ReturnType<typeof createRedisResources>> | undefined;
  let redisTestPrefix = "";
  let producer: ReturnType<typeof kafkaProducer> | undefined;
  let closed = false;
  const closeResources = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (producer) {
      try { await producer.disconnect(); console.info("Kafka producer disconnected."); }
      catch { console.warn("Kafka producer shutdown failed."); }
    }
    if (redis && redisTestPrefix) {
      try {
        let cursor = "0";
        do {
          const result = await redis.commands.command(["SCAN", cursor, "MATCH", redisTestPrefix + "*", "COUNT", "100"]) as [string, string[]];
          cursor = result[0];
          if (result[1].length) await redis.commands.command(["DEL", ...result[1]]);
        } while (cursor !== "0");
      } catch { console.warn("Test Redis cleanup unavailable; owned keys expire by TTL."); }
    }
    const results = await Promise.allSettled([
      ...(redis ? [redis.close().then(() => { console.info("Redis client closed."); })] : []),
      pool.end().then(() => { console.info("PostgreSQL pool closed."); }),
      ...(mongo ? [mongo.client.close().then(() => { console.info("MongoDB client closed."); })] : []),
    ]);
    if (results.some(result => result.status === "rejected")) throw new Error("Resource shutdown failed");
  };
  try {
    const authConfig = loadAuthConfig();
    const accessPolicy = authConfig.enabled ? createAccessPolicy(await createOidcVerifier(authConfig)) : disabledAccessPolicy();
    if (!authConfig.enabled) console.info("Authentication explicitly disabled for non-production runtime.");
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
    const kafkaConfig = loadKafkaConfig();
    producer = kafkaProducer(kafkaClient(kafkaConfig));
    try { await producer.connect(); }
    catch { console.warn("Kafka startup degraded; committed Order events may not publish."); }
    paymentWorkflow = new PublishingPaymentWorkflow(paymentWorkflow, new KafkaEventPublisher(producer, kafkaConfig.orderTopic));
    const redisConfig = loadRedisConfig();
    redis = await createRedisResources(redisConfig.url);
    redisTestPrefix = redisConfig.keyPrefix;
    const app = createApp({
      productCache: new RedisProductCache(redis.commands, redisConfig.productTtlSeconds, redisConfig.keyPrefix),
      rateLimiter: rateLimit(new RedisRateLimiter(redis.commands, redisConfig.rateWindowSeconds, redisConfig.rateMaxRequests, redisConfig.keyPrefix)),
      accessPolicy,
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

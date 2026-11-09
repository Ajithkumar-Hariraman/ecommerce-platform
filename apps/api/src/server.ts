import { createOrderDocuments } from "./post-purchase/runtime.js";
import {
  createImageStorage,
  GcsProductImageStore,
} from "./modules/products/gcs-product-image.store.js";
import { loadProductImageConfig } from "./config/env.js";
import { S3Client } from "@aws-sdk/client-s3";
import { S3ProductImageStore } from "./modules/products/s3-product-image.store.js";
import { RazorpayPaymentClient } from "./modules/payments/razorpay.gateway.js";
import { RazorpayHttpApi } from "./modules/payments/razorpay.api.js";
import { installStructuredLogging } from "./logging.js";
import { createRedisResources } from "./database/redis.js";
import { RedisProductCache } from "./modules/products/redis-product.cache.js";
import { rateLimit, RedisRateLimiter } from "./middleware/rate-limit.js";
import { createDeferredOidcVerifier } from "./auth/oidc.js";
import { createAccessPolicy, disabledAccessPolicy } from "./auth/middleware.js";
import { HttpPaymentClient } from "./modules/payments/payment.client.js";
import { createBusinessResources } from "./database/business.js";
import { createApp } from "./app.js";
import {
  loadEnv,
  loadPaymentConfig,
  loadAuthConfig,
  loadRedisConfig,
  loadDocsConfig,
  loadPaymentProvider,
  loadRazorpayConfig,
} from "./config/env.js";
import { startServer } from "./lifecycle.js";

installStructuredLogging();

async function main(): Promise<void> {
  const env = loadEnv();
  let business: Awaited<ReturnType<typeof createBusinessResources>> | undefined;
  let redis: Awaited<ReturnType<typeof createRedisResources>> | undefined;
  let redisTestPrefix = "";
  let closed = false;
  const closeResources = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (redis && redisTestPrefix) {
      try {
        let cursor = "0";
        do {
          const result = (await redis.commands.command([
            "SCAN",
            cursor,
            "MATCH",
            redisTestPrefix + "*",
            "COUNT",
            "100",
          ])) as [string, string[]];
          cursor = result[0];
          if (result[1].length) await redis.commands.command(["DEL", ...result[1]]);
        } while (cursor !== "0");
      } catch {
        console.warn("Test Redis cleanup unavailable; owned keys expire by TTL.");
      }
    }
    const results = await Promise.allSettled([
      ...(redis
        ? [
            redis.close().then(() => {
              console.info("Redis client closed.");
            }),
          ]
        : []),
      ...(business
        ? [
            business.close().then(() => {
              console.info(
                business!.storage === "postgres"
                  ? "PostgreSQL pool closed."
                  : "MongoDB client closed.",
              );
            }),
          ]
        : []),
    ]);
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Resource shutdown failed");
  };
  try {
    const authConfig = loadAuthConfig();
    const accessPolicy = authConfig.enabled
      ? createAccessPolicy(createDeferredOidcVerifier(authConfig))
      : disabledAccessPolicy();
    if (!authConfig.enabled)
      console.info("Authentication explicitly disabled for non-production runtime.");
    const provider = loadPaymentProvider();
    const paymentConfig = provider === "local" ? loadPaymentConfig() : undefined;
    const razorpayConfig = provider === "razorpay" ? loadRazorpayConfig() : undefined;
    business = await createBusinessResources();
    const redisConfig = loadRedisConfig();
    redis = await createRedisResources(redisConfig.url);
    redisTestPrefix = redisConfig.keyPrefix;
    const razorpay = razorpayConfig
      ? new RazorpayPaymentClient(
          business.checkout,
          new RazorpayHttpApi(
            razorpayConfig.keyId,
            razorpayConfig.keySecret,
            razorpayConfig.timeoutMs,
          ),
          razorpayConfig.keyId,
          razorpayConfig.keySecret,
          razorpayConfig.webhookSecret,
        )
      : undefined;
    const imageConfig = loadProductImageConfig();
    const productImages = imageConfig
      ? imageConfig.provider === "aws"
        ? new S3ProductImageStore(
            new S3Client({ region: imageConfig.region, maxAttempts: 2 }),
            imageConfig.bucket,
            imageConfig.ttlSeconds,
          )
        : new GcsProductImageStore(
            await createImageStorage(imageConfig),
            imageConfig.bucket,
            imageConfig.ttlSeconds,
          )
      : undefined;
    const app = createApp({
      postPurchase: business.postPurchase,
      orderDocuments: createOrderDocuments(business.orders, business.postPurchase),
      ...(productImages ? { productImages } : {}),
      ...(razorpay ? { razorpay } : {}),
      docsEnabled: loadDocsConfig(),
      productCache: new RedisProductCache(
        redis.commands,
        redisConfig.productTtlSeconds,
        redisConfig.keyPrefix + business.cacheNamespace,
      ),
      rateLimiter: rateLimit(
        new RedisRateLimiter(
          redis.commands,
          redisConfig.rateWindowSeconds,
          redisConfig.rateMaxRequests,
          redisConfig.keyPrefix,
        ),
      ),
      accessPolicy,
      productRepository: business.products,
      categoryRepository: business.categories,
      orderRepository: business.orders,
      paymentClient: razorpay ?? new HttpPaymentClient(paymentConfig!.baseUrl),
      paymentWorkflow: business.payments,
      ...(paymentConfig ? { paymentWebhookSecret: paymentConfig.webhookSecret } : {}),
      checkReady: business.ready,
    });
    await startServer(app, env, closeResources);
  } catch (error) {
    await closeResources();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error("API startup failed", error instanceof Error ? error.message : "Unknown failure");
  process.exitCode = 1;
});

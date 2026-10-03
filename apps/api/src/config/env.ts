import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Only this config layer reads application environment or loads local .env.
let loaded = false;
function loadLocalEnv(): void {
  if (loaded) return;
  try {
    loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw new Error("Unable to load local environment file");
    }
  }
  loaded = true;
}

export interface Env {
  readonly port: number;
  readonly host: string;
  readonly nodeEnv: "development" | "test" | "production";
}
export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}
function port(value: string, label: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error("Invalid " + label + ": expected integer 1–65535");
  }
  return Number(value);
}
export function loadEnv(): Env {
  loadLocalEnv();
  const host = process.env.HOST ?? "127.0.0.1";
  const nodeEnv = process.env.NODE_ENV ?? "development";
  if (host !== "localhost" && isIP(host) === 0)
    throw new Error("Invalid HOST: expected an IP address or localhost");
  if (nodeEnv !== "development" && nodeEnv !== "test" && nodeEnv !== "production") {
    throw new Error("Invalid NODE_ENV: expected development, test, or production");
  }
  return Object.freeze({
    port: port(process.env.PORT ?? "3000", "PORT"),
    host,
    nodeEnv,
  });
}
export function loadDatabaseConfig(target: "application" | "test" = "application"): DatabaseConfig {
  const env = loadEnv();
  if (target === "test" && env.nodeEnv === "production")
    throw new Error("Test database forbidden in production mode");
  const production = env.nodeEnv === "production";
  const host = process.env.DB_HOST ?? (production ? "" : "127.0.0.1");
  const database =
    target === "test"
      ? (process.env.DB_TEST_NAME ?? "ecommerce_test")
      : (process.env.DB_NAME ?? (production ? "" : "ecommerce_dev"));
  const user = process.env.DB_USER ?? (production ? "" : "ecommerce_app");
  const password = process.env.DB_PASSWORD ?? "";
  if (
    !host.trim() ||
    /\s/.test(host) ||
    !database.trim() ||
    !user.trim() ||
    !password ||
    password === "REPLACE_WITH_LOCAL_PASSWORD"
  ) {
    throw new Error(
      "Database configuration requires valid DB_HOST, DB_NAME, DB_USER and DB_PASSWORD",
    );
  }
  if (target === "test" && (database !== "ecommerce_test" || database === process.env.DB_NAME)) {
    throw new Error("Integration tests require a separate ecommerce_test database");
  }
  return {
    host,
    port: port(process.env.DB_PORT ?? "5432", "DB_PORT"),
    database,
    user,
    password,
  };
}

export type OrderStorageConfig =
  { storage: "postgres" } | { storage: "mongodb"; uri: string; databaseName: string };

export function loadBusinessStorageConfig(): OrderStorageConfig {
  const env = loadEnv();
  const storage = process.env.BUSINESS_STORAGE ?? process.env.ORDER_STORAGE ?? "postgres";
  if (storage === "postgres") return { storage };
  if (storage !== "mongodb")
    throw new Error("Invalid BUSINESS_STORAGE / ORDER_STORAGE: expected postgres or mongodb");
  const uri = process.env.MONGODB_URI ?? "";
  const databaseName = process.env.MONGODB_DB_NAME ?? "";
  if (
    !/^mongodb(?:\+srv)?:\/\//.test(uri) ||
    !databaseName.trim() ||
    /[\s/\\."$]/.test(databaseName)
  ) {
    throw new Error("MongoDB configuration requires a valid MONGODB_URI and MONGODB_DB_NAME");
  }
  if (env.nodeEnv === "test" && databaseName !== "ecommerce_test") {
    throw new Error("MongoDB tests require ecommerce_test");
  }
  return { storage, uri, databaseName };
}

// Compatibility alias; all runtimes resolve the same business selector.
export const loadOrderStorageConfig = loadBusinessStorageConfig;

export function loadPaymentProvider(): "local" | "razorpay" {
  loadLocalEnv();
  const value = process.env.PAYMENT_PROVIDER ?? "local";
  if (value !== "local" && value !== "razorpay")
    throw new Error("PAYMENT_PROVIDER must be local or razorpay");
  return value;
}
export function loadRazorpayConfig() {
  loadLocalEnv();
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  const timeout = process.env.RAZORPAY_TIMEOUT_MS ?? "8000";
  const currency = process.env.RAZORPAY_CURRENCY ?? "INR";
  if (
    !/^rzp_test_[A-Za-z0-9]+$/.test(keyId) ||
    !keySecret.trim() ||
    keySecret.startsWith("REPLACE_")
  )
    throw new Error("Valid RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET Test Mode keys are required");
  if (webhookSecret.trim().length < 32 || webhookSecret.startsWith("REPLACE_"))
    throw new Error("RAZORPAY_WEBHOOK_SECRET must contain at least 32 non-placeholder characters");
  if (
    currency !== "INR" ||
    !/^\d+$/.test(timeout) ||
    Number(timeout) < 1000 ||
    Number(timeout) > 10000
  )
    throw new Error("Razorpay requires INR and timeout 1000..10000ms");
  return {
    keyId,
    keySecret,
    webhookSecret,
    timeoutMs: Number(timeout),
    currency: "INR" as const,
  };
}

export function loadPaymentConfig(): {
  baseUrl: string;
  webhookSecret: string;
} {
  loadLocalEnv();
  const baseUrl = process.env.PAYMENT_PROVIDER_BASE_URL ?? "http://127.0.0.1:4100";
  const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET ?? "";
  try {
    const url = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
  } catch {
    throw new Error("Invalid PAYMENT_PROVIDER_BASE_URL");
  }
  if (webhookSecret.length < 32 || webhookSecret.startsWith("REPLACE_"))
    throw new Error("PAYMENT_WEBHOOK_SECRET must contain at least 32 characters");
  return { baseUrl, webhookSecret };
}

export interface EnabledAuthConfig {
  enabled: true;
  issuer: string;
  audience: string;
}
export type AuthConfig = EnabledAuthConfig | { enabled: false };
export function loadAuthConfig(): AuthConfig {
  const env = loadEnv();
  const value = process.env.AUTH_ENABLED ?? "true";
  if (value !== "true" && value !== "false") throw new Error("AUTH_ENABLED must be true or false");
  if (value === "false") {
    if (env.nodeEnv === "production")
      throw new Error("Authentication cannot be disabled in production");
    return { enabled: false };
  }
  const insecure = process.env.OIDC_ALLOW_HTTP ?? "false";
  if (
    !["true", "false"].includes(insecure) ||
    (env.nodeEnv === "production" && insecure === "true")
  )
    throw new Error("OIDC_ALLOW_HTTP is a non-production boolean only");
  const issuer = process.env.OIDC_ISSUER ?? "";
  const audience = process.env.OIDC_AUDIENCE ?? "";
  try {
    const url = new URL(issuer);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (
      url.protocol !== "https:" &&
      !(env.nodeEnv !== "production" && (local || insecure === "true") && url.protocol === "http:")
    )
      throw new Error();
    if (url.username || url.password || url.search || url.hash || issuer.endsWith("/"))
      throw new Error();
    if (!audience.trim() || /\s/.test(audience)) throw new Error();
  } catch {
    throw new Error("Valid OIDC_ISSUER and OIDC_AUDIENCE are required");
  }
  return { enabled: true, issuer, audience };
}

export interface RedisConfig {
  url: string;
  keyPrefix: string;
  productTtlSeconds: number;
  rateWindowSeconds: number;
  rateMaxRequests: number;
}
export function loadRedisConfig(): RedisConfig {
  loadLocalEnv();
  const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6381";
  try {
    const parsed = new URL(url);
    if (
      !["redis:", "rediss:"].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.hash ||
      parsed.search
    )
      throw new Error();
  } catch {
    throw new Error("Invalid REDIS_URL");
  }
  const positive = (name: string, fallback: number, max: number): number => {
    const raw = process.env[name] ?? String(fallback);
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max)
      throw new Error(`${name} must be an integer between 1 and ${max}`);
    return value;
  };
  return {
    url,
    keyPrefix: loadEnv().nodeEnv === "test" ? `test:${randomUUID()}:` : "",
    productTtlSeconds: positive("PRODUCT_CACHE_TTL_SECONDS", 60, 86400),
    rateWindowSeconds: positive("RATE_LIMIT_WINDOW_SECONDS", 60, 3600),
    rateMaxRequests: positive("RATE_LIMIT_MAX_REQUESTS", 100, 1000000),
  };
}

export interface KafkaConfig {
  brokers: string[];
  clientId: string;
  orderTopic: string;
  retryTopic: string;
  dlqTopic: string;
  consumerGroup: string;
  maxRetries: number;
}
export function loadKafkaConfig(): KafkaConfig {
  loadLocalEnv();
  const brokers = (process.env.KAFKA_BROKERS ?? "127.0.0.1:9093").split(",").map((v) => v.trim());
  if (
    !brokers.length ||
    brokers.some(
      (v) =>
        !/^[a-zA-Z0-9.-]+:[0-9]+$/.test(v) ||
        Number(v.split(":")[1]) < 1 ||
        Number(v.split(":")[1]) > 65535,
    )
  )
    throw new Error("Invalid KAFKA_BROKERS");
  const name = (key: string, fallback: string): string => {
    const value = process.env[key] ?? fallback;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value)) throw new Error("Invalid " + key);
    return value;
  };
  const retries = process.env.KAFKA_MAX_RETRIES ?? "3";
  if (!/^\d+$/.test(retries) || Number(retries) > 10)
    throw new Error("KAFKA_MAX_RETRIES must be 0..10");
  const testPrefix = loadEnv().nodeEnv === "test" ? `test-${randomUUID()}-` : "";
  const config = {
    brokers,
    clientId: name("KAFKA_CLIENT_ID", "ecommerce-api"),
    orderTopic: name("KAFKA_ORDER_TOPIC", testPrefix + "order-events"),
    retryTopic: name("KAFKA_ORDER_RETRY_TOPIC", testPrefix + "order-events-retry"),
    dlqTopic: name("KAFKA_ORDER_DLQ_TOPIC", testPrefix + "order-events-dlq"),
    consumerGroup: name("KAFKA_ORDER_CONSUMER_GROUP", testPrefix + "order-notification-worker"),
    maxRetries: Number(retries),
  };
  if (new Set([config.orderTopic, config.retryTopic, config.dlqTopic]).size !== 3)
    throw new Error("Kafka topics must be distinct");
  if (
    loadEnv().nodeEnv === "test" &&
    ![config.orderTopic, config.retryTopic, config.dlqTopic, config.consumerGroup].every((v) =>
      v.startsWith("test-"),
    )
  ) {
    // Tests must explicitly supply their own topic/group namespace.
    throw new Error("Kafka test topics and group must start with test-");
  }
  return config;
}

export interface OutboxConfig {
  pollIntervalMs: number;
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
}
export function loadOutboxConfig(): OutboxConfig {
  loadLocalEnv();
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const raw = process.env[name] ?? String(fallback);
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max)
      throw new Error("Invalid " + name);
    return n;
  };
  return {
    pollIntervalMs: integer("OUTBOX_POLL_INTERVAL_MS", 1000, 100, 60000),
    batchSize: integer("OUTBOX_BATCH_SIZE", 20, 1, 100),
    leaseMs: integer("OUTBOX_LEASE_MS", 30000, 5000, 300000),
    maxAttempts: integer("OUTBOX_MAX_ATTEMPTS", 10, 1, 100),
  };
}

export function loadDocsConfig(): boolean {
  const env = loadEnv();
  const value = process.env.DOCS_ENABLED ?? String(env.nodeEnv !== "production");
  if (value !== "true" && value !== "false") throw new Error("DOCS_ENABLED must be true or false");
  return value === "true";
}

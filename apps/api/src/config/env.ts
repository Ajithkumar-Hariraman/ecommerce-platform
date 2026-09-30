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
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
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
  if (
    nodeEnv !== "development" &&
    nodeEnv !== "test" &&
    nodeEnv !== "production"
  ) {
    throw new Error(
      "Invalid NODE_ENV: expected development, test, or production",
    );
  }
  return Object.freeze({
    port: port(process.env.PORT ?? "3000", "PORT"),
    host,
    nodeEnv,
  });
}
export function loadDatabaseConfig(
  target: "application" | "test" = "application",
): DatabaseConfig {
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
  if (
    target === "test" &&
    (database !== "ecommerce_test" || database === process.env.DB_NAME)
  ) {
    throw new Error(
      "Integration tests require a separate ecommerce_test database",
    );
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
  | { storage: "postgres" }
  | { storage: "mongodb"; uri: string; databaseName: string };

export function loadOrderStorageConfig(): OrderStorageConfig {
  const env = loadEnv();
  const storage = process.env.ORDER_STORAGE ?? "postgres";
  if (storage === "postgres") return { storage };
  if (storage !== "mongodb") throw new Error("Invalid ORDER_STORAGE: expected postgres or mongodb");
  const uri = process.env.MONGODB_URI ?? "";
  const databaseName = process.env.MONGODB_DB_NAME ?? "";
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri) || !databaseName.trim() || /[\s/\\."$]/.test(databaseName)) {
    throw new Error("MongoDB configuration requires a valid MONGODB_URI and MONGODB_DB_NAME");
  }
  if (env.nodeEnv === "test" && databaseName !== "ecommerce_test") {
    throw new Error("MongoDB tests require ecommerce_test");
  }
  return { storage, uri, databaseName };
}

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadEnv, loadDatabaseConfig } from "../src/config/env.js";

test("RDS requires verified TLS while local tests retain their connection defaults", () => {
  loadEnv();
  const keys = [
    "NODE_ENV",
    "DB_HOST",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "DB_TLS",
    "DB_TLS_CA_FILE",
  ];
  const saved = keys.map((key) => process.env[key]);
  const directory = mkdtempSync(join(tmpdir(), "ecommerce-tls-"));
  try {
    Object.assign(process.env, {
      NODE_ENV: "production",
      DB_HOST: "db.example.ap-south-1.rds.amazonaws.com",
      DB_NAME: "ecommerce_prod",
      DB_USER: "app",
      DB_PASSWORD: "fixture-only",
      DB_TLS: "false",
    });
    assert.throws(() => loadDatabaseConfig(), /RDS requires/);
    process.env.DB_TLS = "true";
    delete process.env.DB_TLS_CA_FILE;
    assert.throws(() => loadDatabaseConfig(), /CA_FILE/);
    process.env.DB_TLS_CA_FILE = join(directory, "ca.pem");
    writeFileSync(process.env.DB_TLS_CA_FILE, "not a certificate");
    assert.throws(() => loadDatabaseConfig(), /Invalid DB TLS/);
    writeFileSync(
      process.env.DB_TLS_CA_FILE,
      "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----",
    );
    assert.equal(loadDatabaseConfig().ssl?.rejectUnauthorized, true);
    // Configuration fixture only; this certificate cannot pass a real TLS handshake.
    process.env.NODE_ENV = "test";
    process.env.DB_HOST = "127.0.0.1";
    process.env.DB_TLS = "false";
    assert.equal(loadDatabaseConfig("test").ssl, undefined);
    process.env.DB_TLS = "disable-verification";
    assert.throws(() => loadDatabaseConfig(), /DB_TLS must/);
  } finally {
    keys.forEach((key, index) => {
      const value = saved[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    rmSync(directory, { recursive: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { loadEnv, loadOrderStorageConfig } from "../src/config/env.js";

test("Order storage defaults to postgres and requires Mongo config only in Mongo mode", () => {
  loadEnv();
  const keys = ["ORDER_STORAGE", "MONGODB_URI", "MONGODB_DB_NAME", "NODE_ENV"];
  const saved = keys.map(key => process.env[key]);
  try {
    process.env.NODE_ENV = "test";
    delete process.env.ORDER_STORAGE;
    delete process.env.MONGODB_URI;
    delete process.env.MONGODB_DB_NAME;
    assert.deepEqual(loadOrderStorageConfig(), {storage: "postgres"});
    process.env.ORDER_STORAGE = "other";
    assert.throws(loadOrderStorageConfig, /Invalid ORDER_STORAGE/);
    process.env.ORDER_STORAGE = "mongodb";
    assert.throws(loadOrderStorageConfig, /MongoDB configuration/);
    process.env.MONGODB_URI = "mongodb://127.0.0.1:27018";
    process.env.MONGODB_DB_NAME = "ecommerce_dev";
    assert.throws(loadOrderStorageConfig, /tests require ecommerce_test/);
    process.env.MONGODB_DB_NAME = "ecommerce_test";
    assert.equal(loadOrderStorageConfig().storage, "mongodb");
  } finally {
    keys.forEach((key, i) => { const value = saved[i]; if(value === undefined) delete process.env[key]; else process.env[key] = value; });
  }
});

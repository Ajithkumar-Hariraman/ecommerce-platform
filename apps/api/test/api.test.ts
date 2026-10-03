import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createTestApp as createApp } from "./helpers/app.js";
import { AppError } from "../src/errors/app-error.js";
import { errorHandler } from "../src/middleware/error-handler.js";

test("health, JSON 404, and parser failures", async () => {
  const server = createServer(createApp()).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const health = await fetch(url + "/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    const missing = await fetch(url + "/missing");
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), {
      error: { message: "Route not found" },
    });
    const malformed = await fetch(url + "/health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      error: { message: "Invalid JSON body" },
    });
    const large = await fetch(url + "/health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(110_000) }),
    });
    assert.equal(large.status, 413);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

test("expected and rejected async errors use safe centralized responses", async () => {
  const app = express();
  // These routes exist only inside the test process.
  app.get("/expected", () => {
    throw new AppError(409, "Conflict");
  });
  app.get("/unexpected", async () => {
    await Promise.resolve();
    throw new Error("private implementation detail");
  });
  app.use(errorHandler);
  const server = createServer(app).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    const expected = await fetch(`http://127.0.0.1:${address.port}/expected`);
    assert.equal(expected.status, 409);
    assert.deepEqual(await expected.json(), { error: { message: "Conflict" } });
    const unexpected = await fetch(`http://127.0.0.1:${address.port}/unexpected`);
    assert.equal(unexpected.status, 500);
    assert.deepEqual(await unexpected.json(), {
      error: { message: "Internal server error" },
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

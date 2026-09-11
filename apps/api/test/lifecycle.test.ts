import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

async function freePort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert(addr && typeof addr !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return addr.port;
}

function launch(
  port: number,
  overrides: Record<string, string> = {},
  dev = false,
) {
  const child = spawn(
    process.execPath,
    dev ? ["node_modules/tsx/dist/cli.mjs", "watch", "test/fixtures/server.ts"] : ["--import", "tsx", "test/fixtures/server.ts"],
    {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        NODE_ENV: "test",
        ...overrides,
      },
      detached: dev,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  const exit = once(child, "exit");
  return { child, exit, output: () => output };
}

async function ready(proc: ReturnType<typeof launch>) {
  for (let i = 0; i < 200; i++) {
    if (proc.output().includes("API listening")) return;
    if (proc.child.exitCode !== null) throw new Error(proc.output());
    await delay(25);
  }
  throw new Error("Startup timeout: " + proc.output());
}

test(
  "shared lifecycle startup, signals, and in-flight request drain",
  { timeout: 15000 },
  async () => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const port = await freePort();
      const proc = launch(port);
      try {
        await ready(proc);
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        assert.equal(response.status, 200);
        await response.text();
        // Start a body, pause before completion, then signal shutdown.
        const req = request({
          host: "127.0.0.1",
          port,
          path: "/health",
          method: "GET",
          headers: {
            "content-type": "application/json",
            "content-length": "2",
          },
        });
        const finished = new Promise<number | undefined>((resolve, reject) => {
          req.on("error", reject);
          req.on("response", (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
          });
        });
        req.write("{");
        await delay(100);
        proc.child.kill(signal);
        await delay(100);
        assert.equal(
          proc.child.exitCode,
          null,
          "must wait for the active request",
        );
        req.end("}");
        assert.equal(await finished, 200);
        const [code] = await proc.exit;
        assert.equal(code, 0);
        assert.match(proc.output(), /HTTP server closed/);
      } finally {
        if (proc.child.exitCode === null) proc.child.kill("SIGKILL");
      }
    }
  },
);

test(
  "invalid environment and occupied port fail startup",
  { timeout: 15000 },
  async () => {
    for (const overrides of [
      { PORT: "abc" },
      { PORT: "0" },
      { PORT: "65536" },
      { HOST: "" },
      { NODE_ENV: "staging" },
    ]) {
      const proc = launch(await freePort(), overrides);
      const [code] = await proc.exit;
      assert.equal(code, 1);
      assert.match(proc.output(), /API startup failed/);
      assert.doesNotMatch(proc.output(), /API listening/);
    }
    const blocker = createServer().listen(0, "127.0.0.1");
    await once(blocker, "listening");
    const addr = blocker.address();
    assert(addr && typeof addr !== "string");
    try {
      const proc = launch(addr.port);
      const [code] = await proc.exit;
      assert.equal(code, 1);
      assert.match(proc.output(), /EADDRINUSE/);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  },
);

test(
  "memory development watcher serves health and JSON 404",
  { timeout: 15000 },
  async () => {
    const port = await freePort();
    const proc = launch(port, {}, true);
    try {
      await ready(proc);
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: "ok" });
      const missing = await fetch(`http://127.0.0.1:${port}/unknown`);
      assert.equal(missing.status, 404);
      assert.deepEqual(await missing.json(), {
        error: { message: "Route not found" },
      });
    } finally {
      // WSL/POSIX: stop npm, the watcher, and its server as one process group.
      if (proc.child.pid) process.kill(-proc.child.pid, "SIGTERM");
      await proc.exit;
    }
  },
);

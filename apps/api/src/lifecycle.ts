import { createServer } from "node:http";
import type { Express } from "express";
import type { Env } from "./config/env.js";

// Shared HTTP/process lifecycle; closeResources owns the injected external resources.
export async function startServer(app: Express, env: Env, closeResources: () => Promise<void>): Promise<void> {
  const server = createServer(app);
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`Received ${signal}; draining HTTP requests.`);
    const deadline = setTimeout(() => {
      console.error("Shutdown deadline exceeded; forcing exit.");
      server.closeAllConnections();
      process.exit(1);
    }, 10000);
    try {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      console.info("HTTP server closed.");
    } catch {
      console.error("HTTP shutdown failed");
      process.exitCode = 1;
    } finally {
      try { await closeResources(); }
      catch { console.error("Resource shutdown failed"); process.exitCode = 1; }
      clearTimeout(deadline);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
    }
  };
  const onInterrupt = () => { void shutdown("SIGINT"); };
  const onTerminate = () => { void shutdown("SIGTERM"); };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(env.port, env.host, () => { server.off("error", reject); resolve(); });
    });
  } catch (error) {
    await closeResources();
    throw error;
  }
  server.on("error", () => {
    process.exitCode = 1;
    void shutdown("server error");
  });
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  console.info(`API listening on ${env.host}:${env.port} (${env.nodeEnv})`);
}

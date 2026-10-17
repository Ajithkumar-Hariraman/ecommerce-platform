import { installStructuredLogging } from "../logging.js";
import { setTimeout as delay } from "node:timers/promises";
import { loadOutboxConfig } from "../config/env.js";
import { createBusinessResources } from "../database/business.js";
import { createPublisherRuntime } from "../events/event-runtime.js";
import { OutboxRelay } from "../outbox/outbox-relay.js";

installStructuredLogging();

async function main(): Promise<void> {
  const config = loadOutboxConfig();
  let publisher: Awaited<ReturnType<typeof createPublisherRuntime>> | undefined;
  let business: Awaited<ReturnType<typeof createBusinessResources>> | undefined;
  let stopping = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();
  const stop = () => {
    if (stopping) return;
    stopping = true;
    abort.abort();
    deadline = setTimeout(() => {
      console.error("Outbox relay shutdown deadline exceeded");
      process.exit(1);
    }, 10000);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    business = await createBusinessResources();
    const repository = business.outbox;
    await business.ready();
    publisher = await createPublisherRuntime();
    const relay = new OutboxRelay(repository, publisher.publisher, config);
    console.info({
      operation: "Outbox relay started",
      storageBackend: repository.storageBackend,
    });
    while (!stopping) {
      try {
        await relay.runOnce(() => stopping);
      } catch {
        console.error({
          operation: "Outbox iteration failed; durable claims recover by lease",
          storageBackend: repository.storageBackend,
        });
      }
      if (!stopping)
        await delay(config.pollIntervalMs, undefined, {
          signal: abort.signal,
        }).catch(() => {});
    }
  } catch (error) {
    console.error("Outbox relay startup failed", {
      name: error instanceof Error ? error.name : "Unknown",
      connectionTimeout: error instanceof Error && /connection.*timeout|timeout.*connection/i.test(error.message),
      code: error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{2,24}$/.test(error.code) ? error.code : undefined,
    });
    process.exitCode = 1;
  } finally {
    const results = await Promise.allSettled([
      ...(publisher ? [publisher.close()] : []),
      ...(business ? [business.close()] : []),
    ]);
    if (results.some((r) => r.status === "rejected")) process.exitCode = 1;
    clearTimeout(deadline);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    console.info("Outbox relay resources closed.");
  }
}
void main().catch(() => {
  console.error("Outbox relay configuration failed");
  process.exitCode = 1;
});

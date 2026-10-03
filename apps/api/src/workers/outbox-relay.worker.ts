import { installStructuredLogging } from "../logging.js";
import { setTimeout as delay } from "node:timers/promises";
import { loadKafkaConfig, loadOutboxConfig } from "../config/env.js";
import { createBusinessResources } from "../database/business.js";
import { kafkaClient, kafkaProducer, KafkaEventPublisher } from "../events/kafka.js";
import { OutboxRelay } from "../outbox/outbox-relay.js";

installStructuredLogging();

async function main(): Promise<void> {
  const kafka = loadKafkaConfig();
  const config = loadOutboxConfig();
  const producer = kafkaProducer(kafkaClient(kafka));
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
    await producer.connect();
    const relay = new OutboxRelay(
      repository,
      new KafkaEventPublisher(producer, kafka.orderTopic),
      config,
    );
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
  } catch {
    console.error("Outbox relay startup failed");
    process.exitCode = 1;
  } finally {
    const results = await Promise.allSettled([
      producer.disconnect(),
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

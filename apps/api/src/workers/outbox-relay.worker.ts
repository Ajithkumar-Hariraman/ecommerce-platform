import { installStructuredLogging } from "../logging.js";
import { setTimeout as delay } from "node:timers/promises";
import { loadEnv, loadDatabaseConfig, loadOrderStorageConfig, loadKafkaConfig, loadOutboxConfig } from "../config/env.js";
import { createPool } from "../database/pool.js";
import { createMongoResources } from "../database/mongo.js";
import { kafkaClient, kafkaProducer, KafkaEventPublisher } from "../events/kafka.js";
import { PostgresOutboxRepository } from "../outbox/postgres-outbox.repository.js";
import { MongoOutboxRepository, ensureOutboxIndex } from "../outbox/mongo-outbox.repository.js";
import type { OutboxRepository } from "../outbox/outbox.js";
import { OutboxRelay } from "../outbox/outbox-relay.js";

installStructuredLogging();

async function main(): Promise<void> {
  const env = loadEnv(); const storage = loadOrderStorageConfig(); const kafka = loadKafkaConfig(); const config = loadOutboxConfig();
  const producer = kafkaProducer(kafkaClient(kafka));
  let pool: ReturnType<typeof createPool> | undefined;
  let mongo: Awaited<ReturnType<typeof createMongoResources>> | undefined;
  let stopping = false; let deadline: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();
  const stop = () => {
    if (stopping) return; stopping = true; abort.abort();
    deadline = setTimeout(() => {console.error("Outbox relay shutdown deadline exceeded");process.exit(1);},10000);
  };
  process.on("SIGINT",stop);process.on("SIGTERM",stop);
  try {
    let repository: OutboxRepository;
    if (storage.storage === "postgres") {
      pool = createPool(loadDatabaseConfig(env.nodeEnv === "test" ? "test" : "application"));
      await pool.query("SELECT id FROM outbox_events LIMIT 0");
      repository = new PostgresOutboxRepository(pool);
    } else {
      mongo = await createMongoResources(storage.uri,storage.databaseName);
      await ensureOutboxIndex(mongo.db); repository = new MongoOutboxRepository(mongo.db);
    }
    await producer.connect();
    const relay = new OutboxRelay(repository,new KafkaEventPublisher(producer,kafka.orderTopic),config);
    console.info({operation:"Outbox relay started",storageBackend:repository.storageBackend});
    while (!stopping) {
      try { await relay.runOnce(() => stopping); }
      catch { console.error({operation:"Outbox iteration failed; durable claims recover by lease",storageBackend:repository.storageBackend}); }
      if (!stopping) await delay(config.pollIntervalMs,undefined,{signal:abort.signal}).catch(() => {});
    }
  } catch { console.error("Outbox relay startup failed");process.exitCode=1; }
  finally {
    const results = await Promise.allSettled([producer.disconnect(),...(pool?[pool.end()]:[]),...(mongo?[mongo.client.close()]:[])]);
    if (results.some(r => r.status==="rejected")) process.exitCode=1;
    clearTimeout(deadline);process.off("SIGINT",stop);process.off("SIGTERM",stop);
    console.info("Outbox relay resources closed.");
  }
}
void main().catch(() => {console.error("Outbox relay configuration failed");process.exitCode=1;});

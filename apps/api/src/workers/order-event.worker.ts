import { installStructuredLogging } from "../logging.js";
import { loadDatabaseConfig, loadEnv, loadKafkaConfig } from "../config/env.js";
import { createPool } from "../database/pool.js";
import { kafkaClient, kafkaProducer } from "../events/kafka.js";
import { PostgresOrderNotificationRepository } from "../events/order-notification.repository.js";
import { startOrderConsumer } from "../events/order-consumer.js";

installStructuredLogging();

async function main(): Promise<void> {
  const env = loadEnv(); const config = loadKafkaConfig();
  const pool = createPool(loadDatabaseConfig(env.nodeEnv === "test" ? "test" : "application"));
  const kafka = kafkaClient(config); const producer = kafkaProducer(kafka);
  let worker: Awaited<ReturnType<typeof startOrderConsumer>> | undefined;
  let closing = false;
  const shutdown = async (failed = false) => {
    if (closing) return; closing = true;
    if (failed) process.exitCode = 1;
    const deadline = setTimeout(() => { console.error("Worker shutdown deadline exceeded"); process.exit(1); }, 10000);
    try { await worker?.close(); }
    catch { process.exitCode = 1; }
    finally {
      await Promise.allSettled([producer.disconnect(), pool.end()]); clearTimeout(deadline);
      process.off("SIGINT", stop); process.off("SIGTERM", stop);
      console.info("Order worker resources closed.");
    }
  };
  const stop = () => { void shutdown(); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    await pool.query("SELECT event_id FROM order_notifications LIMIT 0");
    await producer.connect();
    worker = await startOrderConsumer(kafka, producer, config, new PostgresOrderNotificationRepository(pool), () => { void shutdown(true); });
    if (closing) { await worker.close(); return; }
    console.info({operation: "Order worker started", consumerGroup: config.consumerGroup});
  } catch { console.error("Order worker startup failed"); await shutdown(true); }
}
void main().catch(() => { console.error("Order worker configuration failed"); process.exitCode = 1; });

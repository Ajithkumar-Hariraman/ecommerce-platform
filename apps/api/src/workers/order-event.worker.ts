import { installStructuredLogging } from "../logging.js";
import { loadKafkaConfig } from "../config/env.js";
import { createBusinessResources } from "../database/business.js";
import { kafkaClient, kafkaProducer } from "../events/kafka.js";
import { startOrderConsumer } from "../events/order-consumer.js";

installStructuredLogging();

async function main(): Promise<void> {
  const config = loadKafkaConfig();
  const business = await createBusinessResources();
  const kafka = kafkaClient(config);
  const producer = kafkaProducer(kafka);
  let worker: Awaited<ReturnType<typeof startOrderConsumer>> | undefined;
  let closing = false;
  const shutdown = async (failed = false) => {
    if (closing) return;
    closing = true;
    if (failed) process.exitCode = 1;
    const deadline = setTimeout(() => {
      console.error("Worker shutdown deadline exceeded");
      process.exit(1);
    }, 10000);
    try {
      await worker?.close();
    } catch {
      process.exitCode = 1;
    } finally {
      await Promise.allSettled([producer.disconnect(), business.close()]);
      clearTimeout(deadline);
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      console.info("Order worker resources closed.");
    }
  };
  const stop = () => {
    void shutdown();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await business.ready();
    await producer.connect();
    worker = await startOrderConsumer(kafka, producer, config, business.notifications, () => {
      void shutdown(true);
    });
    if (closing) {
      await worker.close();
      return;
    }
    console.info({
      operation: "Order worker started",
      consumerGroup: config.consumerGroup,
    });
  } catch {
    console.error("Order worker startup failed");
    await shutdown(true);
  }
}
void main().catch(() => {
  console.error("Order worker configuration failed");
  process.exitCode = 1;
});

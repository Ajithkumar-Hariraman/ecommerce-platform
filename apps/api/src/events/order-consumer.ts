import type { Kafka, Producer } from "kafkajs";
import { setTimeout as delay } from "node:timers/promises";
import type { KafkaConfig } from "../config/env.js";
import type { OrderNotificationRepository } from "./order-notification.repository.js";
import { OrderEventHandler } from "./order-event.handler.js";
export async function startOrderConsumer(
  kafka: Kafka,
  producer: Producer,
  config: KafkaConfig,
  repository: OrderNotificationRepository,
  onCrash: () => void = () => {},
) {
  const consumer = kafka.consumer({
    groupId: config.consumerGroup,
    allowAutoTopicCreation: false,
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
    retry: { retries: 3 },
  });
  consumer.on(consumer.events.CRASH, () => {
    console.error({ operation: "order-consumer crashed", consumerGroup: config.consumerGroup });
    onCrash();
  });
  const handler = new OrderEventHandler(repository, producer, config);
  try {
    await consumer.connect();
    await consumer.subscribe({
      topics: [config.orderTopic, config.retryTopic],
      fromBeginning: true,
    });
    await consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 3,
      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        // Give a transient dependency time to recover before spending another retry.
        if (topic === config.retryTopic) {
          await heartbeat();
          await delay(2000);
        }
        await handler.handle({
          topic,
          partition,
          key: message.key,
          value: message.value,
          offset: message.offset,
        });
        await heartbeat();
        await consumer.commitOffsets([
          { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
        ]);
      },
    });
  } catch (error) {
    await consumer.disconnect();
    throw error;
  }
  return {
    consumer,
    async close() {
      await consumer.stop();
      await consumer.disconnect();
    },
  };
}

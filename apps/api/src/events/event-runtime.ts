import { loadEventTransportConfig, loadKafkaConfig } from "../config/env.js";
import { kafkaClient, kafkaProducer, KafkaEventPublisher } from "./kafka.js";
import { pubSubClient, PubSubEventPublisher, startPubSubConsumer } from "./pubsub.js";
import { startOrderConsumer } from "./order-consumer.js";
import type { OrderNotificationRepository } from "./order-notification.repository.js";

export async function createPublisherRuntime() {
  const config = loadEventTransportConfig();
  if (config.transport === "pubsub") {
    const client = pubSubClient(config);
    try {
      const topic = client.topic(config.topic, { gaxOpts: { timeout: 5000, retry: null } });
      await topic.getMetadata();
      return {
        publisher: new PubSubEventPublisher(topic),
        close: async () => {
          try {await topic.flush();} finally {await client.close();}
        },
      };
    } catch (error) {
      await client.close();
      throw error;
    }
  }
  const kafka = loadKafkaConfig();
  const producer = kafkaProducer(kafkaClient(kafka));
  try {
    await producer.connect();
    return {
      publisher: new KafkaEventPublisher(producer, kafka.orderTopic),
      close: () => producer.disconnect(),
    };
  } catch (error) {
    await producer.disconnect();
    throw error;
  }
}
export async function createConsumerRuntime(
  repository: OrderNotificationRepository,
  onCrash: () => void,
) {
  const config = loadEventTransportConfig();
  if (config.transport === "pubsub") {
    const client = pubSubClient(config);
    try {
      const worker = await startPubSubConsumer(client, config.subscription, repository, onCrash);
      return {
        identity: config.subscription,
        close: async () => {
          try {await worker.close();} finally {await client.close();}
        },
      };
    } catch (error) {
      await client.close();
      throw error;
    }
  }
  const configKafka = loadKafkaConfig();
  const kafka = kafkaClient(configKafka);
  const producer = kafkaProducer(kafka);
  try {
    await producer.connect();
    const worker = await startOrderConsumer(kafka, producer, configKafka, repository, onCrash);
    return {
      identity: configKafka.consumerGroup,
      close: async () => {
        await worker.close();
        await producer.disconnect();
      },
    };
  } catch (error) {
    await producer.disconnect();
    throw error;
  }
}

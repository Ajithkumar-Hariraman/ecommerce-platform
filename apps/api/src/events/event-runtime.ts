import { loadEventTransportConfig, loadKafkaConfig } from "../config/env.js";
import { kafkaClient, kafkaProducer, KafkaEventPublisher } from "./kafka.js";
import { pubSubClient, PubSubEventPublisher, startPubSubConsumer } from "./pubsub.js";
import { startOrderConsumer } from "./order-consumer.js";
import type { OrderNotificationRepository } from "./order-notification.repository.js";
import { SNSClient } from "@aws-sdk/client-sns";
import { SQSClient } from "@aws-sdk/client-sqs";
import { SnsEventPublisher, startSqsConsumer } from "./aws.js";

export async function createPublisherRuntime() {
  const config = loadEventTransportConfig();
  if (config.transport === "sns-sqs") {
    const client = new SNSClient({
      region: config.region,
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
    });
    return {
      publisher: new SnsEventPublisher(client, config.topicArn),
      close: async () => client.destroy(),
    };
  }
  if (config.transport === "pubsub") {
    const client = pubSubClient(config);
    try {
      const topic = client.topic(config.topic, { gaxOpts: { timeout: 5000, retry: null } });
      await topic.getMetadata();
      return {
        publisher: new PubSubEventPublisher(topic),
        close: async () => {
          try {
            await topic.flush();
          } finally {
            await client.close();
          }
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
  if (config.transport === "sns-sqs") {
    const client = new SQSClient({
      region: config.region,
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 2000, requestTimeout: 25000 },
    });
    try {
      const worker = await startSqsConsumer(client, config.queueUrl, repository, onCrash);
      return { identity: config.queueUrl, close: () => worker.close() };
    } catch (error) {
      client.destroy();
      throw error;
    }
  }
  if (config.transport === "pubsub") {
    const client = pubSubClient(config);
    try {
      const worker = await startPubSubConsumer(client, config.subscription, repository, onCrash);
      return {
        identity: config.subscription,
        close: async () => {
          try {
            await worker.close();
          } finally {
            await client.close();
          }
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

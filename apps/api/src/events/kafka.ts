import { setTimeout as delay } from "node:timers/promises";
import { Kafka, logLevel, Partitioners } from "kafkajs";
import type { Producer } from "kafkajs";
import type { KafkaConfig } from "../config/env.js";
import type { EventPublisher, OrderPaid } from "./order-paid.js";
export function kafkaClient(config: KafkaConfig): Kafka {
  // SDK raw error logs can contain message payloads; application logs safe metadata.
  return new Kafka({brokers: config.brokers, clientId: config.clientId, logLevel: logLevel.NOTHING,
    connectionTimeout: 1000, requestTimeout: 2000, retry: {retries: 2, initialRetryTime: 100}});
}
export function kafkaProducer(kafka: Kafka): Producer {
  return kafka.producer({allowAutoTopicCreation: false, createPartitioner: Partitioners.DefaultPartitioner});
}
export async function ensureOrderTopics(kafka: Kafka, config: KafkaConfig): Promise<void> {
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.createTopics({waitForLeaders: false, topics: [config.orderTopic, config.retryTopic, config.dlqTopic].map(topic => ({topic, numPartitions: 3, replicationFactor: 1}))});
    // KRaft metadata propagation can lag a successful CreateTopics response.
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const metadata = await admin.fetchTopicMetadata({topics: [config.orderTopic, config.retryTopic, config.dlqTopic]});
        if (metadata.topics.length === 3 && metadata.topics.every(t => t.partitions.length === 3 && t.partitions.every(p => p.leader >= 0))) return;
      } catch (error) {
        if (!(typeof error === "object" && error && "retriable" in error && error.retriable)) throw error;
      }
      await delay(100);
    }
    throw new Error("Expected three ready Kafka partitions per topic");
  } finally { await admin.disconnect(); }
}
export class KafkaEventPublisher implements EventPublisher {
  constructor(private readonly producer: Pick<Producer, "send">, private readonly topic: string) {}
  async publish(event: OrderPaid): Promise<void> {
    await this.producer.send({topic: this.topic, acks: -1, timeout: 2000,
      messages: [{key: event.aggregateId, value: JSON.stringify(event)}]});
  }
}

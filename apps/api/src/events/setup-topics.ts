import { loadKafkaConfig } from "../config/env.js";
import { ensureOrderTopics, kafkaClient } from "./kafka.js";
const config = loadKafkaConfig();
ensureOrderTopics(kafkaClient(config), config)
  .then(() => console.info("Three Order topics verified with three partitions each."))
  .catch(() => {
    console.error("Kafka topic setup failed");
    process.exitCode = 1;
  });

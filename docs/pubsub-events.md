# Pub/Sub event transport

`EVENT_TRANSPORT=kafka` remains the default. `pubsub` selects the Google Cloud SDK adapter behind the existing EventPublisher; Kafka topics, payloads and local commands are unchanged.

Cloud configuration: GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_REGION, PUBSUB_ORDER_TOPIC and PUBSUB_ORDER_SUBSCRIPTION. Google SDK authentication uses ADC locally and the attached runtime service account in Cloud Run. No credential files or token values enter application config.

The outbox relay publishes the existing versioned OrderPaid JSON and stable eventId/aggregateId attributes. Publication failure remains durable and retries with existing backoff; migration 009 adds PUBSUB_UNAVAILABLE without rewriting historical Kafka failures. The acknowledgement gap permits duplicate publication.

The subscriber validates size, schema and envelope attributes, then uses the selected durable OrderNotificationRepository. It acknowledges only after successful processing or an identical duplicate. Invalid messages and storage failures are negatively acknowledged; subscription retry/dead-letter policy bounds poison delivery. SDK flow control limits outstanding messages to ten. The Pub/Sub service agent requires subscriber permission on the source subscription and publisher permission on its dead-letter topic for dead-letter forwarding.

No cross-message ordering or exactly-once delivery is claimed. The current event is one OrderPaid transition per Order; durable application event-ID deduplication protects notification effects.

Run from apps/api with the same validated database environment as the API:

```sh
EVENT_TRANSPORT=pubsub npm run worker:outbox
EVENT_TRANSPORT=pubsub npm run worker:orders
```

A pull subscriber on Cloud Run requires instance-based CPU and at least one running instance; a relay may instead run as a bounded scheduled Job. Do not deploy these loops as request-only CPU services. Local Kafka instances can continue with EVENT_TRANSPORT=kafka, but do not route one outbox to competing transports.

Verification: isolated tests inject the SDK boundary; opt-in real integration creates unique test-owned topics/subscriptions and an isolated schema in ecommerce_test, runs real outbox publication and durable notification deduplication, then removes only its resources. Normal test runs do not require Google credentials.

```sh
PUBSUB_RUN_INTEGRATION=true GOOGLE_CLOUD_PROJECT=ecommerce-platform-510208 \
GOOGLE_CLOUD_REGION=asia-south1 node --import tsx --test test/integration/pubsub.test.ts
```

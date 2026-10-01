# Kafka Order event processing

Publication now uses the [Transactional Outbox](transactional-outbox.md). The
consumer, versioned contract, retry/DLQ topics and offsets below remain applicable.
The original direct-publication boundary described here is historical; API startup
no longer creates a Kafka producer. Run worker:outbox alongside worker:orders.

## Runtime and commands

A dedicated Apache Kafka 4.1.2 broker runs in KRaft combined broker/controller
mode. It owns kafka_data; no historical broker state is reused. Local single-node
replication factor is one, not a highly available deployment. No ZooKeeper.

```sh
docker compose --env-file infra/.env -f infra/compose.yaml up -d --no-deps kafka
docker exec ecommerce-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:19092 --describe
cd apps/api
npm run db:migrate
npm run kafka:topics
npm run build
npm start
# Separate terminal, same private database configuration:
npm run worker:orders
```

WSL clients use 127.0.0.1:9093, mapped to container 9092. Kafka advertises a separate
internal listener kafka:19092 for Compose clients. Two reachable advertised
listeners are required: using kafka:9092 internally would advertise the host
loopback address back to those clients. The requested host mapping remains 9093:9092.

Settings are validated centrally: KAFKA_BROKERS, KAFKA_CLIENT_ID,
KAFKA_ORDER_TOPIC, KAFKA_ORDER_RETRY_TOPIC, KAFKA_ORDER_DLQ_TOPIC,
KAFKA_ORDER_CONSUMER_GROUP and KAFKA_MAX_RETRIES (0..10, default 3).
Defaults: order-events, order-events-retry, order-events-dlq and
order-notification-worker. Explicit topic setup creates/verifies three partitions
each, including a bounded metadata propagation check. Auto topic creation is off.

Official references: [Apache Docker image](https://kafka.apache.org/41/getting-started/docker/),
[KafkaJS consumption](https://kafka.js.org/docs/consuming).
KafkaJS 2.2.4 is used as requested. Node 24 emitted an SDK TimeoutNegativeWarning
during real checks; functional broker, worker and shutdown assertions passed.
No dependency internals were patched or warnings suppressed.

## Business boundary

HMAC payment webhook -> validation -> durable PAID transition/audit/dedup ->
PublishingPaymentWorkflow -> EventPublisher -> KafkaEventPublisher -> real broker.
OrderService has no KafkaJS dependency. The API creates one producer at startup.
It disconnects after HTTP drain, before existing Redis/database resource cleanup.
Kafka startup/publish failures are logged safely; /health remains liveness and
/ready still probes required databases, with Kafka optional for API availability.
An initial producer connection failure may require an API restart to recover;
there is no background publication queue.

Only newly applied payment.succeeded transitions publish. Ordinary duplicate
webhooks and payment.failed transitions do not publish OrderPaid. Mongo projection
repair/concurrent redelivery can publish duplicates; the event ID remains stable.

```json
{
  "eventId": "<provider-event-uuid>",
  "eventType": "OrderPaid",
  "eventVersion": 1,
  "occurredAt": "<ISO timestamp>",
  "aggregateType": "Order",
  "aggregateId": "<order-uuid>",
  "payload": { "paymentId": "<payment-uuid>" }
}
```

Message key equals orderId. Values are explicit external contracts, validated
using Zod, with no customer data, tokens, credentials or internal class instances.

## Consumer and durable side effect

The separate order-event.worker runtime requires Kafka and PostgreSQL. It consumes
primary and retry topics under order-notification-worker. Its durable side effect
is an order_notifications record: event_id primary key, order_id, payment_id,
occurred_at, processed_at. The single atomic INSERT is both the notification
projection and consumer receipt. ON CONFLICT avoids repeated effects; conflicting
identity under the same eventId is rejected. This is separate from webhook dedup.

PostgreSQL owns this independent projection even when Orders use MongoDB. There is
no cross-storage Order foreign key and no Mongo dual-write. Notification records
represent processing, not an email delivery claim. Migration 005 adds only this table
and its order lookup index; earlier migrations are unchanged.

## Offsets, groups and ordering

TOPIC means a logical event stream. PARTITION is an ordered shard. OFFSET is a
position within one partition. CONSUMER_GROUP members divide partitions; one
active group member owns each partition. Three primary partitions allow up to
three primary partitions to be processed concurrently by group members. The retry
topic has its own three partitions. More consumers do not create more partitions.

KafkaJS uses eachMessage with autoCommit:false and at most three concurrent
partitions per worker. Processing inside each partition stays sequential. After
notification persistence, or acknowledged retry/DLQ publication, the worker commits
current offset+1. A failed retry/DLQ publish throws and does not commit. Worker
crashes require supervisor restart; restart/rebalance resumes committed offsets.
SIGINT/SIGTERM stop consumption, finish in-flight handling, disconnect consumer
and producer, then close PostgreSQL; a ten-second deadline bounds shutdown.

A crash between side effect and offset commit causes repeated delivery. A crash
between retry/DLQ publication and offset commit can duplicate those messages too.
Durable event-ID dedup prevents duplicate notification records, not exactly-once
transport. Kafka ordering holds inside a partition, not across all partitions.
Retry routing can let later primary events overtake failed events; no global or
cross-topic business ordering is claimed.

## Retry and dead letters

Transient PostgreSQL connection, capacity, timeout, lock and serialization errors
route to order-events-retry with validated event, retryCount+1, originalTopic and
safe failureCategory. No long sleep blocks a partition. Retries are immediate,
not scheduled/backoff delivery; a sustained outage may exhaust them quickly.
After three retries (four total processing attempts), route to order-events-dlq.
Permanent schema/version/identity/storage rejection goes directly to DLQ.

DLQ contains validated originalEvent, eventId, originalTopic, sourceTopic,
retryCount, failureCategory and failedAt. For malformed/unvalidated input,
originalEvent and eventId are null and only a SHA-256 fingerprint is retained:
copying arbitrary input would risk copying secrets. No stack/error message is
serialized. Logs contain event/topic/partition/offset/group/retry metadata only.
DLQ inspection and authorized replay are operational actions, not automatic here.

## Distributed failure: outbox boundary

DB COMMIT -> Kafka publish is not atomic. The database can commit PAID and then
the process can crash before publication, losing the event. A publish failure
never rolls back committed business state and the webhook still acknowledges.
A repeated already-processed webhook does not reliably repair this gap. Kafka
acknowledgement ambiguity can also produce duplicates. Provider idempotency and
consumer deduplication do not close the missing-publication gap.

TRANSACTIONAL_OUTBOX is the next separate feature. It is documented only, not
implemented here. No exactly-once end-to-end guarantee, Kafka transaction across
databases, GCP, Pub/Sub, OpenAPI or CI/CD is included.

## Verification

Fast tests cover contracts, keys, publish failure boundary, retries, safe DLQ and
failed-routing acknowledgement. Real Kafka tests use unique test topics/groups,
event IDs, ecommerce_test and test-owned cleanup. API test-mode topic defaults
are isolated; the Kafka suite explicitly creates its topics before starting API
and worker. Other runtime regression tests may log unavailable isolated test topics;
this intentionally does not break committed payment state.

Real transient failures use conflicting uncommitted INSERTs for owned event IDs,
with short lock timeouts; no unrelated table/data reset. Tests observe retry traffic,
release the lock for recovery, and hold another owned lock through retry exhaustion.
Broker records, committed offsets and notification uniqueness are asserted.
The authenticated flow uses real Keycloak, separate API/provider/worker processes,
real HTTP/HMAC, topic observation, duplicate delivery and graceful shutdown.

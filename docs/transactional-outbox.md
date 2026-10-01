# Transactional Outbox

## Durable boundary

The API no longer owns a Kafka producer or invokes EventPublisher. A successful
payment webhook persists the event with the business transition, responds, and
leaves publication to a separate relay. Kafka availability cannot prevent this
request from committing when its required databases are healthy.

PostgreSQL: one transaction commits PAID, order_status_history,
processed_webhook_events and outbox_events. Migration 006 adds the outbox with UUID
identity, unique event_id, version/type/aggregate fields, occurred_at, JSONB payload,
status, attempts, available_at, created_at, published_at, safe error category and
lease token. Constraints protect lifecycle fields. Partial indexes support due
work and published-record retention. A failed outbox INSERT rolls back all four.

Mongo standalone: one Order update commits PAID, paymentReceipt and one embedded
outbox record. The receipt contains canonical audit and provider-event identity.
Existing separate audit/dedup collections remain repairable projections; they are
not in a multi-document transaction. A projection failure may return an error
although the atomic document already committed; webhook redelivery repairs it
without resetting the outbox. No separate Mongo outbox collection or replica-set
transaction is claimed. The dispatch index covers embedded status/availability.

The current workflow permits only one OrderPaid terminal transition per Order,
so the embedded record is bounded to one, not an ever-growing event array. Any
future repeat-payment/refund workflow needs an explicit capacity/retention design
before adding events. Published metadata remains embedded until retention cleanup.

## Relay and claims

```sh
cd apps/api
npm run db:migrate
npm run build
# In a separate process; uses the existing selected Order backend:
ORDER_STORAGE=postgres npm run worker:outbox
# Or set the existing private Mongo URI/database and select mongodb.
```

| Setting | Default | Bounds |
| --- | --- | --- |
| OUTBOX_POLL_INTERVAL_MS | 1000 | 100..60000 |
| OUTBOX_BATCH_SIZE | 20 | 1..100 |
| OUTBOX_LEASE_MS | 30000 | 5000..300000 |
| OUTBOX_MAX_ATTEMPTS | 10 | 1..100 |

OutboxRelay uses OutboxRepository, selected as PostgresOutboxRepository or
MongoOutboxRepository. It reuses KafkaEventPublisher and one producer connection.
No SQL/Mongo commands appear in the relay loop. Each poll handles at most the
batch size, claiming each item just before publication so later items do not wait
in a local queue while their leases expire. Idle/error polls wait; no busy-loop.

PostgreSQL claims use a single short atomic CTE UPDATE with SELECT FOR UPDATE
SKIP LOCKED. Mongo uses atomic findOneAndUpdate. Both assign a fresh lease token,
increment attempts once per claim and move availableAt to lease expiry using
database time. Kafka I/O happens after the claim operation releases its locks.
Only the current token can mark success/failure. Expired PROCESSING events can be
reclaimed; a stale owner's acknowledgement cannot overwrite a newer claim.

SIGINT/SIGTERM stops new claims, finishes the current attempt, disconnects Kafka
and closes the selected database. A ten-second shutdown deadline can terminate a
stalled attempt; its durable lease remains recoverable. The relay requires the
selected database and Kafka at startup; after startup, outages produce durable
retry state or recoverable leases. Restart it after a startup dependency failure.
API /health remains liveness and /ready checks required databases, not Kafka.

## Retries, poison and duplicate delivery

The stored OrderPaid version 1/eventId is reused on every send; key remains orderId.
Success marks PUBLISHED and publishedAt. Failure marks PENDING with delays of
1,2,4,8,... seconds capped at 60. At ten claimed attempts it becomes FAILED, retaining
the event. Invalid stored contracts become FAILED immediately. Crashes consume a
claim attempt too; exhausted expired leases become FAILED with LEASE_EXHAUSTED.
Only fixed categories are stored, never exception text, tokens or credentials.

FAILED is an outbox producer-delivery problem, not Kafka's consumer DLQ. The latter
contains already-published events whose consumer could not process them. Inspect
and repair the cause before explicitly requeuing a specific FAILED record: retain
its eventId/payload, reset attempts, set PENDING/availableAt=now, clear lease/error.
Do not automatically delete or silently reset failed/pending records.

Crash after Kafka send but before markPublished can cause the same event to be
published again after lease recovery. Long process pauses can also overlap an
expired lease with a new owner. Tokens fence database acknowledgements, not Kafka
writes. Delivery is AT-LEAST-ONCE, never exactly-once; the existing notification
consumer's unique event ID suppresses duplicate durable side effects. Retry and
multiple-relay scheduling do not guarantee aggregate ordering across events.

The outbox closes the missing-publication crash gap for newly committed events:
DB commit now includes publication intent. Kafka downtime creates backlog instead
of losing that intent. It does not retroactively repair events lost before this
migration. HTTP payment call, DB transaction and Kafka publish still cannot share
one ACID transaction. Provider idempotency/state recovery remain necessary.

## Retention and operations

Automatic cleanup is deliberately not implemented. Operational follow-up is a
scheduled, bounded cleanup of PUBLISHED events older than the chosen retention
period (initial policy: 30 days). Never remove PENDING, PROCESSING or FAILED events.
For PostgreSQL, select a bounded set by published_at then delete only rows still
PUBLISHED below the cutoff. For Mongo, unset only the embedded outbox whose status
is PUBLISHED and publishedAt precedes that cutoff, using those predicates in the
same update. Preserve paymentReceipt and canonical business state. Consumer dedup
receipts must outlive any possible replay; this feature does not delete them.

Monitor outbox_pending_count, oldest_pending_age, publish_failure_count and
publish_latency; alert on FAILED records. Structured logs expose outboxId, eventId,
eventType, aggregateId, attempt, storageBackend and publishStatus, without payloads
or raw provider/DB errors. No metrics stack or administration API was added.

## Verification

All DB automation targets ecommerce_test with owned cleanup; Kafka topics/groups
are unique. Integration files run serially because real relays discover shared
pending queues. Queue tests refuse existing unrelated pending work rather than
consuming/deleting it. Do not run another producer against ecommerce_test during
these tests. No development data was reset and no Kafka/Redis/Keycloak reset occurred.

Tests prove PostgreSQL atomic rollback on outbox insertion conflict, Mongo atomic
status/receipt/outbox, two-adapter contention, expiry recovery, stale-token rejection,
retry timing, retained FAILED state, stable event identity and published status.
Real HTTP tests use Keycloak and the payment-provider process, configure an
unreachable Kafka TCP endpoint for API/failed publication, inspect durable pending
state, then recover with a separate relay and real broker. A successful send with
omitted acknowledgement simulates a crash; a recovered relay republishes and the
consumer retains one notification. Broker container itself remains running.
Opt-in OUTBOX_VERIFY_MONGOSH=1 verifies the owned Mongo document through mongosh.

The existing PostgreSQL status fixture requires an empty products table and still
finds one unrelated row. It is excluded from the focused passing integration run;
that row and fixture are unchanged. This is not a claim that the unfiltered suite
passes. See current-state.md for observed counts.

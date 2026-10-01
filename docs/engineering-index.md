## NODE_STREAMS

Reference feature:
Bulk Product CSV Import

Location:
apps/api/src/modules/products/import/

Flow:
HTTP request stream
→ byte-limit Transform
→ csv-parse Transform
→ async iteration
→ ProductService
→ PostgreSQL

Purpose:
Process large CSV input incrementally rather than loading the
entire file into application memory.

Related:
BACKPRESSURE
ASYNC_ITERATOR
BOUNDED_CONCURRENCY
BATCH_PROCESSING

## BACKPRESSURE

Reference feature:
Bulk Product CSV Import

Mechanism:
The CSV parser is consumed through async iteration. Product rows
are processed in bounded batches. While a batch is being processed,
downstream consumption pauses and stream buffering propagates
pressure toward the HTTP source.

Purpose:
Prevent a fast producer from overwhelming a slower database-backed
consumer.

## BOUNDED_CONCURRENCY

Reference feature:
Bulk Product CSV Import

Implementation:
Maximum five Product create operations are started per batch.

Purpose:
Gain parallel I/O throughput without creating one Promise/database
operation for every row simultaneously.

## EXTERNAL_INPUT_VALIDATION

Reference feature:
Bulk Product CSV Import

Boundary:
CSV values arrive as external strings and are converted to trusted
typed values only after runtime validation.

## ASYNC_ITERATOR

`ProductImportService.importCsv` consumes parsed rows with `for await`.

## BATCH_PROCESSING

At most five validated rows form a batch; the batch settles before more rows are consumed.

## PARTIAL_FAILURE

Independent valid rows persist through ProductService.create. Row validation and
business failures contribute to the summary; at most 100 failure samples are retained,
with bounded SKU/message lengths. Fatal CSV/limit errors return a safe client error;
already completed creates remain persisted (the import is not atomic).

## Import bounds

25 MiB per request, 100,000 data rows, 64 KiB parser record limit, five concurrent
creates. Required headers: sku, name, priceInMinorUnits, stock. Optional status
accepts ACTIVE/INACTIVE and defaults to ACTIVE. Empty files are rejected.
The JSON Product create endpoint retains its existing request contract.

## Payment integration

Reference: [payment integration](payment-integration.md).

| Pattern | Implementation |
| --- | --- |
| ENTERPRISE_INTEGRATION | Separate payment-provider HTTP process and selected Order storage |
| HTTP_CLIENT | HttpPaymentClient, native fetch, validated response |
| TIMEOUT | 3000 ms abort deadline and bounded response body |
| IDEMPOTENCY | Stable payment key in provider SQLite; persisted webhook event IDs |
| WEBHOOK | Route-specific raw-body signed payment callback |
| HMAC_SIGNATURE | SHA-256 plus timingSafeEqual before JSON validation |
| STATUS_WORKFLOW | assertTransition and payment/order relationship validation |
| AUDIT_TRAIL | OrderAuditRepository, event-keyed persisted terminal transitions |
| DOWNSTREAM_FAILURE | Safe errors retain CREATED Order for retry |
| RETRY_SAFETY | Same payment key/event ID; Mongo durable receipt repairs projections |
| DEPENDENCY_INJECTION | OrderService receives PaymentClient and OrderRepository |

## Identity and access control

Reference: [OIDC resource-server authentication](authentication.md).

| Pattern | Implementation |
| --- | --- |
| OAUTH2 | Client credentials for local service identities |
| OIDC | Keycloak issuer discovery; Express resource server |
| JWT | Asymmetrically signed access-token format |
| JWKS | Cached remote public-key verification |
| AUTHENTICATION | Bearer parsing and verified normalized principal |
| AUTHORIZATION | Reusable role middleware before protected module dispatch |
| RBAC | Audience-scoped catalog/order reader, manager and admin roles |
| 401_VS_403 | Invalid identity versus insufficient role |
| SERVICE_IDENTITY | Confidential Keycloak CLI clients with distinct grants |
| TOKEN_VALIDATION | RS256, issuer, audience, required claims, expiry, access-token type |
| KEY_ROTATION | Remote JWKS refresh with cache and cooldown |

## Redis cache and coordination

Reference: [Redis cache and distributed rate limiting](redis-cache-rate-limit.md).

| Concept | Implementation |
| --- | --- |
| REDIS | Dedicated host 6381 service, one injected Node client |
| CACHE_ASIDE | ProductService ID reads through ProductCache |
| CACHE_HIT | Valid cache response avoids PostgreSQL lookup |
| CACHE_MISS | PostgreSQL read followed by atomic SET EX |
| TTL | Configured positive Product expiry |
| CACHE_INVALIDATION | Successful PostgreSQL update/delete then DEL |
| STALE_DATA | DB/cache boundary and concurrent refill; bounded residency |
| CACHE_STAMPEDE | Concurrent misses may duplicate reads; no lock added |
| DISTRIBUTED_RATE_LIMITING | Shared verified-principal Redis state |
| ATOMIC_COUNTER | Lua INCR plus expiry/TTL in one EVAL |
| 429_TOO_MANY_REQUESTS | Safe error envelope with Retry-After |
| FAIL_OPEN | Cache/limiter failure preserves availability and RBAC |
| SOURCE_OF_TRUTH | PostgreSQL authoritative; Redis temporary derived state |

## Kafka Order events

Reference: [Kafka Order event processing](kafka-order-events.md).

| Concept | Implementation |
| --- | --- |
| KAFKA | Dedicated real Apache KRaft broker and KafkaJS |
| TOPIC | Primary, retry and dead-letter streams |
| PARTITION | Three ordered shards per topic |
| OFFSET | Explicit next-offset commit after durable handling |
| MESSAGE_KEY | Order UUID routes related events consistently |
| PRODUCER | One API producer; worker producer for retry/DLQ |
| CONSUMER | Separate process writes durable notification records |
| CONSUMER_GROUP | order-notification-worker shares partition ownership |
| AT_LEAST_ONCE | Repeated delivery across commit/crash boundaries |
| IDEMPOTENT_CONSUMER | Atomic INSERT with unique notification event ID |
| EVENT_CONTRACT | Explicit validated OrderPaid envelope |
| EVENT_VERSIONING | Version 1 accepted; unsupported versions rejected |
| RETRY_TOPIC | Immediate bounded retries for transient storage failures |
| DLQ / DEAD_LETTER_TOPIC | Permanent failures or exhausted retries; safe metadata |
| PARTITION_ORDERING | Sequential per-partition handling; no cross-topic guarantee |
| CONSUMER_REBALANCE | Group redistributes partitions; committed offsets resume |
| DISTRIBUTED_FAILURE | Database commit and Kafka publish are separate operations |
| TRANSACTIONAL_OUTBOX | Atomic business/event intent plus separate durable relay |

## Transactional outbox delivery

Reference: [Transactional Outbox](transactional-outbox.md).

| Concept | Implementation |
| --- | --- |
| TRANSACTIONAL_OUTBOX | PostgreSQL transaction or Mongo single-document update |
| DUAL_WRITE_PROBLEM | Request no longer commits DB then directly publishes Kafka |
| AT_LEAST_ONCE | Send-before-ack crash can redeliver the stable event ID |
| OUTBOX_RELAY | Separate process selects the configured Order storage |
| OUTBOX_POLLING | Bounded work per poll, configurable wait |
| SKIP_LOCKED | PostgreSQL concurrent claims avoid selecting locked rows |
| DURABLE_EVENT | Pending intent survives process/network failure |
| EVENTUAL_CONSISTENCY | Kafka/notification state follows committed Order state |
| RETRY_BACKOFF | Durable exponential schedule capped at 60 seconds |
| POISON_EVENT | FAILED record retained for explicit operational recovery |
| IDEMPOTENT_CONSUMER | Unique notification event ID protects durable side effects |
| DISTRIBUTED_TRANSACTION_BOUNDARY | Payment HTTP, DB and Kafka remain separate systems |

## API documentation
| Concept | Implementation |
|---|---|
| OPENAPI / API_CONTRACT | `apps/api/src/openapi.ts`; runtime Zod input schemas |
| SWAGGER | Configurable `/docs/` and `/openapi.json`; see [API contract](api-contract.md) |

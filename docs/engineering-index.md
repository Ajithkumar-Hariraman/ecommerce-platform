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

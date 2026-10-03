# Payment integration

## Runtime

OrderService receives a PaymentClient and OrderRepository. POST /api/v1/orders
persists CREATED, calls HttpPaymentClient, then saves PAYMENT_PENDING with the
provider paymentId and incremented version. It never marks an order PAID.
POST /api/v1/orders/:id/payment retries initiation for a retained CREATED order.
Already initiated orders return their current representation without creating another payment.
The retry endpoint accepts no business payload; the stored amount is authoritative.

ORDER_STORAGE selects PostgreSQL or Mongo for Orders and payment workflow storage;
Products still require PostgreSQL. There is no dual write or in-memory Order storage.
PAYMENT_PROVIDER_BASE_URL defaults to http://127.0.0.1:4100.
PAYMENT_WEBHOOK_SECRET must be explicitly configured (at least 32 characters).
No real secrets belong in Git. Existing local .env is not changed by this feature.

## Separate provider process

From services/payment-provider-simulator run `npm start` with Node 24 and:

- PAYMENT_WEBHOOK_URL=http://127.0.0.1:3000/api/v1/webhooks/payments
- PAYMENT_WEBHOOK_SECRET set to the same local secret as the API
- PORT=4100 (default), HOST=127.0.0.1 (default)

The simulator uses native HTTP and built-in SQLite, with durable state in ignored
.data/payments.sqlite. PAYMENT_DATABASE_PATH overrides the file for isolated tests.
It is a local external-system simulator, not a commercial provider or payment processor.
No package install is needed for this service. Environment variables are inherited;
it does not automatically load a .env file.

POST /payments requires JSON orderId/amountInMinorUnits and Idempotency-Key.
The stable key payment:<orderId> returns the same payment even after restart;
reusing a key for different input returns 409. No automatic client retry creates new keys.
HttpPaymentClient uses native fetch with a 3000 ms deadline, bounded response size,
no redirects, runtime response validation and safe 502 errors.
PAYMENT_RESPONSE_DELAY_MS is an optional simulator-only timeout exercise, applied
AFTER the payment is persisted. It is not an API production setting.

To deliver a real signed callback, POST /payments/<paymentId>/succeed or /fail
to the provider. Repeating the same trigger redelivers the persisted eventId.
The provider reports 502 on failed delivery; invoke the same trigger to retry.
It has no background retry scheduler. Its trigger endpoints are local developer controls.

## Webhook boundary and status rules

POST /api/v1/webhooks/payments is mounted before the global JSON parser with a
32 KiB route-specific raw body limit. Compressed webhook bodies are rejected.
X-Payment-Signature is the 64-character hex HMAC-SHA256 of the exact JSON bytes.
Length/format checks precede timingSafeEqual. Only after signature verification is
JSON parsed and strictly validated (UUIDs, event type, ISO timestamp).

Accepted transitions: CREATED -> PAYMENT_PENDING, then PAYMENT_PENDING -> PAID
or PAYMENT_FAILED. Missing orders return 404; wrong payment relationships or invalid
transitions return 409. Providers must redeliver callbacks that race pending-state persistence.
A duplicate completed event receives 200 and does not increment the version or append another audit.
Audit history currently records webhook-driven terminal transitions, not a complete history
of initial creation/payment initiation or every repository-level maintenance operation.

## Atomicity and recovery

PostgreSQL: event advisory lock, row lock, optimistic update, audit insertion and
processed event insertion share one transaction. A failed transaction leaves no
partial webhook effect. Audit IDs use event IDs and event IDs are primary keys.
Migration 004 adds only order_status_history and processed_webhook_events.

Mongo standalone: there is NO multi-document transaction. A unique event document
first binds eventId to the validated event identity (processedAt initially null).
An atomic conditional Order update writes terminal status, version and paymentReceipt.
That receipt is the durable source for idempotent audit upsert and final event completion.
If the process fails after the Order changes, redelivery projects the SAME receipt;
status/version are not changed again. Audit/event collections can temporarily lag
Order state. Receipt retention is required for recovery; no TTL is configured.
The single receipt fits the current one-terminal-payment-transition workflow; multiple
payment attempts or refunds require a separately designed state model.
Without provider redelivery or reconciliation, pending projections remain incomplete.

Database commit succeeds -> payment HTTP request occurs -> process/network can fail
between systems. No local database transaction can make this distributed flow ACID.
A safe initiation error includes the retained Order ID and retry route. Retrying
payment creation uses provider idempotency to recover the same paymentId. If the
client loses even the Order creation response, retrying POST /orders may create a
new Order; client request idempotency is not implemented in this phase.

Production integrations combine provider idempotency, bounded retries/backoff,
state machines, reconciliation and a transactional outbox/event delivery mechanism.
This phase provides durable recovery state and explicit retry entry points, not a
background reconciler/outbox, Kafka, Pub/Sub, authentication or rate limiting.

## Verification

Automated database tests use ecommerce_test only and delete their own Order/event IDs.
The suite launches separate API and provider processes, exercises both storage modes,
checks durable audit/event state, duplicate/concurrent callbacks, safe failures,
provider restart idempotency, optimistic conflicts and Mongo projection recovery.
Set MONGODB_TEST_URI privately to include Mongo tests. Never point automated tests
at ecommerce_dev. Standard commands run from apps/api; focused integration:
`node --import tsx --test --test-concurrency=1 test/integration/orders.test.ts test/integration/order-runtime.test.ts test/integration/payment-runtime.test.ts`

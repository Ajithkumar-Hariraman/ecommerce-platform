# Business persistence models

## Runtime ownership

`BUSINESS_STORAGE=postgres|mongodb` selects **all** business repositories in the API,
outbox relay and notification worker. It takes precedence over legacy `ORDER_STORAGE`;
if neither is set, the default is `postgres`. `ORDER_STORAGE` remains a compatibility
fallback and now selects the entire business model, not just Orders.
Set the same selector and database configuration in all three processes and restart
all three together. Do not leave workers from the former mode in the same Kafka group.
Changing the selector does not copy existing records between databases. Existing IDs
and pending payments must be handled in their original database before switching.

Run from `apps/api`, using the same ignored `.env`:

- API: `npm run dev`
- Relay: `npm run worker:outbox:dev`
- Consumer: `npm run worker:orders:dev`

Postgres uses validated `DB_*` settings; Mongo uses `MONGODB_URI` and
`MONGODB_DB_NAME`. Tests use `ecommerce_test` only. Mongo mode does not construct a
PostgreSQL pool or read PostgreSQL credentials. Postgres mode does not connect to Mongo.
Readiness pings the selected database. Shutdown closes only selected database resources.
Redis Product cache keys include storage and database identity, preventing cross-mode
cache hits. This namespace isolates derived cache data; it does not synchronize stores.
Keycloak, Redis, Kafka and Razorpay remain external infrastructure.

## PostgreSQL

Exact schema is defined by migrations 001–007 and the migration runner. No new SQL
migration is required for this slice. Run `npm run db:migrate` for application schema
or `npm run db:migrate:test` for the isolated test schema. Applied migrations are immutable.
Every column below is NOT NULL unless marked **nullable**. PK/UNIQUE create indexes.
`safe` means the inclusive JavaScript safe integer upper bound 9007199254740991.
`timestamp(3)` below means `timestamptz(3)`; unqualified timestamps mean `timestamptz`.

| Table                     | Columns: SQL type, nullability and constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| categories                | `id uuid PK`; `slug text UNIQUE` nonblank; `name text` nonblank; `status text` ACTIVE/INACTIVE, default ACTIVE; `created_at, updated_at timestamp(3)`                                                                                                                                                                                                                                                                                                                                                                      |
| products                  | `id uuid PK`; `sku text UNIQUE` nonblank; `name text` nonblank; `description text nullable`; `price_in_minor_units bigint` 1..safe; `stock bigint` 0..safe; `status text` ACTIVE/INACTIVE, default ACTIVE; `created_at, updated_at timestamp(3)`; `category_id uuid nullable FK categories(id) ON DELETE RESTRICT`                                                                                                                                                                                                         |
| orders                    | `id uuid PK`; `customer_id uuid`; `status varchar(32)` order-status check; `total_in_minor_units bigint` 0..safe; `payment_id uuid nullable`; `version integer` >=1, default 1; `created_at, updated_at timestamp(3)`                                                                                                                                                                                                                                                                                                      |
| order_items               | `id uuid PK`; `order_id uuid FK orders(id) ON DELETE CASCADE`; `product_id uuid` snapshot reference, no FK; `quantity integer` >0; `unit_price_in_minor_units, line_total_in_minor_units bigint` 0..safe                                                                                                                                                                                                                                                                                                                   |
| order_status_history      | `id uuid PK`; `order_id uuid FK orders(id) ON DELETE CASCADE`; `from_status, to_status varchar(32)` order-status check; `reason text` nonempty; `changed_at timestamp(3)`                                                                                                                                                                                                                                                                                                                                                  |
| processed_webhook_events  | `event_id uuid PK`; `processed_at timestamp(3)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| order_notifications       | `event_id uuid PK`; `order_id, payment_id uuid` (no FK); `occurred_at timestamptz`; `processed_at timestamptz` default now()                                                                                                                                                                                                                                                                                                                                                                                               |
| outbox_events             | `id uuid PK`; `event_id uuid UNIQUE`; `event_type text` = OrderPaid; `event_version integer` =1; `aggregate_type text` = Order; `aggregate_id uuid`; `occurred_at timestamptz`; `payload jsonb` object; `status text` PENDING/PROCESSING/PUBLISHED/FAILED, default PENDING; `attempts integer` >=0, default 0; `available_at, created_at timestamptz` default now(); `published_at timestamptz nullable`; `last_error_category text nullable` KAFKA_UNAVAILABLE/INVALID_EVENT/LEASE_EXHAUSTED; `lease_token uuid nullable` |
| razorpay_checkouts        | `order_id uuid PK` (no FK); `payment_id uuid UNIQUE`; `idempotency_key text UNIQUE`; `amount bigint` 100..safe; `currency text` = INR; `provider_order_id text nullable UNIQUE`; `creation_started boolean` default false; `created_at timestamptz` default now()                                                                                                                                                                                                                                                          |
| razorpay_payment_attempts | `provider_payment_id text PK`; `order_id uuid FK razorpay_checkouts(order_id)`; `status text` authorized/captured/failed; `updated_at timestamptz` default now()                                                                                                                                                                                                                                                                                                                                                           |
| razorpay_webhook_events   | `provider_event_id text PK`; `body_hash text`; `processed boolean` default false; `created_at timestamptz` default now()                                                                                                                                                                                                                                                                                                                                                                                                   |
| schema_migrations         | `version text PK`; `checksum text`; `applied_at timestamptz` default now()                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Order statuses: CREATED, PAYMENT_PENDING, PAID, PAYMENT_FAILED, PROCESSING,
SHIPPED, DELIVERED, CANCELLED. Service/workflow rules restrict valid transitions further.
Outbox checks require a lease token exactly for PROCESSING and `published_at` exactly
for PUBLISHED. Product amounts are mapped from bigint to safe JS numbers; domain dates
are ISO strings. Items remain historical snapshots rather than live product-price joins.

Additional indexes:

- `orders_customer_created_idx (customer_id, created_at DESC)`
- `orders_status_created_idx (status, created_at DESC)`
- `order_items_order_idx (order_id)`
- `order_history_order_changed_idx (order_id, changed_at)`
- `order_notifications_order_idx (order_id)`
- `outbox_dispatch_idx (available_at, created_at, id)` WHERE status IN (PENDING, PROCESSING)
- `outbox_published_retention_idx (published_at)` WHERE status = PUBLISHED

Order + item inserts are transactional. A webhook's Order transition, audit, receipt
and outbox insert commit together. Notification insert is also the durable dedupe receipt.
Razorpay's existing per-order advisory lock serializes checkout operations; HTTPS is not
inside a cross-system transaction. Provider intent is saved before creating a remote order.

## MongoDB

All collection documents have a unique built-in `_id` index. UUIDs are strings, not
ObjectIds. Fields listed below are application-required unless marked **optional** or
**nullable**. Numeric fields use JS numbers (driver BSON numeric encoding); amount strings
in Razorpay mappings intentionally preserve the extracted existing mapping contract.
There is no collection-wide `$jsonSchema` validator: API/service validation supplies the
business constraints, indexes enforce uniqueness, and adapters check category references.
Direct administrative writes must honor these contracts. Collections/indexes are created
idempotently by composition; receipt/lock collections are also created on first write.

| Collection                | Exact fields / application and BSON types                                                                                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| categories                | `_id string UUID`; `slug, name string`; `status ACTIVE/INACTIVE`; `createdAt, updatedAt BSON Date`                                                                                                                                                                                             |
| products                  | `_id string UUID`; `sku, name string`; `description string nullable`; `categoryId string UUID nullable` reference to categories; `priceInMinorUnits, stock number`; `status ACTIVE/INACTIVE`; `createdAt, updatedAt BSON Date`                                                                 |
| orders                    | `_id string UUID`; `customerId string UUID`; `items array` embedded item snapshots; `status` order-status string; `totalInMinorUnits number`; `paymentId string UUID nullable`; `version number`; `createdAt, updatedAt BSON Date`; `paymentReceipt object optional`; `outbox object optional` |
| order_status_history      | `_id string UUID` = audit/event ID; `orderId string UUID` reference; `fromStatus, toStatus, reason string`; `changedAt BSON Date`                                                                                                                                                              |
| processed_webhook_events  | `_id string UUID` = event ID; `identity string` serialized full event; `processedAt BSON Date nullable` (null = claimed, not completed)                                                                                                                                                        |
| order_notifications       | `_id string UUID` = event ID; `orderId, paymentId string UUID`; `occurredAt, processedAt BSON Date`                                                                                                                                                                                            |
| razorpay_checkouts        | `_id string UUID` = internal order ID; `payment_id string UUID`; `idempotency_key string`; `amount string` integer minor units; `currency INR`; `provider_order_id string nullable`; `creation_started boolean`; `createdAt BSON Date`                                                         |
| razorpay_payment_attempts | `_id string` provider payment ID; `orderId string UUID` checkout reference; `status authorized/captured/failed`; `updatedAt BSON Date`                                                                                                                                                         |
| razorpay_webhook_events   | `_id string` provider event ID; `body_hash string` SHA-256 hex; `processed boolean`; `createdAt BSON Date`                                                                                                                                                                                     |
| razorpay_operation_locks  | `_id string UUID` order ID; `token string UUID`; `expiresAt BSON Date`                                                                                                                                                                                                                         |

Embedded `orders.items[]`: `productId string UUID`, `quantity number`,
`unitPriceInMinorUnits number`, `lineTotalInMinorUnits number`. No separate item collection.

Embedded `orders.paymentReceipt`: `id, orderId string UUID`, `fromStatus, toStatus,
reason string`, `changedAt BSON Date`, `identity string` serialized event.

Embedded `orders.outbox`: `id string UUID`, `event object`, `status` outbox-status
string, `attempts number`, `availableAt, createdAt BSON Date`, `publishedAt BSON Date
nullable`, `lastErrorCategory string nullable`, `leaseToken string UUID nullable`.
`event` contains `eventId string UUID`, `eventType OrderPaid`, `eventVersion 1`,
`occurredAt ISO string`, `aggregateType Order`, `aggregateId string UUID`,
`payload: { paymentId: string UUID }`.

Indexes in addition to `_id_`:

- categories: unique `categories_slug_key {slug:1}`
- products: unique `products_sku_key {sku:1}`
- orders: `orders_customer_created_idx {customerId:1,createdAt:-1}`;
  `orders_status_created_idx {status:1,createdAt:-1}`;
  `order_outbox_dispatch_idx {"outbox.status":1,"outbox.availableAt":1,"outbox.createdAt":1}`
  with partial filter `{"outbox.id":{$exists:true}}`
- order_status_history: `order_history_order_changed_idx {orderId:1,changedAt:1}`
- order_notifications: `order_notifications_order_idx {orderId:1}`
- razorpay_checkouts: unique `checkout_payment_key {payment_id:1}`;
  unique `checkout_idempotency_key {idempotency_key:1}`;
  unique `checkout_provider_key {provider_order_id:1}` only when provider_order_id is a string
- razorpay_payment_attempts: `checkout_attempts_order_idx {orderId:1}`

Products sort by `{createdAt:1,_id:1}` and count before slicing, matching PostgreSQL
listing semantics. Category existence is checked at writes; there is no category-delete
repository/API, and Mongo does not supply a SQL-style FK against direct admin deletion.
Standalone Mongo atomically stores Order status + canonical payment receipt + outbox in
one document. Audit and processed-event collections are idempotent projections repaired
on redelivery; they may temporarily lag after a crash. No multi-document transaction is
claimed. Notifications atomically insert their event ID, making concurrent redelivery
one durable effect; reuse of an ID with different data is rejected.

Checkout operations acquire an expiring 60-second owner-token lease and renew/check
ownership before each persistence operation. Only the current owner's token can release
it. Durable compare-and-set creation intent prevents a second provider POST even after
lease expiry. Unknown provider outcomes reconcile by receipt rather than blindly retrying.
Razorpay signatures, HTTPS calls and settlement rules are unchanged. Raw provider webhook
identity/hash receipts and payment attempts live in the selected database.

## Ownership comparison

| Business concept | PostgreSQL                                                         | MongoDB                                                           |
| ---------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Product          | products                                                           | products                                                          |
| Category         | categories                                                         | categories                                                        |
| Order            | orders                                                             | orders                                                            |
| Order item       | order_items                                                        | orders.items[]                                                    |
| Payment          | orders.payment_id + razorpay_checkouts / razorpay_payment_attempts | orders.paymentId + razorpay_checkouts / razorpay_payment_attempts |
| History          | order_status_history                                               | canonical orders.paymentReceipt + order_status_history projection |
| Webhook event    | processed_webhook_events + razorpay_webhook_events                 | processed_webhook_events + razorpay_webhook_events                |
| Outbox           | outbox_events                                                      | orders.outbox                                                     |
| Notification     | order_notifications                                                | order_notifications                                               |

SQL normalizes items/history and uses local transactions across tables. Mongo embeds
items and the atomic transition/outbox together, projecting audit receipts separately.
Neither model copies authentication users, passwords or roles. There are no dual writes,
replication jobs, database resets or cross-database transactions.

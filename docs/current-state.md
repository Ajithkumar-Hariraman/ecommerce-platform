# Current state

Operational snapshot; update after a verified milestone. Historical reports may
describe superseded behavior. See [architecture](architecture.md) for stable boundaries.

## Completed

- Phase 1: HTTP foundation, environment validation, centralized errors and shutdown.
- Phase 2: Product domain, CRUD, repository contract and explicit dependency injection.
- Phase 3: PostgreSQL persistence with pg, migrations, constraints, readiness and pool cleanup.
- Phase 4A: Category domain and nullable Product category relationship complete.
- findByStatus practical correction and automated certification complete:
  Repository findByStatus returns Product[]; HTTP listing now wraps products in the pagination envelope.

## Frontend checkpoint

- React + TypeScript + Vite frontend exists in apps/web.
- Category list/create UI and Product CRUD UI are implemented.
- Backend status filtering and Product/Category assignment, change and clearing are available in the UI.
- Native fetch uses the Vite /api proxy to the existing backend.
- Frontend/backend runtime manually launched and confirmed working by the user (2026-09-13).
- Frontend typecheck and production build passed at this checkpoint (2026-09-13).
- Phase 4B.1 Product pagination and Previous/Next controls are implemented.
- User reports visually observing the pagination UI running; no broader manual scenario coverage is claimed.

## Runtime

- API: apps/api; Node 24, Express 5, strict TypeScript/ESM; no ORM.
- server.ts wires Product/Category PostgreSQL adapters using one pool.
- ProductService receives ProductRepository and CategoryRepository.
- PostgreSQL is the active runtime store. InMemoryProductRepository remains for isolated tests.
- GET /api/v1/products?status=ACTIVE or INACTIVE filters the collection.
- Product GET collection returns { products, pagination }; optional status/page/limit, defaults 1/20, limit at most 100.
- Invalid query values return safe 400; absent status lists an unfiltered page; /products/:id still resolves one product.
- Ordering is created_at ASC, id ASC. Count and page are separate reads and can differ during concurrent writes.
- React resets page on status changes; mutations refetch the current page. Previous remains available on an emptied last page.
- POST/GET /api/v1/categories and GET /categories/:id are available.
- Product categoryId may be omitted/null, assigned, changed or cleared. FK uses ON DELETE RESTRICT.
- /health is liveness (200); /ready probes required database/table access (200 or 503).
- Database startup verification precedes listening. HTTP drains before pool shutdown.
- Central config loads apps/api/.env; shell values win. Never expose its contents.
- Development: ecommerce_dev. Automated PostgreSQL tests: ecommerce_test only.

## Phase 4B.1 checkpoint (reviewed 2026-09-29)

- Backend typecheck and frontend typecheck/build passed.
- Focused fast tests: 117 passed; relevant PostgreSQL tests: 31 passed, ecommerce_test only.
- Pagination tests share adapter assertions and clean only their own records.
- User-reported manual evidence: pagination UI visually observed running in the browser.
- No dev servers or browser automation run during review; automated HTTP tests use temporary listeners.
- Personal understanding/unaided reproduction remains unassessed; passing tests does not establish mastery.
- Git checkpoint: this snapshot accompanies `feat: add product list pagination` on main.
- Review required no production-code fixes; all changes are scoped to Phase 4B.1.
- No category filter, search, new sort controls, indexes, migrations or listing transaction added.

## Previous full-suite verification

Latest backend integration verification: 2026-09-11, Phase 4A milestone.

- Typecheck passed; npm test and test:integration rebuild successfully.
- Fast tests: 88 passed, 0 failed.
- PostgreSQL integration tests: 31 passed, 0 failed.
- Counts include parent test groups.
- Status evidence: test/products.test.ts, test/helpers/status-contract.ts,
  test/integration/postgres.test.ts (all under apps/api).
- The PostgreSQL status fixture requires an empty test products table; it refuses
  unrelated rows, locks its transaction and rolls back its own writes. No TRUNCATE.
- Expected error logs occur in intentional failure/recovery tests.

## Product CSV import checkpoint (2026-09-30)

- POST /api/v1/products/import accepts streamed text/csv; bounded parsing and batches
  reuse ProductService.create and existing repositories. Imported status is preserved;
  omitted status defaults to ACTIVE. Existing JSON create validation is unchanged.
- Limits and partial-failure semantics: see [engineering index](engineering-index.md).
- Typecheck/build passed; 130 fast tests and 34 focused PostgreSQL tests passed.
- Full integration run: 34 passed, one existing status fixture failed because it
  requires an empty products table and found one unrelated ecommerce_test row.
  That row was left untouched; no development database was used by these tests.
- Automated in-memory and PostgreSQL HTTP checks cover import persistence, safe
  errors and partial success. No manual browser verification or personal mastery claimed.
- This snapshot accompanies the streamed CSV import commit; pagination is unchanged.

## Order runtime checkpoint (2026-09-30)

- POST /api/v1/orders and GET /api/v1/orders/:id use one OrderService and repository contract.
- ORDER_STORAGE defaults to postgres; mongodb selects MongoOrderRepository only.
- PostgreSQL remains required for Products. Mongo URI/database are required only in Mongo mode.
- Order creation computes safe integer line totals and total; initial state is CREATED,
  paymentId null, version 1. No payment processing or status update HTTP endpoint exists.
- Startup initializes Mongo indexes once; readiness checks PostgreSQL and, when selected,
  Mongo ping. Shutdown drains HTTP before closing the pool and any Mongo client.
- Typecheck/build and 132 fast tests passed; four real Order integration tests passed
  in ecommerce_test, including service arithmetic, HTTP contracts and storage isolation.
- One-off ecommerce_dev smoke checks returned POST 201 / GET 200 in both modes:
  total 120000; PostgreSQL stored one order/two items, Mongo stored one embedded document.
  Cross-store absence was verified and only the two smoke Orders were removed.
- No in-memory Order persistence, dual write, authentication, payment, webhook or UI added.
- Personal understanding remains unassessed. Local infra/compose.yaml remains excluded
  from Git because it contains development credentials.

## Payment integration checkpoint (2026-09-30)

- Order POST now persists CREATED, calls a separate payment provider over HTTP,
  then returns PAYMENT_PENDING with paymentId and version 2. POST /orders/:id/payment
  retries a retained CREATED order using the stable payment:<orderId> key.
- Native-fetch HttpPaymentClient has a 3000 ms timeout and validates bounded responses.
- Local provider process lives in services/payment-provider-simulator; SQLite stores
  idempotent payments and repeatable callback event IDs across process restarts.
- Signed raw-body payment webhooks validate HMAC, event shape, payment relationship
  and state transitions. PAID/PAYMENT_FAILED transitions write audit and dedup records.
- PostgreSQL commits webhook status/audit/event together. Mongo standalone atomically
  stores a receipt with status and repairs audit/event projections on redelivery.
- Migration 004 applied to ecommerce_dev and ecommerce_test; earlier migrations unchanged.
- Typecheck/build passed; 135 fast tests, six Order/payment integration tests and two
  PostgreSQL runtime regressions passed. Database tests used ecommerce_test only.
- Real separate-process HTTP flows passed in both storage modes: pending -> signed
  callback -> paid, duplicate/concurrent delivery without a second audit/version change,
  failure callbacks, provider unavailability/recovery and Mongo projection repair.
- PAYMENT_WEBHOOK_SECRET is required at startup; local .env was not edited.
- Audit currently covers webhook terminal transitions. No background reconciliation,
  outbox, client POST /orders idempotency, payment authentication or commercial provider.
- See [payment integration](payment-integration.md) for commands and distributed failure boundaries.

## OIDC authentication checkpoint (2026-09-30)

- AUTH_ENABLED defaults true; production forbids opt-out and requires HTTPS issuer.
- Real Keycloak 26.7.4 realm ecommerce provides access tokens for ecommerce-api.
- jose verifies RS256 signatures, issuer/audience, expiry and access-token claims with
  cached rotating JWKS. Only audience-scoped client roles confer API permissions.
- Product/Category reads require catalog reader/manager/admin; writes/import require
  catalog manager/admin. Order reads require order reader/manager/admin; mutations
  require order manager/admin. Health/readiness remain public; webhooks remain HMAC-only.
- Typecheck/build passed; 145 fast tests and 25 selected integration/regression tests passed.
- Real Keycloak/API observations: missing/invalid token 401, no-role token 403,
  reader read 200, manager Product/Order create 201, HMAC-only provider callback 200.
- Automated DB checks used ecommerce_test with test-owned cleanup. Existing Mongo/Redis
  containers were left running unchanged; only Keycloak was started.
- infra/compose.yaml now contains environment references only; local credentials live
  in ignored infra/.env. apps/api/.env was not edited. No passwords or tokens committed.
- Frontend login and customer/tenant object-level authorization remain out of scope.
- Setup, commands and security limits: [authentication](authentication.md).

## Redis cache/rate-limit checkpoint (2026-09-30)

- Dedicated ecommerce-redis on loopback 6381; existing Redis6379 remains unchanged.
- One Node Redis client serves validated Product ID cache-aside (default TTL 60s)
  and atomic fixed-window counters keyed by verified principal. No collection caching.
- Successful Product mutations invalidate cache; mutation reads remain authoritative.
- Cache and limiter failures fail open with bounded commands; RBAC remains enforced.
- Redis is optional for readiness. HTTP drains before Redis/database resource closure.
- Typecheck/build passed; 155 fast tests and 47 selected real integration checks passed:
  seven Redis checks, seven OIDC/Order/payment checks, 33 PostgreSQL regressions.
- Separate-process real-token smoke with redis-cli observed PONG, initial miss,
  cache presence/TTL 60, update invalidation/repopulation, 200/200/200/429 with
  Retry-After 60, and graceful Redis shutdown. Only owned ecommerce_test data used.
- No personal understanding claim. This snapshot accompanies the Redis feature commit;
  no merge or push. See [Redis behavior and boundaries](redis-cache-rate-limit.md).

## Kafka Order event checkpoint (2026-10-01)

- Apache Kafka 4.1.2 KRaft runs as ecommerce-kafka; WSL 9093 maps container 9092,
  with separate internal kafka:19092 listener. Three Order topics have three partitions each.
- Durable PAID webhook transitions publish version 1 OrderPaid keyed by Order UUID.
- Separate worker persists a PostgreSQL notification/consumer receipt atomically,
  including when Order runtime uses Mongo. Migration 005 applied to dev and test.
- Manual next-offset commits follow processing or acknowledged retry/DLQ routing.
- Real duplicate, lock-timeout retry/recovery, exhausted retry DLQ, broker metadata,
  authenticated Order/provider/API/worker flow and graceful shutdown checks passed.
- Typecheck/build and 162 fast tests passed; two Kafka integration tests and 48
  selected Redis/OIDC/payment/Order/Product/Category/PostgreSQL regressions passed.
- Automated data uses ecommerce_test and unique Kafka topics/groups/event IDs.
- No personal understanding claim. This snapshot accompanies the Kafka feature commit.
- DB commit then Kafka publish retains an explicit event-loss gap; no outbox added.
  See [Kafka contracts and operating boundaries](kafka-order-events.md).

## Transactional outbox checkpoint (2026-10-01)

- API direct Kafka publication removed; webhook commits durable publication intent.
- PostgreSQL PAID/audit/provider receipt/outbox share one transaction (migration 006).
- Mongo standalone atomically embeds one outbox record with status/canonical receipt;
  separate audit/provider collections remain repairable projections, not one transaction.
- Separate storage-selectable relay uses claim tokens/expiry, SKIP LOCKED or atomic
  findOneAndUpdate, bounded polling, durable backoff and retained FAILED state.
- Kafka contract/key remain stable; send-before-ack crash can redeliver. Notification
  deduplication still produces one durable side effect. No exactly-once claim.
- PostgreSQL/Mongo real HTTP recovery and claim contention checks passed. Kafka was
  made unreachable via a closed endpoint, without stopping the shared broker.
- Automatic retention cleanup is not implemented; published-only 30-day operational
  policy and FAILED recovery are documented in [outbox operations](transactional-outbox.md).
- Typecheck/build and 168 fast tests passed; 57 selected real integration tests passed.
- The existing PostgreSQL status collection fixture requires an empty products table;
  it failed on one unrelated existing row and was excluded from the final scoped run.
  That row was left untouched; the unfiltered integration suite is not certified green.
- Direct mongosh inspection observed test-owned PAID Orders with PENDING and then
  PUBLISHED embedded outbox state. All automated database data used ecommerce_test.
- Personal understanding remains unassessed; this snapshot accompanies the outbox commit.

## Current limits / next boundary

- Offset pagination has safe-integer bounds; deep offsets can be expensive. Same-product updates are last-write-wins.
- Remaining Phase 4B: category filtering, search and sorting, only after explicit authorization.
- Not implemented: microservices, Kubernetes or AWS deployment.
- Local Docker infrastructure exists; it is not a production deployment configuration.
- No next-phase feature is authorized by this snapshot.

## Details on demand

[Phase 1 archive](phase-1.md) · [Phase 2 report](phase-2.md) ·
[Phase 3 report](phase-3.md) · [Phase 4A report](phase-4a.md) · [Learning map](learning-map.md) ·
[PostgreSQL decision](decisions/001-postgresql-raw-sql.md) ·
[Module-boundary decision](decisions/002-modular-monolith.md)

## Platform readiness — checkpoint A (2026-10-01)

- Status integration fixtures now compare a stable baseline plus uniquely owned rows.
- No table-empty prerequisite, table lock, exclusions, or unrelated cleanup.
- Full unfiltered verification: 168 fast tests and 61 integration tests passed; typecheck/build passed.
- Automated persistence checks used ecommerce_test only.

## Platform readiness — checkpoint B

- OpenAPI 3.1 and locally served Swagger UI document existing routes, roles, HMAC, and response envelopes.
- Runtime Zod input schemas are reused; router inventory and OpenAPI validation are tested.
- Full verification: 170 fast tests, 61 integration tests, typecheck/build passed.
- Documentation defaults off in production; see [API contract](api-contract.md).

## Platform readiness — checkpoint C

- Non-root API/web/provider images and full Compose service runtime added.
- Real container HTTP/OIDC/HMAC/cache/outbox/Kafka notification flow passed using ecommerce_test.
- Host and Compose PostgreSQL are separate; existing infrastructure volumes preserved.
- Full checks: 171 fast tests, 61 integration tests, typecheck/build and image builds passed.
- Local HTTP OIDC opt-in is forbidden in production. See [container runtime](container-runtime.md).

## Platform readiness — checkpoint D

- GitHub Actions fast and real-service integration jobs added; no automatic deployment.
- actionlint, private CI configuration generation, frontend CI commands and all 61
  integration checks against Compose PostgreSQL passed. Container smoke passed after API recreation.
- CI verification exposed stale Nginx upstream DNS; request-time Docker DNS resolves recreated API containers.
- No Git remote exists; remote workflow execution is unverified and no push occurred.

## Platform readiness — checkpoint E

- Project-locked GCP deployment script and operating guide added; no cloud resources changed.
- Live deployment blocked: gcloud is absent from WSL/Windows PATH and no standard login configuration was found.
- Account/project, billing/IAM, managed resources and cloud health remain unverified.
- Production requires reachable HTTPS OIDC/payment services and external Redis; Kafka workers require a separate hosting decision.
- JSON runtime logging verified. Full checks: 172 fast and 61 integration tests, typecheck/build passed.
- See [GCP deployment](gcp-deployment.md) for plan, apply prerequisites and exact next actions.

## Platform readiness — final checkpoint F (2026-10-02)

- Full unfiltered backend verification: 172 fast and 61 integration tests passed; no exclusions/skips.
- Backend/frontend typecheck/build, Docker images, container E2E and workflow lint passed.
- CSV import spec correction and idle Kafka request-timeout fix verified; no unrelated feature changes.
- GCP foundation committed; live cloud deployment and remote GitHub execution remain unverified.
- This supersedes the historical status-fixture exclusion above. No personal-understanding claim.
- Detailed evidence and operational boundaries: [platform readiness](platform-readiness.md).

## Razorpay integration — pending live verification

- Implemented Test Mode HTTPS adapter behind PaymentClient, provider-ID mapping, hosted React checkout and separately signed raw-body webhook. See [setup and failure boundaries](razorpay.md).
- Existing local provider remains selectable. Order UUIDs, durable paid outbox and Kafka contracts are retained.
- Automated verification: 46 focused payment/Razorpay/auth/outbox tests passed, including real PostgreSQL and MongoDB ecommerce_test runs; backend/frontend typecheck and build passed.
- Migration 007 applied to test and development PostgreSQL. Test cleanup targets only owned records.
- Live Razorpay transaction is not verified. Private webhook-secret configuration must meet validation and match Dashboard before API restart and hosted checkout verification.
- Changes remain uncommitted pending live verification. Personal understanding is not assessed by automated tests.

## Authenticated Order ownership checkpoint (2026-10-03)

- New Orders derive immutable ownerSubject from the verified JWT sub; request-provided customerId/ownerSubject are rejected. Checkout no longer asks for a customer reference.
- Owners can read/resume/checkout their Orders; unrelated users receive safe 404. Existing order_manager/admin elevation remains. Historical Orders have no implicit owner and require elevated access.
- Both PostgreSQL and MongoDB persist the subject reference; no identity profiles or passwords are copied. Migration 008 is additive and leaves historical customer IDs intact.
- Automated ownership and payment regression verification uses ecommerce_test and owned-record cleanup. Browser verification and personal understanding are not claimed.
- Cloud resource names are supplied; deployment remains pending. Earlier cloud and live-payment entries above are historical evidence.

## Pub/Sub transport checkpoint (2026-10-03)

- EVENT_TRANSPORT selects Kafka (unchanged local default) or Pub/Sub behind EventPublisher; durable outbox and notification contracts are retained.
- Pub/Sub uses ADC/runtime identity, bounded subscriber flow control, validation before persistence, and acknowledgement after durable processing/deduplication. Subscription retries/DLQ handle rejected events.
- Sixteen focused Kafka/outbox/Pub/Sub checks passed; a real Google Pub/Sub + PostgreSQL ecommerce_test flow published the outbox event and persisted exactly one notification after duplicate delivery. Test-owned cloud resources/schema were removed. Backend typecheck/build passed.
- Migration 009 identifies Pub/Sub publication failures separately. No cloud application deployment or browser verification is claimed. See [Pub/Sub transport](pubsub-events.md).

## Product image checkpoint (2026-10-03)

- Implemented signed Cloud Storage upload, bounded metadata/header validation, immutable asset references in both repositories, cache invalidation and a minimal React upload/preview flow.
- Focused checks: 80 passed; all three real PostgreSQL/Mongo/GCS integration checks passed with no skips. Live signed PUT/GET, immutable generation and overwrite rejection were observed. Backend/frontend typecheck and builds passed.
- Migration 010 applied to development and test PostgreSQL through the checksum-verified migration runner. This snapshot accompanies the product image commit. No browser verification or production deployment claimed.
- The explicitly approved operator Token Creator grant was temporary, scoped to the runtime service account, removed immediately after the live test, and verified absent. No keys were created/downloaded. Runtime bucket permissions and self-signing permission remain configured.
- Production Keycloak and Redis/VPC are not provisioned, so Cloud Run deployment is blocked. See [product images](product-images.md).

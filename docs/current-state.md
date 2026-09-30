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

## Current limits / next boundary
- Offset pagination has safe-integer bounds; deep offsets can be expensive. Same-product updates are last-write-wins.
- Remaining Phase 4B: category filtering, search and sorting, only after explicit authorization.
- Not implemented: authentication, Redis, Kafka, microservices, Docker,
  Kubernetes or AWS deployment/infrastructure.
- No next-phase feature is authorized by this snapshot.

## Details on demand
[Phase 1 archive](phase-1.md) · [Phase 2 report](phase-2.md) ·
[Phase 3 report](phase-3.md) · [Phase 4A report](phase-4a.md) · [Learning map](learning-map.md) ·
[PostgreSQL decision](decisions/001-postgresql-raw-sql.md) ·
[Module-boundary decision](decisions/002-modular-monolith.md)

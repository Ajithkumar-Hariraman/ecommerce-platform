# Current state

Operational snapshot; update after a verified milestone. Historical reports may
describe superseded behavior. See [architecture](architecture.md) for stable boundaries.

## Completed
- Phase 1: HTTP foundation, environment validation, centralized errors and shutdown.
- Phase 2: Product domain, CRUD, repository contract and explicit dependency injection.
- Phase 3: PostgreSQL persistence with pg, migrations, constraints, readiness and pool cleanup.
- Phase 4A: Category domain and nullable Product category relationship complete.
- findByStatus practical correction and automated certification complete:
  ACTIVE/INACTIVE filtering returns Product[]; zero matches returns [] with HTTP 200.

## Runtime
- API: apps/api; Node 24, Express 5, strict TypeScript/ESM; no ORM.
- server.ts wires Product/Category PostgreSQL adapters using one pool.
- ProductService receives ProductRepository and CategoryRepository.
- PostgreSQL is the active runtime store. InMemoryProductRepository remains for isolated tests.
- GET /api/v1/products?status=ACTIVE or INACTIVE filters the collection.
- Invalid status returns 400; absent status lists all; /products/:id still resolves one product.
- POST/GET /api/v1/categories and GET /categories/:id are available.
- Product categoryId may be omitted/null, assigned, changed or cleared. FK uses ON DELETE RESTRICT.
- /health is liveness (200); /ready probes required database/table access (200 or 503).
- Database startup verification precedes listening. HTTP drains before pool shutdown.
- Central config loads apps/api/.env; shell values win. Never expose its contents.
- Development: ecommerce_dev. Automated PostgreSQL tests: ecommerce_test only.

## Verification
Latest verified run: 2026-09-11, Phase 4A milestone.
- Typecheck passed; npm test and test:integration rebuild successfully.
- Fast tests: 88 passed, 0 failed.
- PostgreSQL integration tests: 31 passed, 0 failed.
- Counts include parent test groups.
- Status evidence: test/products.test.ts, test/helpers/status-contract.ts,
  test/integration/postgres.test.ts (all under apps/api).
- The PostgreSQL status fixture requires an empty test products table; it refuses
  unrelated rows, locks its transaction and rolls back its own writes. No TRUNCATE.
- Expected error logs occur in intentional failure/recovery tests.

## Current limits / next boundary
- Unpaginated collection; same-product updates are last-write-wins.
- Next intended work: Phase 4B Product Catalog filtering/pagination/sorting, only after explicit authorization.
- Not implemented: authentication, Redis, Kafka, microservices, React, Docker,
  Kubernetes or AWS deployment/infrastructure.
- No next-phase feature is authorized by this snapshot.

## Details on demand
[Phase 1 archive](phase-1.md) · [Phase 2 report](phase-2.md) ·
[Phase 3 report](phase-3.md) · [Phase 4A report](phase-4a.md) · [Learning map](learning-map.md) ·
[PostgreSQL decision](decisions/001-postgresql-raw-sql.md) ·
[Module-boundary decision](decisions/002-modular-monolith.md)

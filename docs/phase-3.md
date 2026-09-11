# Phase 3 — PostgreSQL persistence and learning report

Completed on 2026-09-11 in Ubuntu 24.04 WSL, PostgreSQL 16.15, Node 24.18.0.
The real runtime now uses PostgreSQL. ProductService and ProductRepository remain unchanged. No Phase 4 features were implemented.

## What changed

```text
apps/api/
├── .env                         local, ignored, mode 600; never publish
├── .env.example                 placeholders/defaults only
├── migrations/
│   └── 001_create_products.sql
├── sql/
│   └── product-learning.sql
├── scripts/
│   └── verify-postgres.ts
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── lifecycle.ts
│   ├── config/env.ts
│   ├── database/
│   │   ├── pool.ts
│   │   └── migrate.ts
│   └── modules/products/
│       ├── postgres-product.repository.ts
│       ├── product-row.ts
│       ├── product.module.ts
│       ├── product.repository.ts          unchanged abstraction
│       ├── product.service.ts             unchanged business logic
│       └── in-memory-product.repository.ts retained for fast tests
└── test/
    ├── helpers/app.ts
    ├── fixtures/server.ts
    ├── integration/postgres.test.ts
    ├── api.test.ts
    ├── products.test.ts
    └── lifecycle.test.ts
```

Added: migration, pool, migration runner, PostgreSQL adapter, row mapper, shared lifecycle file, memory test helper/fixture, integration tests, manual verification script, SQL learning file, this report.
Modified: central env config, app/server composition, product.module.ts, package.json/lock, .env.example, README, existing tests to explicitly inject memory.
The HTTP routes, controllers, service, repository interface, and AppError behavior were preserved. The existing lifecycle implementation moved into lifecycle.ts so both the PostgreSQL runtime and isolated test fixture execute the same drain logic.

Dependencies added:

- pg 8.23.0: PostgreSQL driver and reusable connection pool.
- @types/pg 8.23.1: development-only TypeScript declarations.
  No ORM, dotenv, migration framework, or test framework was added. Node's built-in loadEnvFile is used by the config module.

## Local setup and credentials

The user installed/started PostgreSQL and created the dedicated role/databases after sudo required interactive credentials.
Verified by SQL:

- ecommerce_dev, owner ecommerce_app.
- ecommerce_test, owner ecommerce_app.
- ecommerce_app is not a superuser, cannot create databases, and cannot create roles.
  The role owns these local databases, allowing explicit migrations. A separate migration owner and narrower runtime grants can be introduced for deployment later.

The user saved a development-only DB_PASSWORD. The file was moved from repository root to apps/api/.env. The user corrected root ownership to ak_soft_2017; permissions remain 600. git check-ignore confirmed it is ignored. No password is printed here or committed.

Configuration uses separate DB_HOST, DB_PORT, DB_NAME, DB_TEST_NAME, DB_USER, DB_PASSWORD fields. This avoids URL-encoding passwords and makes each connection setting visible to a learner.
Only config/env.ts reads these settings. Tests and the explicit manual script copy process.env solely to construct child-process environments.
.env is loaded relative to the API module, so src and dist work the same; existing shell variables take precedence.

Local defaults: 127.0.0.1, port 5432, ecommerce_dev, ecommerce_test, ecommerce_app.
DB_PASSWORD is required. Production requires explicit nonempty host/name/user/password. Invalid ports fail before opening a pool.
The test target must be named ecommerce_test, must differ from explicitly configured DB_NAME, and is forbidden in NODE_ENV=production.
NODE_ENV=test selects the test database in the real server. Integration code always calls loadDatabaseConfig("test").

## Commands and verification

Application work executed:

```sh
npm install pg
npm install -D @types/pg
npm run db:migrate
npm run db:migrate:test
npm run typecheck
npm run build
npm test
npm run test:integration
node --import tsx scripts/verify-postgres.ts
```

The manual script started npm run dev, performed HTTP/SQL checks, stopped it, restarted it, and checked persistence.
product-learning.sql was also executed through psql with ON_ERROR_STOP=1; its demonstration writes were rolled back.

Normal workflow:

```sh
cd /home/ak_soft_2017/projects/ecommerce-platform
source ~/.nvm/nvm.sh
nvm use
cd apps/api
npm ci
# Fill private .env using .env.example; never commit it.
npm run db:migrate
npm run dev
```

For built execution: npm run build, then npm start.
For compiled migrations without tsx installed: node dist/database/migrate.js (or append --test).
Run SQL examples manually:

```sh
psql -h 127.0.0.1 -U ecommerce_app -d ecommerce_dev -W -v ON_ERROR_STOP=1 -f sql/product-learning.sql
```

-W prompts privately; do not put your password in the command line.

Results:

- PostgreSQL connectivity passed.
- Migration applied once in each dedicated database.
- Migration rerun reported Already applied; no table reset.
- Typecheck passed; build passed.
- Fast tests: **57 passed**, zero failed/skipped.
- Real PostgreSQL integration tests: **17 passed**, zero failed/skipped.
- Existing health/errors/product HTTP tests use explicit memory injection.
- Existing lifecycle scenarios use the shared lifecycle with a memory fixture, preserving independence from PostgreSQL.
- Integration scenarios additionally launch the compiled real server and verify PostgreSQL startup and shutdown.
- Real repository checks include create/read/list/update/delete, null/boolean absent results, mapping, exact safe-integer boundary, concurrent create/update uniqueness, persistence with a new pool, and SQL-injection-shaped values treated as data.
- Direct SQL rejects invalid stock/price/status, unsafe integers, fractional bigint input, null and blank name.
- Tests use randomized UUID/SKU records and delete only their own IDs; no TRUNCATE/reset and no development-database integration tests.

Manual API/SQL evidence:

- /health 200, /ready 200.
- POST 201; direct SQL showed price_in_minor_units='49999', stock='2', correct UUID and UTC timestamps.
- Stopped/restarted the actual dev API; GET still returned the inserted product.
- Duplicate POST 409.
- PUT 200; direct SQL showed stock='8', status='INACTIVE', unchanged created_at and updated updated_at.
- Negative-stock request 400.
- Collection GET 200; DELETE 204; SQL count for deleted ID was 0.
- Subsequent GET 404; unknown route retained JSON 404.
- Shutdown logs showed HTTP server closed before PostgreSQL pool closed.
- Smoke records were removed; SQL learning writes rolled back. No API process was intentionally left running.

Failure/recovery verification:

- An isolated TCP proxy interrupted only the integration test's database connection; PostgreSQL service itself remained running.
- During the interruption: /health remained 200, /ready returned safe 503, product request returned generic 500.
- Restoring connectivity returned /ready to 200.
- Compiled runtime pointing at an unavailable port exited 1 before listening.
- Compiled runtime handled both SIGINT and SIGTERM with HTTP → pool close → exit 0.
- Stopping the shared PostgreSQL service was unnecessary and would have required another privileged operation; the proxy exercised real connection failure without affecting other sessions.
- Forced 10-second shutdown termination is implemented but not deliberately exercised.

Errors and fixes:

1. Earlier sudo required a password; the user performed privileged setup interactively. No credentials were bypassed or stored.
2. .env was saved in the repository root under root ownership. It was moved to apps/api/.env, and the user corrected ownership. Database migration then succeeded.
3. One fast lifecycle test failed because the new test fixture called loadEnv outside its async startup catch. Moving it inside async main restored the expected startup diagnostic. All 57 passed afterward.
4. npm emitted the existing esbuild install-script advisory; builds/watch/tests worked. No blanket script approval was enabled.
   Expected error logs in tests come from deliberate failures, not test failures. npm reported zero vulnerabilities at installation time.

## Migration and table definition

The exact SQL is in ../apps/api/migrations/001_create_products.sql:

```sql
CREATE TABLE public.products (
  id uuid CONSTRAINT products_pkey PRIMARY KEY,
  sku text NOT NULL CONSTRAINT products_sku_key UNIQUE,
  name text NOT NULL,
  description text,
  price_in_minor_units bigint NOT NULL,
  stock bigint NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(3) NOT NULL,
  updated_at timestamptz(3) NOT NULL,
  CONSTRAINT products_sku_not_blank CHECK (sku ~ '[^[:space:]]'),
  CONSTRAINT products_name_not_blank CHECK (name ~ '[^[:space:]]'),
  CONSTRAINT products_price_check CHECK (price_in_minor_units BETWEEN 1 AND 9007199254740991),
  CONSTRAINT products_stock_check CHECK (stock BETWEEN 0 AND 9007199254740991),
  CONSTRAINT products_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'))
);
```

UUID stores server-generated identity. text avoids arbitrary length policy not present in Phase 2.
Both numeric fields use bigint, an integer type. PostgreSQL integer/int4 stops at 2,147,483,647, while Phase 2 accepts JavaScript safe integers through 9,007,199,254,740,991. bigint plus explicit bounds preserves that contract for stock as well as price.
timestamptz stores an instant; precision 3 matches JavaScript milliseconds. The service supplies timestamps, and the mapper emits UTC ISO strings. No database trigger or automatic updated_at behavior is hidden here.
The adapter UPDATE deliberately omits id and created_at from SET.

The database's blank checks provide a basic non-whitespace invariant. HTTP/service normalization remains responsible for trimming before storage; direct SQL callers must follow that normalization policy.

The migration runner keeps version, SHA-256 checksum, and applied_at in schema_migrations.
It checks out one client, begins a transaction, takes a transaction-scoped advisory lock, applies unapplied local SQL files, records versions, and commits. Failure rolls back and releases the client. Previously applied migration edits fail checksum validation; add a new migration instead.
App startup verifies the table and columns but does not migrate automatically.

Observed indexes:

- products_pkey: unique B-tree on id, supporting PRIMARY KEY.
- products_sku_key: unique B-tree on sku, supporting UNIQUE.
  No speculative indexes were added.

After ANALYZE on a one-row development table, both SKU and ID lookups reported:

```text
Seq Scan on products  (cost=0.00..1.01 rows=1 width=140)
  Filter: (sku = '<smoke SKU>'::text)
```

The ID plan had an equivalent UUID filter. The table was tiny, so scanning it was estimated cheaper than index traversal. This is planner evidence, not a benchmark or proof that indexes do not help at scale.
EXPLAIN estimates a plan; EXPLAIN ANALYZE actually executes and measures it. We ran EXPLAIN, not EXPLAIN ANALYZE.

## Request flows

CREATE PRODUCT

HTTP POST
↓
Zod validation
↓
Controller
↓
ProductService
↓
ProductRepository contract
↓
PostgresProductRepository
↓
parameterized INSERT
↓
PostgreSQL constraint checks
↓
row returned
↓
row mapper
↓
Product
↓
HTTP 201

The contract is a TypeScript abstraction, not an extra runtime object. server.ts creates one Pool and passes new PostgresProductRepository(pool) into createApp. product.module.ts injects that repository into the unchanged ProductService.

TWO SIMULTANEOUS SAME-SKU REQUESTS

Request A checks SKU
→ absent

Request B checks SKU
→ absent

A INSERT
B INSERT
↓
PostgreSQL UNIQUE constraint
↓
one succeeds
one unique violation
↓
repository/application translates error
↓
HTTP 409

The service pre-check improves the ordinary path but cannot serialize concurrent requests.
The adapter maps SQLSTATE 23505 only for products_sku_key to the existing DuplicateSkuError. ProductService already maps that error to AppError 409.
CHECK/NOT NULL/range violations map to safe AppError 400. Other storage errors become sanitized unexpected errors and generic HTTP 500; SQL values, raw detail, connection strings and passwords are not returned.

## Pool and lifecycle

Pool → manages reusable DB connections.
Request → pool.query borrows a connection → runs a statement → returns it automatically.
The app has one pool with maximum 5 connections, 3-second acquire/connect timeout, 10-second idle timeout, 5-second server statement timeout, and 6-second client query timeout. These are modest local limits, not claims of production capacity tuning.
Idle connection failures have an error listener; connections can be replaced on subsequent requests.

Startup: validate env → create pool → check products table/columns → construct app → listen.
Database startup failure closes the pool and exits 1 before the app announces readiness.
A listen/bind failure also closes the pool.

SIGINT/SIGTERM:
HTTP server stops accepting new requests
↓
in-flight HTTP requests drain
↓
PostgreSQL pool closes
↓
process exits

A single 10-second deadline covers HTTP and resource cleanup; deadline expiry forces exit 1. Repeated signals do not reset it. The pool stays usable until HTTP requests finish.
Liveness /health is the unchanged process check. /ready performs the lightweight required-table query, reports 200 or safe 503, and does not create schema or inspect every possible future dependency.

## File guide

FILE: apps/api/src/config/env.ts
WHY: Centralize local environment loading and validated HTTP/database settings.
WHO CALLS IT: Server, migration runner, integration/manual setup.
INPUT: Private .env and shell variables.
OUTPUT: Typed Env and DatabaseConfig; explicit guarded test target.
WHAT CAN FAIL: Missing password/production settings, invalid port, invalid test target, unreadable config. Never log returned database configuration.

FILE: apps/api/src/database/pool.ts
WHY: Create one bounded reusable pool and a required-schema probe.
WHO CALLS IT: Server, migrations and integration/manual code.
INPUT: Validated DatabaseConfig.
OUTPUT: pg Pool; verifyDatabase resolves on usable migrated storage.
WHAT CAN FAIL: Authentication, connection refusal, acquire timeout, missing table/columns, query timeout.

FILE: apps/api/src/database/migrate.ts
WHY: Apply versioned, reviewed SQL explicitly and reproducibly.
WHO CALLS IT: db:migrate or db:migrate:test.
INPUT: Target configuration and migration files.
OUTPUT: Updated schema plus migration history.
WHAT CAN FAIL: Connectivity, SQL errors, concurrent lock timeout, edited migration checksum; transaction rolls back.

FILE: apps/api/migrations/001_create_products.sql
WHY: Establish persistent product structure and integrity constraints.
WHO CALLS IT: Migration runner.
INPUT: PostgreSQL DDL.
OUTPUT: products table and implicit PK/unique indexes.
WHAT CAN FAIL: Missing DDL privileges or unexpected existing schema; do not modify once applied.

FILE: apps/api/src/modules/products/product-row.ts
WHY: Translate PostgreSQL representations into the existing domain model.
WHO CALLS IT: PostgreSQL repository after SELECT/RETURNING.
INPUT: Snake_case ProductRow, bigint strings and Date timestamps.
OUTPUT: CamelCase Product with safe numbers and ISO strings.
WHAT CAN FAIL: Out-of-range stored integers or invalid row representation; database bounds and integration tests protect the expected path.

FILE: apps/api/src/modules/products/postgres-product.repository.ts
WHY: Implement the unchanged ProductRepository with visible parameterized SQL.
WHO CALLS IT: ProductService through constructor injection.
INPUT: Products/IDs/SKUs and one injected Pool.
OUTPUT: Product(s), null, boolean; translated expected errors.
WHAT CAN FAIL: Uniqueness/integrity errors, database outage, unexpected storage failure. The private rows helper centralizes error translation; interpolated column lists are static trusted constants, all values are parameters.

FILE: apps/api/src/lifecycle.ts
WHY: Reuse existing HTTP lifecycle while adding ordered async resource cleanup.
WHO CALLS IT: Real server and isolated lifecycle fixture.
INPUT: Express app, Env, async closeResources callback.
OUTPUT: Listening server and signal-driven shutdown.
WHAT CAN FAIL: Bind failure, HTTP close error, cleanup error or deadline expiry.

FILE: apps/api/src/server.ts
WHY: Compose real PostgreSQL resources and fail fast before listening.
WHO CALLS IT: npm run dev or npm start.
INPUT: Validated config.
OUTPUT: Runtime using PostgreSQL and a pool shutdown callback.
WHAT CAN FAIL: Configuration, database/schema probe or listen failure.

FILE: apps/api/src/app.ts
WHY: Assemble routes independently of server/process/database creation.
WHO CALLS IT: Server and HTTP tests.
INPUT: Injected ProductRepository and checkReady function.
OUTPUT: Express app with /health, /ready and products.
WHAT CAN FAIL: Readiness failure becomes 503; route errors use existing central handler.

FILE: apps/api/src/modules/products/product.module.ts
WHY: Wire controller/service using the repository supplied by the outer composition root.
WHO CALLS IT: createApp.
INPUT: ProductRepository.
OUTPUT: Product router.
WHAT CAN FAIL: Incorrect wiring; no storage is created inside ProductService.

FILE: apps/api/test/helpers/app.ts
WHY: Keep fast HTTP tests isolated from persistence setup.
WHO CALLS IT: Existing API/product tests and lifecycle fixture.
INPUT: None.
OUTPUT: Fresh in-memory app per call.
WHAT CAN FAIL: HTTP behavior regressions; this helper does not claim PostgreSQL readiness.

FILE: apps/api/test/fixtures/server.ts
WHY: Exercise the shared process lifecycle without requiring a database.
WHO CALLS IT: Existing lifecycle child-process tests and test watcher.
INPUT: Test process environment.
OUTPUT: In-memory fixture server with normal startup diagnostics.
WHAT CAN FAIL: Invalid env, occupied port, shutdown regressions.

FILE: apps/api/test/integration/postgres.test.ts
WHY: Prove real SQL behavior, failure translation, HTTP/runtime integration and cleanup.
WHO CALLS IT: test:integration after test migrations.
INPUT: ecommerce_test only, unique records and local fault-injection proxy.
OUTPUT: 17 passing tests; deletes only generated test IDs.
WHAT CAN FAIL: Missing test config/schema, storage regressions, leaked clients, readiness/shutdown failures.

FILE: apps/api/scripts/verify-postgres.ts
WHY: Repeat the explicit developer API/SQL/restart inspection.
WHO CALLS IT: Developer invocation; not npm test or integration tests.
INPUT: ecommerce_dev only.
OUTPUT: HTTP/SQL/schema/index/EXPLAIN evidence; cleans only its own records.
WHAT CAN FAIL: Development connectivity/startup/assertion failures; uses POSIX process groups to stop its watcher.

FILE: apps/api/sql/product-learning.sql
WHY: Practice actual product SELECT/INSERT/UPDATE/DELETE/filter/order/count and EXPLAIN.
WHO CALLS IT: psql -f.
INPUT: An intentional development connection.
OUTPUT: Query results; sample DML is rolled back.
WHAT CAN FAIL: Missing schema/permissions or SQL failures. psql variables use quoted literal substitution.

FILE: apps/api/.env.example
WHY: Document supported configuration without real credentials.
WHO CALLS IT: Developer copying settings to private .env.
INPUT: Placeholder/default text.
OUTPUT: Configuration reference.
WHAT CAN FAIL: Unchanged password placeholder is rejected.

FILE: docs/phase-3.md
WHY: Preserve the verified design, SQL and interview explanations.
WHO CALLS IT: Developers.
INPUT: Implementation and observed results.
OUTPUT: This report.
WHAT CAN FAIL: Documentation drift after future edits.

## Interview questions answered with this implementation

1. **Why a pool?** createPool reuses up to five connections across product queries instead of repeating connection/authentication handshakes.
2. **Why not a connection per request?** Unbounded request-driven connections would add overhead and could overwhelm PostgreSQL; pool.query handles checkout/return.
3. **Why the interface still matters?** ProductService accepts ProductRepository unchanged while runtime and fast tests inject different adapters.
4. **Why SQL outside the service?** Business rules stay readable and storage-independent; only the PostgreSQL adapter knows table/column syntax.
5. **Parameterized query?** findById uses WHERE id=$1 and supplies [id] separately.
6. **How prevent injection?** Input is transmitted as a value, never inserted into SQL syntax. The SQL-looking SKU integration case is stored literally. Parameters do not parameterize table identifiers; our identifiers are static.
7. **Primary key vs UNIQUE?** products.id is unique and non-null identity. sku has independent UNIQUE and NOT NULL constraints because it is a business identifier.
8. **NOT NULL?** Prevents absent required stored values, including when direct SQL bypasses HTTP.
9. **CHECK?** products_stock_check prevents negative/unsafe stock; status and price checks enforce their allowed sets/ranges.
10. **Why Zod and PostgreSQL?** Zod rejects wrong shape/type at HTTP, service owns semantic rules/normalization, constraints protect stored rows regardless of writer. Negative numeric stock currently passes the shape-only Zod number check and is rejected by the service; a raw SQL attempt is rejected by CHECK.
11. **Why duplicate pre-check insufficient?** Both requests can read absence before either inserts; only the database unique write guarantee resolves the race.
12. **Migration?** 001_create_products.sql is a versioned schema change tracked with checksum/applied time.
13. **Why avoid manual production schema edits?** They bypass reproducible history and can make environments diverge. Add/review/run another migration.
14. **Transaction?** A set of statements that succeeds or fails as a unit; the migration runner legitimately groups DDL and history writes.
15. **COMMIT vs ROLLBACK?** COMMIT makes that transaction's changes durable; ROLLBACK discards them.
16. **Why no transaction wrapper around each product statement?** PostgreSQL already runs each standalone statement atomically. Multi-step checkout/inventory will need a meaningful transaction later.
17. **Index?** A lookup structure; PostgreSQL created B-tree indexes for the primary key and unique SKU.
18. **Sequential vs index scan?** Sequential examines table rows; index scan follows matching index entries to rows. Tiny tables can favor sequential scans.
19. **EXPLAIN?** Shows planner estimates and selected operations, not measured latency. Our one-row lookup showed Seq Scan.
20. **Pool exhaustion?** All five connections are busy or leaked; subsequent callers wait and can reach the 3-second timeout. pool.query avoids manual-release omissions for CRUD; migration releases its checked-out client in finally.
21. **/health vs /ready?** /health says HTTP is alive; /ready tests required migrated database access.
22. **PostgreSQL unavailable?** Startup fails before listening. After startup, readiness is 503 and product failures are safe 500; health remains 200. Recovery was verified.
23. **Graceful shutdown?** Stop new HTTP work, drain active requests, await pool.end, exit; one deadline bounds the whole process.
24. **Why row mapping?** Database snake_case, bigint strings and Date objects should not leak into the existing camelCase/number/ISO domain contract.

## Transaction shape for later business workflows

Illustration only; not added to Product CRUD:````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````

```ts
const client = await pool.connect();
try {
  await client.query("BEGIN");
  // await client.query(firstParameterizedStatement, firstValues);
  // await client.query(secondParameterizedStatement, secondValues);
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}
```

Use the same checked-out client for every statement. Calling pool.query for BEGIN and subsequent statements could use different connections.

BEGIN → query/query/query → COMMIT
Failure: BEGIN → query → error → ROLLBACK

## Exact modification map

- **Add Product column:** new migrations/002\_\*.sql; product.ts input/domain fields; product.validation.ts schema/projections; product.service.ts rules/construction; product-row.ts mapping; postgres-product.repository.ts columns/INSERT/UPDATE; pool.ts schema probe if required; HTTP/integration tests. A scalar field is automatically copied by the memory adapter, but review its contract.
- **Add DB constraint:** new SQL migration and integration test; adjust repository error mapping only if a new expected error meaning needs a distinct safe response.
- **Change lookup SQL:** postgres-product.repository.ts and integration tests; add an index migration only when a query plan/workload justifies it.
- **Change connection config:** config/env.ts and .env.example; change pool limits/timeouts in database/pool.ts; keep real credentials private.
- **Add repository query:** product.repository.ts contract; implement both adapters; add service/controller/route/validation if externally exposed; test both behavior and real SQL.
- **Replace PostgreSQL with another relational database:** add another adapter implementing ProductRepository, its pool/config/migrations, change server.ts composition and readiness/cleanup. ProductService can stay unchanged if contract semantics remain the same.

## Practical limits

Same-product updates retain Phase 2 last-write-wins behavior; uniqueness is protected, but optimistic locking/reservations are not implemented.
Collection remains unpaginated. Both statuses are returned.
The role is appropriate for this local learning setup, not a claim of completed deployment hardening.
This phase uses local PostgreSQL; no remote deployment, authentication, frontend, cache, queues, containers or later-phase technology was added.

## Primary references

- [node-postgres queries](https://node-postgres.com/features/queries)
- [node-postgres pooling](https://node-postgres.com/features/pooling)
- [node-postgres transactions](https://node-postgres.com/features/transactions)
- [PostgreSQL 16 constraints](https://www.postgresql.org/docs/16/ddl-constraints.html)
- [PostgreSQL numeric types](https://www.postgresql.org/docs/16/datatype-numeric.html)

Phase 3 is complete. Stop here for user review before Phase 4.

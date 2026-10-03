# Architecture

## Request flow

Client -> Express -> route -> runtime validation -> controller -> service
-> repository interface -> repository adapter -> PostgreSQL.

Zod protects external shapes/types; ProductService owns business rules;
database constraints protect persistent integrity. Errors reach the central handler.
Product HTTP listing returns { products, pagination }; products may be []. ID lookup retains single-resource semantics.
ProductService calculates page defaults/offset and metadata; repository.list returns a page plus matching total.
PostgreSQL uses separate parameterized count/page queries without a shared snapshot.
Existing findAll/findByStatus repository methods retain their array contracts.

## Composition / dependency injection

Outer wiring (src/server.ts) creates Product and Category PostgreSQL adapters with one Pool.
ProductService receives ProductRepository and CategoryRepository; CategoryService receives
CategoryRepository. Each controller receives its service.
src/app.ts accepts dependencies; product.module.ts connects repository, service,
controller and router. ProductService depends on repository contracts, not pg or SQL.
The interface defines WHAT; adapters define HOW; outer composition supplies WIRING.

## Runtime lifecycle

Central env validation -> one DB pool -> DB/table verification -> app -> listen.
Startup does not silently create tables; explicit migration commands own schema changes.

Shutdown: stop new HTTP -> drain active requests -> close DB pool -> exit.
A bounded shutdown deadline covers HTTP and resource cleanup.
/health checks liveness; /ready probes the required database/table.

## Test split

Fast HTTP/service tests -> InMemoryProductRepository where appropriate.
Shared lifecycle fixture -> same lifecycle code without a database.
Integration tests -> real PostgreSQL in ecommerce_test, including actual runtime checks.
Status collection assertions are shared between both adapters.
The explicit developer smoke script targets ecommerce_dev; it is not part of automated tests.

## Boundaries

One backend application with Product and Category modules: a modular monolith.
Many Products may reference one Category; nullable category_id preserves existing data.
The database FK uses ON DELETE RESTRICT; service lookup provides friendly input errors.
SQL and row mapping belong in the PostgreSQL adapter/database infrastructure.
Schema changes use versioned SQL migrations; no ORM or distributed services.
React uses API modules with native fetch; the Vite development proxy forwards /api to Express.
Current setup is in [README](../README.md); changing operational facts belong in
[current state](current-state.md), not this document.

Decisions: [raw SQL](decisions/001-postgresql-raw-sql.md) and
[module boundaries](decisions/002-modular-monolith.md).

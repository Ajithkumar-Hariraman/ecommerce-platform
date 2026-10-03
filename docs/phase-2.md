# Phase 2 — Product catalog

Phase 1 architecture is preserved. Only app.ts gains the product module import/mount. The existing health endpoint, JSON parsing, AppError, error middleware, configuration, server lifecycle, and tests remain intact.

## Module tree

```text
apps/api/src/modules/products/
├── product.ts
├── product.repository.ts
├── in-memory-product.repository.ts
├── product.service.ts
├── product.validation.ts
├── product.controller.ts
├── product.routes.ts
└── product.module.ts
```

Added: these eight files, apps/api/test/products.test.ts, docs/phase-2.md.
Modified: apps/api/src/app.ts, apps/api/package.json, apps/api/package-lock.json, README.md.
Generated dist output remains ignored.

## Run

From the repository root in WSL:

```sh
source ~/.nvm/nvm.sh
nvm use
cd apps/api
npm ci
npm run dev
```

Defaults: http://127.0.0.1:3000. Stop with Ctrl+C. The repository is empty at each app creation/restart, including watcher restarts.
Creation body:

```json
{
  "sku": "COFFEE-001",
  "name": "Coffee",
  "description": null,
  "priceInMinorUnits": 49999,
  "stock": 4
}
```

POST /api/v1/products returns the Product directly with 201 and a Location header.
GET collection returns a plain Product array with 200; empty storage returns [].
GET /:id returns a Product with 200 or 404.
PUT /:id returns the updated Product with 200. This phase explicitly requests partial PUT: omitted fields are preserved. Conventional full-resource PUT differs; a later contract revision could expose PATCH for partial changes.
DELETE /:id returns 204 with no body; a repeat delete returns 404.
A malformed UUID is 400; a valid but absent UUID is 404.

## Rules and boundaries

- SKU and name are required, trimmed by the service, and cannot be blank.
- SKU uniqueness is case-sensitive after trimming: abc and ABC are different.
- Description is optional on create (defaults null); supplied string is preserved, including whitespace. Explicit null clears it.
- Price is a safe integer greater than zero; stock is a safe integer at least zero. No numeric-string coercion.
- Number.isSafeInteger excludes fractions and numbers outside JavaScript's exact integer range. This module does no currency conversion or arithmetic; 49999 can represent INR 499.99. Future arithmetic must also guard overflow.
- Server generates random UUIDs and ISO UTC timestamps. Creation sets status ACTIVE.
- Strict boundary schemas reject unknown keys, including id, createdAt, updatedAt, and status during creation.
- Update allows sku, name, description, priceInMinorUnits, stock, status. Empty updates fail.
- Only supplied fields are validated/changed; id and createdAt survive unchanged.
- updatedAt is recomputed from the server clock. Same-millisecond writes can share a timestamp; it is not a version/concurrency token.
- Status permits ACTIVE or INACTIVE. Both are included in the collection; no status filter is implied.
- The service checks duplicate SKU and maps conflicts to AppError 409.
- The repository also enforces uniqueness during each write without await between checking and changing the Map. This closes the concurrent check-then-create/update race in one process.
- Copies cross the repository boundary so modifying returned objects cannot mutate storage.

The boundary validates unknown JSON shape/types with Zod. The service validates semantic rules even when called by another typed internal caller. TypeScript is erased at runtime: annotating input cannot stop a real client from sending a string as stock. Zod rejects that string; the service rejects a negative numeric stock.

Only one dependency was added: zod@4 (exact installed version is recorded in package-lock.json). Its strict objects and safeParse provide runtime validation without hand-writing JSON type checks. Validation failures become deliberate AppError 400 messages, not raw Zod diagnostics or request values. See [Zod basics](https://zod.dev/basics) and [schema API](https://zod.dev/api).

## CREATE PRODUCT flow

CLIENT

POST /api/v1/products
↓
Express
↓
Product route
↓
runtime validation
↓
ProductController
↓
ProductService
↓
ProductRepository interface
↓
InMemoryProductRepository
↓
Product returned
↓
Controller
↓
HTTP 201 JSON response

Express parses JSON before product routing. validateCreate validates unknown req.body and places a typed, allowlisted input in res.locals.productInput. The controller passes it to the service. The service trims/validates values, checks uniqueness, generates identity/timestamps, then writes through its injected repository.

The interface is a compile-time contract, not a runtime object or extra function call. At runtime the service calls the injected InMemoryProductRepository instance.

DUPLICATE SKU

POST request
↓
Service checks repository
↓
SKU already exists
↓
AppError 409
↓
central error handler
↓
HTTP 409 response

If two requests both pass the read check, the repository's atomic write check raises DuplicateSkuError. The service converts this to the same AppError 409. Unexpected errors are rethrown to the existing generic-500 path.

## File explanations

FILE: apps/api/src/modules/products/product.ts
WHY: Define stored Product separately from allowed client inputs without importing HTTP or storage libraries.
WHO CALLS IT: TypeScript compiler; service/repository/controller/validation use its types.
INPUT: Field/type declarations.
OUTPUT: Product, ProductStatus, CreateProductInput, UpdateProductInput compile-time contracts.
WHAT CAN FAIL: Type mistakes are caught at compilation, but these types cannot validate external JSON. Add fields here alongside schema/service/tests.

FILE: apps/api/src/modules/products/product.repository.ts
WHY: Abstract persistence with Promise-based operations and explicit uniqueness/copy semantics.
WHO CALLS IT: Service depends on the interface; adapter implements it.
INPUT: Product, ID, or SKU.
OUTPUT: Promise<Product>, nullable lookup/update, Product array, or deletion boolean; DuplicateSkuError on uniqueness conflict.
WHAT CAN FAIL: Adapter errors or conflicts. A future database adapter must preserve these semantics, including atomic unique writes.

FILE: apps/api/src/modules/products/in-memory-product.repository.ts
WHY: Implement the contract with a private Map keyed by ID.
WHO CALLS IT: ProductService through the injected interface.
INPUT: Products, IDs, SKUs.
OUTPUT: Copies of stored products, null, lists, or deletion boolean.
WHAT CAN FAIL: Duplicate SKU or unexpected ID collision. Storage disappears on restart. SKU lookup and uniqueness scan are O(n); ID lookup uses Map. No multi-process consistency or durable storage exists.

FILE: apps/api/src/modules/products/product.service.ts
WHY: Own business rules, normalization, duplicate prevention, IDs, timestamps, and not-found behavior.
WHO CALLS IT: ProductController and focused tests.
INPUT: Injected ProductRepository, typed create/update data, product ID.
OUTPUT: Product(s) or void for delete; AppError for expected failures.
WHAT CAN FAIL: Invalid business values (400), missing product (404), duplicate SKU (409), repository failures (propagate). Change/add business policy here.

FILE: apps/api/src/modules/products/product.validation.ts
WHY: Protect the HTTP boundary from unknown shapes, wrong types, extra fields, and malformed IDs.
WHO CALLS IT: Product routes before controllers.
INPUT: req.body or req.params.id.
OUTPUT: Parsed allowlisted data in res.locals.productInput/productId, then next().
WHAT CAN FAIL: Invalid input becomes AppError 400 with a safe message. Strict schemas must be updated when accepted fields change.
Optional properties are projected only when supplied, matching exactOptionalPropertyTypes rather than assigning explicit undefined.

FILE: apps/api/src/modules/products/product.controller.ts
WHY: Adapt validated HTTP requests to service calls and map success results to responses.
WHO CALLS IT: Express routes after validation middleware.
INPUT: Typed validated res.locals values.
OUTPUT: 201 + Location on create, 200 JSON on reads/update, 204 empty on delete.
WHAT CAN FAIL: Rejected service calls go to Express 5 error middleware. Arrow handlers retain this when registered as callbacks.
No catch-and-hide wrapper and no business rules are needed here.

FILE: apps/api/src/modules/products/product.routes.ts
WHY: Map HTTP verbs and paths to ordered validation/controller handlers.
WHO CALLS IT: Product module wiring; Express handles the returned router.
INPUT: Injected ProductController and incoming requests.
OUTPUT: Router dispatch to one controller operation.
WHAT CAN FAIL: Incorrect middleware order would omit validated locals; missing routes fall through to existing 404 handling.
Add endpoint mappings here and mount only once per application.

FILE: apps/api/src/modules/products/product.module.ts
WHY: Make construction and dependency injection easy to find.
WHO CALLS IT: createApp().
INPUT: No arguments.
OUTPUT: Router wired to controller → service → in-memory repository.
WHAT CAN FAIL: Incorrect dependency wiring or adapter initialization.
Each app has one repository reused across requests; ProductService never constructs storage. Replace the adapter here in a later phase.

FILE: apps/api/test/products.test.ts
WHY: Verify actual HTTP behavior and the important non-HTTP persistence invariants.
WHO CALLS IT: Existing npm test / Node test runner.
INPUT: Ephemeral HTTP app, valid/invalid JSON, concurrent service operations.
OUTPUT: Passing/failing assertions, without a new mocking/test framework.
WHAT CAN FAIL: Contract regressions, unsafe mutation, uniqueness races. Extend the cases when changing policy or endpoints.

FILE: docs/phase-2.md
WHY: Preserve this implementation's runtime and interview explanations.
WHO CALLS IT: Developers.
INPUT: Current code and observed verification.
OUTPUT: Learning guide.
WHAT CAN FAIL: Documentation drift; update with behavior changes.

## Interview concepts in the actual code

| Concept                    | Actual location and meaning                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| interface                  | ProductRepository declares six Promise-based persistence methods; ProductService accepts that contract.                                    |
| implements                 | InMemoryProductRepository implements ProductRepository; TypeScript checks method compatibility.                                            |
| dependency injection       | product.module.ts constructs the repository and passes it to new ProductService(repository), then passes service to controller.            |
| abstraction                | ProductService calls repository.findBySku without knowing Map or SQL.                                                                      |
| async/await                | Controller awaits service; service awaits repository. Express 5 forwards rejections to centralized error handling.                         |
| union/literal type         | ProductStatus is "ACTIVE" \| "INACTIVE"; description is string \| null.                                                                    |
| utility types              | UpdateProductInput uses Partial<CreateProductInput> and adds optional status. Controller uses Record for Express generic parameter shapes. |
| runtime validation         | product.validation.ts calls Zod safeParse on real unknown req.body/params and rejects failures with AppError.                              |
| centralized error handling | Service and validation throw AppError; unchanged middleware/error-handler.ts formats the safe JSON response.                               |
| HTTP status codes          | Controller chooses successful 201/200/204; AppError carries expected 400/404/409 to the existing handler.                                  |

## Exactly what to edit for an interviewer

1. **Add category:** product.ts (model and input contracts), product.validation.ts (create schema plus create/update projections), product.service.ts (normalization/validation, construction and permitted update fields), products.test.ts, this guide. Map copies automatically preserve a new scalar field; repository interface/controller/routes need no change for a simple field.
2. **Change SKU validation:** product.service.ts validateFields for normalization/business policy; product.validation.ts if accepted JSON shape/type changes; products.test.ts and this guide. For case-insensitive uniqueness, normalize all stored/comparison values consistently, and revisit existing stored values.
3. **Add business rule:** product.service.ts plus products.test.ts. Extend product.repository.ts and the adapter only if the rule requires a new storage operation.
4. **Change HTTP response status:** product.controller.ts for success codes; product.service.ts for expected business AppError codes; product.validation.ts for boundary error codes. Update tests. The centralized handler already honors AppError.statusCode.
5. **Replace memory with PostgreSQL:** add postgres-product.repository.ts implementing product.repository.ts, then switch construction in product.module.ts. Add connection configuration to config/env.ts and pool lifecycle to server.ts/composition wiring; add migrations and integration tests. Enforce a database UNIQUE constraint and map its conflict to DuplicateSkuError. The service contract can stay unchanged; do not implement this until Phase 3 approval.
6. **Add endpoint:** product.routes.ts, product.controller.ts, product.validation.ts when it accepts input, product.service.ts for behavior, products.test.ts. Extend repository interface/adapter only if existing operations cannot support it.

## Verification

Executed under Node v24.18.0:

```sh
npm install zod@4
npm run typecheck
npm run build
npm test
npm run dev
```

npm test rebuilds before running the existing Node test runner. All **57 tests passed**, zero failures/skips, including Phase 1 health/errors/lifecycle tests and product HTTP subtests.
Coverage includes all requested create/read/update/delete behaviors, forbidden identity/timestamp fields, default status, supplied-only updates, negative/fractional/unsafe numbers, duplicate SKU on create/update, malformed route IDs, empty updates, failed-write preservation, repository copies, and concurrent SKU conflicts.

Separate developer HTTP verification used Python urllib against an actual npm run dev process on an ephemeral loopback port:

- health 200; POST 201 with trimmed values and server-generated UUID/ISO timestamps.
- list 200; by-ID 200; PUT 200 with changed stock/status and preserved creation time.
- duplicate POST 409; invalid negative-stock update 400.
- DELETE empty 204; subsequent lookup 404; unknown route remains JSON 404.
- Stopped the development process group; server logged SIGTERM and HTTP server closed.

No application implementation/typecheck/build/test errors occurred.
The sandbox runner again failed to initialize; authorized WSL execution completed the work.
npm emitted the existing esbuild install-script advisory; tsx and all tests succeeded. No blanket script approval was added.
npm reported zero vulnerabilities at installation time.

## Deliberate Phase 2 limitations

In-memory data is process-local and lost on restart. Collection is unpaginated, includes both statuses, and SKU searches scan the Map.
Atomic uniqueness protects a single process only. General concurrent updates to the same product are last-write-wins and may overwrite another update's fields; this phase has no optimistic versioning or transactions. Do not treat stock updates as inventory reservations.
No authentication, durable storage, currencies/conversion, users, carts, orders, frontend, infrastructure, or Phase 3 changes were added.

STOP: Phase 3 requires approval.

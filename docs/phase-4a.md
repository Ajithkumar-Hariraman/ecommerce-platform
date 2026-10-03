# Phase 4A — Category relationship

Verified 2026-09-11. Phase 4A is complete; Phase 4B is not implemented.

## Scope and choices

- Category has UUID identity, slug, name, ACTIVE/INACTIVE status and ISO timestamps.
- Slug/name are trimmed and nonblank. Slug uniqueness is case-sensitive after trimming.
- Create accepts optional status (defaults ACTIVE), allowing an intentionally inactive
  category without introducing an update endpoint.
- POST /api/v1/categories returns 201; GET collection returns 200 array;
  GET /:id returns 200/404; invalid input is 400; duplicate slug is 409.
- Product has categoryId: string | null. Omitted creation value becomes null;
  supplied values must be UUIDs referencing an existing Category. Update can assign,
  change or clear the association; omission preserves it.
- Both ACTIVE and INACTIVE categories may be assigned; no eligibility rule was requested.
- Existing Product status filtering and partial PUT semantics remain intact.

## Schema evolution

[migration 002](../apps/api/migrations/002_create_categories.sql) creates categories
and adds nullable products.category_id. Applied migration 001 is unchanged.
No fabricated uncategorized category and no data backfill/deletion.
In both databases a sample inserted before migration retained every original field;
its new category_id was null after migration. Only those sample rows were removed.

Category constraints: UUID primary key, unique/non-null slug, non-null name/status/
timestamps, nonblank slug/name checks and ACTIVE/INACTIVE check.
Foreign key: products.category_id -> categories.id, ON DELETE RESTRICT.
A referenced Category cannot be deleted: products are never silently cascaded away,
and associations are not silently cleared. No Category delete endpoint is implemented.

The Category primary/unique constraints create their supporting indexes. No separate
category_id index is added yet: there is no Category deletion or category-filter query
endpoint in this small phase. Revisit it when actual referencing-side scans justify it.
A foreign key does not automatically index the referencing column.
[PostgreSQL constraint documentation](https://www.postgresql.org/docs/16/ddl-constraints.html)

## Architecture and failure handling

Category follows the existing types -> repository contract -> memory/PostgreSQL
adapter -> service -> validation -> controller -> routes/module structure.
The runtime uses one shared pg Pool for both adapters.
server.ts injects both repositories into app.ts. The same CategoryRepository reaches
the Category module and ProductService through product.module.ts.
ProductService depends on ProductRepository and CategoryRepository, not SQL or Pool.

Service lookup returns a friendly 400 for unknown Product category references.
PostgreSQL's FK is the final integrity guard if a Category disappears between lookup
and write. The Product adapter maps the named FK's SQLSTATE 23503 to the same safe 400.
Category slug pre-check is backed by UNIQUE; concurrent violations become safe 409.
Explicit row mappers translate category_id/categoryId and Category timestamps.
Readiness/startup verification now checks both tables and the category_id column.

## Verification evidence

- npm run db:migrate and db:migrate:test: migration 002 applied; reruns already-applied.
- npm run typecheck and npm run build: passed.
- npm test: 88 passed, 0 failed.
- npm run test:integration: 31 passed, 0 failed, ecommerce_test only.
- Counts include parent groups. Existing status certification remains green.
- New tests cover Category HTTP validation/duplicates/defaults, memory copies/concurrent
  slug writes, Product null/existing/unknown/change/clear behavior, PostgreSQL mapping,
  pool recreation, concurrent unique enforcement, direct constraints and delete restriction.
- Existing Product fixtures now explicitly include categoryId: null and Category dependencies.
- Manual dev HTTP: POST Category 201, GET Categories 200, POST Product 201,
  GET Product 200, both assigned and null category.
- Direct SQL confirmed the relationship and ON DELETE RESTRICT.
- [Learning SQL](../apps/api/sql/product-learning.sql) executed successfully:
  INNER JOIN returned one categorized sample; LEFT JOIN returned both samples.
- Development smoke records cleaned in Product-before-Category order; learning writes rolled back.
- .env was neither modified nor exposed. No new dependency was added.
- No production/test failures were encountered; existing intentional error logs remain expected.

## Learning checkpoint

1. One-to-many: one Category can be referenced by many Products; each Product has at
   most one Category in this model.
2. Foreign key: a non-null Product category_id must refer to an existing categories.id.
3. Nullable now: old Products have no Category information; null preserves that truth.
4. CategoryRepository: defines WHAT Category persistence supports, independently of
   PostgreSQL or Map.
5. Two injected repositories: ProductService saves Products through one dependency and
   validates the Category reference through the other.
6. INNER JOIN includes Products with matching Categories; LEFT JOIN keeps uncategorized
   Products too, with null Category columns.

No new filtering, pagination, sorting controls or Category deletion were implemented.
Phase 4B requires explicit authorization.

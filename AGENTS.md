# Project instructions

## Project

Production-learning ecommerce platform. Active backend: Node.js 24, Express 5,
strict TypeScript with ESM, PostgreSQL and raw parameterized SQL through pg.
No ORM currently.

## Read only the context needed

Start with git status/diff and docs/current-state.md. Consult docs/architecture.md
for boundaries and docs/decisions/ for durable choices. Phase reports are historical
deep-learning references; do not load or repeat them unless relevant.
Follow the user's task mode (coach, review, implement, certify) and authorization.

## Architecture

Route -> validation -> controller -> service -> repository contract
-> repository adapter -> database.

- Business rules belong in services; persistence stays behind repository interfaces.
- HTTP concerns stay in controllers, routes and validation.
- Preserve explicit constructor injection and application/server separation.
- Keep strict TypeScript, async/await, parameterized SQL and centralized errors.
- Use explicit migrations for schema changes. No destructive DB reset as normal workflow.
- Never put secrets in Git or output. Local apps/api/.env is ignored; do not print it.

## Database

ecommerce_dev is for local development; ecommerce_test is for integration tests.
Never point automated integration tests at ecommerce_dev. Clean only test-owned
records; do not delete unrelated data to satisfy fixture prerequisites.

## Verification

Run commands from apps/api with the Node version in .nvmrc:

- npm run typecheck
- npm run build
- npm test
- npm run test:integration when persistence is touched or explicitly requested.
  Report observed results; passing old tests alone does not certify a new feature.

## Working behavior

Inspect existing code before editing. Prefer repository evidence over stale prompt
restatements of implementation, while obeying current explicit user instructions.
Make minimal scoped changes; do not widen scope without justification.
Report evidence, changed files and material limitations concisely.
Stop at the requested boundary; do not begin the next phase implicitly.

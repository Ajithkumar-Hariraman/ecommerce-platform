# Ecommerce platform

Production-learning Node.js backend with a PostgreSQL Product/Category catalog.
Start with [current state](docs/current-state.md), then read
[architecture](docs/architecture.md) or [learning map](docs/learning-map.md) as needed.
Coding-agent rules live in [AGENTS.md](AGENTS.md).

## Local setup (Ubuntu WSL)

Prerequisites: Node 24 via nvm, PostgreSQL running, ecommerce_app role and
ecommerce_dev/ecommerce_test databases already provisioned.

```sh
cd /home/ak_soft_2017/projects/ecommerce-platform
source ~/.nvm/nvm.sh
nvm use
cd apps/api
npm ci
```

If apps/api/.env does not exist, create it using .env.example as a reference.
Set your development-only database password locally; never commit or print it.
Do not overwrite an existing private .env. The central config loads it automatically;
shell variables take precedence.

```sh
npm run db:migrate
npm run dev
```

Run API commands inside apps/api; the repository root has no package.json.
Default address: http://127.0.0.1:3000. Stop with Ctrl+C.
For compiled execution: npm run build, then npm start.

## Verify

```sh
npm run typecheck
npm run build
npm test
npm run test:integration
```

Integration runs apply test migrations and use ecommerce_test only. The status
fixture requires an empty test products table and never clears unrelated rows.
Expected diagnostic logs appear in intentional error/failure tests.
See [current state](docs/current-state.md) for the latest verified counts.

## API surface

- GET /health: liveness.
- GET /ready: required database readiness.
- POST/GET /api/v1/products.
- GET /api/v1/products?status=ACTIVE or INACTIVE: filtered collection, possibly [].
- GET/PUT/DELETE /api/v1/products/:id; PUT currently performs partial updates.
- POST/GET /api/v1/categories and GET /api/v1/categories/:id.
- Product categoryId is optional/nullable; assigned Categories must exist.

## Historical learning reports

[Phase 1 archive](docs/phase-1.md) · [Phase 2](docs/phase-2.md) · [Phase 3](docs/phase-3.md) · [Phase 4A](docs/phase-4a.md).
These explain earlier stages; current setup and state supersede historical commands.

Architecture decisions:
[PostgreSQL/raw SQL](docs/decisions/001-postgresql-raw-sql.md) ·
[Modular monolith](docs/decisions/002-modular-monolith.md).

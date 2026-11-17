# Local checkout correction — 2026-11-18

Result: PASS for local simulator checkout in both independent persistence modes.
PostgreSQL is restored as the active local API backend. Existing data, volumes,
Keycloak configuration and Razorpay configuration were preserved. Only API/web
application containers were rebuilt/recreated; web was restarted after backend
switches to refresh nginx's upstream connection. No real provider was charged and
no external email was sent.

## Root causes in plain language

1. The browser sent zero placeholder prices, expecting the server to replace them.
   `app.ts` supplied the product repository to OrderService **only when Razorpay
   was configured**. With the simulator, the server trusted those zeros and saved
   a zero-value order. Pricing now always comes from ACTIVE catalog products,
   independent of provider. The browser sends product IDs and quantities only;
   legacy supplied prices are accepted for compatibility but ignored. Duplicate
   product lines are combined before stock checks; unsafe quantities, totals,
   unavailable products and nonpositive catalog prices are rejected before saving.
2. The checkout page always tried the Razorpay-only POST `/:id/checkout` endpoint.
   Docker selects the local simulator, so that route was absent. The API now
   reports its configured provider. Local checkout shows explicit success/failure
   simulation buttons and calls the saved payment through the API; it never loads
   the Razorpay widget. Configured Razorpay keeps its existing checkout and
   verification implementation. Simulator controls require development + local
   mode and the normal authenticated owner/manager authorization.
3. On browser reload, session restoration constructed a redirect URL from the
   pathname alone. That discarded `?order=<id>` and could lose the saved checkout.
   The app now preserves application query parameters while excluding OAuth
   callback fields. JWT signature/issuer/audience/expiry and ownership checks are
   unchanged. No Keycloak settings or trusted origins were relaxed.

Order prices are stored snapshots; later catalog edits do not silently reprice a
valid saved order. Invalid saved pricing blocks payment, including signed webhook
transitions for zero-value orders. Stock is checked at creation; inventory
reservation/decrement was not added.

## Exact 404 diagnosis

The observed order is `d24b1395-3d1d-4e49-a170-1d327868269a`.
Initial running API: Node 24.22.3, `NODE_ENV=development`, `AUTH_ENABLED=true`,
PostgreSQL host `postgres`, database `ecommerce_dev`, storage `postgres`, provider
`local` (default), provider URL `http://payment-provider:4100`.

Running compiled routes contained GET `/:id` and POST `/:id/payment`. nginx used
`location /api/ { proxy_pass http://api:3000; }`, preserving the complete path.
The source's provider-conditional pricing wiring was also present in the running
application. nginx's original request log showed POST `/orders` 201, POST
`/orders/<id>/checkout` 404, then GET `/orders/<id>` 200. The missing route was the
Razorpay POST, not the GET in those logs.

Authenticated diagnostic requests before the fix, repeated against both
`http://127.0.0.1:3001` and `http://localhost:8088`:

| Request | Status | Body finding |
|---|---:|---|
| GET `/api/v1/orders/d24b1395-3d1d-4e49-a170-1d327868269a` | 200 | Existing order, total 0, PAYMENT_PENDING |
| GET `/api/v1/orders/00000000-0000-4000-8000-000000000001` | 404 | `Order not found` |
| POST `/api/v1/orders/d24b1395-3d1d-4e49-a170-1d327868269a/checkout` | 404 | `Route not found` |
| GET existing order without bearer token | 401 | `Authentication required` |

`Route not found` means no matching HTTP handler. `Order not found` means the
handler ran, but the selected store lacks that order or the caller cannot access
it. A wrong owner deliberately gets the same concealed 404. During the MongoDB
smoke, GET of this PostgreSQL-only order returned `404 Order not found`; after
restoring PostgreSQL it returned 200. The reported GET `Route not found` was **not
reproduced** in the inspected logs or direct requests; it is not presented as an
established separate missing-GET-route bug.

After rebuilding, running API module checksums matched locally compiled outputs.
The web bundle matched a fresh Docker build with the same build arguments:
SHA-256 `a2855c3707daec90ace500ee01bebd8a1ac9efce820cdca5cb60115d971b3df0`.
The host-native Vite bundle differs because its build environment includes local
Vite configuration; comparisons used matching Docker build settings.

## Existing order repaired without replacement

The guarded `scripts/local/repair-zero-price-order.mjs` dry run calculated
**94800 paise (₹948.00)** from the two current ACTIVE products. The explicit apply
corrected only that pending order's line prices, names, total, version/update time,
and the existing pending simulator payment's amount. No payment was completed.

Verified afterward:

- Same order UUID, payment UUID `7b6ef821-806b-42f5-888e-b5c021e74cbb`, line UUIDs,
  owner and original creation time.
- Total 94800; status PAYMENT_PENDING; version 3 (was 2).
- Exactly one simulator payment for the order; amount 94800; no event/final outcome.
- GET returns 200 through both direct API and nginx.

The repair requires the local development PostgreSQL runtime, fixed loopback
Compose database, zero-valued pending lines and a nonfinalized matching simulator
payment. It locks the order/products, validates combined stock and stores a
private recovery snapshot at `/tmp/ecommerce-zero-price-<id>.json` (0600). It is a
one-off correction, not a migration or automatic reprice. PostgreSQL and simulator
SQLite are not one distributed transaction: provider correction precedes the DB
commit; on failure, the saved snapshot and strict pending/payment-identity guards
must be checked before a retry. A finalized payment is never modified.

Executed from repository root:

```sh
source ~/.nvm/nvm.sh
nvm use 24
# Read-only calculation:
NODE_ENV=development node scripts/local/repair-zero-price-order.mjs d24b1395-3d1d-4e49-a170-1d327868269a
# Applied once; do not rerun against this already-corrected order:
NODE_ENV=development node scripts/local/repair-zero-price-order.mjs d24b1395-3d1d-4e49-a170-1d327868269a --apply
```

## Checkout requests and persistence evidence

The real-browser regression signs in using temporary Keycloak users and uses
actual nginx/API/database/provider services. It retains its new development
orders/payment rows for inspection and removes only its newly created Keycloak
users. An initial pre-fix reload attempt also retained pending smoke order
`9c849b2b-4484-4310-bfc5-0e30437cc238`; no existing user orders were removed.

For each backend the successful run observed:

| Request / action | Result |
|---|---|
| GET `/api/v1/orders/checkout-config` | 200; local, simulationEnabled=true |
| POST `/api/v1/orders` with product IDs/quantities | 201; catalog-priced nonzero total |
| Reload `/checkout?order=<id>`; GET `/api/v1/orders/<id>` | 200; saved order restored |
| POST `/api/v1/orders/<id>/payment`, repeated | 200; same payment UUID |
| POST `/api/v1/orders/<id>/simulator-payment`, `{ "outcome": "succeed" }` | 200; PAID |
| Repeat same successful outcome | 200; same payment/version |
| Opposite outcome after success | 409; no new payment |
| Separate order, outcome `fail`; repeat same failure | 200; PAYMENT_FAILED, same payment/version |
| Refresh status and My Orders | 200; persisted status; saved order visible |
| Foreign customer's GET, resume POST, simulation POST | 404; `Order not found` |
| Foreign customer's My Orders | 200; empty |
| GET without bearer token | 401 |
| POST duplicated product quantities exceeding stock | 409 |
| POST unknown product | 400 |
| Razorpay script/network requests | **0** in both simulator browser runs |

Database checks after the browser runs:

| Store | Order UUID | State | Paise | Version | Audit rows | Simulator payment rows |
|---|---|---|---:|---:|---:|---:|
| PostgreSQL | `73604069-7d9e-441f-a7da-6b54330570ce` | PAID | 94800 | 3 | 1 | 1 |
| PostgreSQL | `9176766d-974d-47f3-984f-c5e81492dcdc` | PAYMENT_FAILED | 44900 | 3 | 1 | 1 |
| MongoDB | `75992a39-5bcb-4173-b55e-efa5d43aba79` | PAID | 169800 | 3 | 1 | 1 |
| MongoDB | `ee8113bf-b646-4a29-8257-661bc7cc3c4f` | PAYMENT_FAILED | 79900 | 3 | 1 | 1 |

Each order was absent from the alternative store. Each simulator amount matched
its persisted order total. Totals differ between backend smoke runs because the
independently ordered catalogs supplied different first products; each run
compared its own actual catalog prices, not client placeholders. No dual writes
or data copying were introduced.

## Reproduce

From the repository root, with the existing local Compose infrastructure running:

```sh
source ~/.nvm/nvm.sh
nvm use 24
ORDER_STORAGE=postgres docker compose --env-file infra/.env -f infra/compose.yaml up -d --build --wait --no-deps api web
node scripts/local/checkout-diagnose.mjs
CHROMIUM_EXECUTABLE="$HOME/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome" \
  npm --prefix apps/web run test:e2e:checkout

# Independent MongoDB check; PostgreSQL records are intentionally not visible here:
ORDER_STORAGE=mongodb docker compose --env-file infra/.env -f infra/compose.yaml up -d --wait --no-deps api
docker compose --env-file infra/.env -f infra/compose.yaml restart web
CHECKOUT_SMOKE_STORAGE=mongodb \
  CHROMIUM_EXECUTABLE="$HOME/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome" \
  npm --prefix apps/web run test:e2e:checkout

# Restore the original local PostgreSQL runtime:
ORDER_STORAGE=postgres docker compose --env-file infra/.env -f infra/compose.yaml up -d --wait --no-deps api
docker compose --env-file infra/.env -f infra/compose.yaml restart web
```

Browser runs are explicit development smokes. Automated persistence regressions
use **ecommerce_test only**:

```sh
# From apps/api:
npm run typecheck
npm run build
npm test
# From apps/web:
npm run typecheck
npm run build
npm test
# From repository root:
node scripts/local/verify-integration.mjs
```

Final observed results: API typecheck/build and **223 tests passed**; web
typecheck/build and **16 tests passed**; integration **97 passed, zero failed,
seven cloud opt-in skips**; real browser checkout PASS separately in PostgreSQL
and MongoDB; `git diff --check` PASS. Provider failure/timeout, signed callback
redelivery, Razorpay mocked contracts and ownership are also covered by the
existing backend suite. The new regression checks provider selection, server
pricing even with legacy 0/1 client prices, duplicate lines/stock, unsafe totals,
invalid saved pricing, simulator authorization/terminal outcomes, production
capability denial and checkout query preservation.

Not tested: actual Razorpay browser capture/settlement, real charges, external
email delivery, or login as the original existing customer. Original-order reads
used the existing manager service account; real customer/foreign-customer checks
used newly created test accounts. The original order was intentionally left
pending for its owner. Inventory reservation and fulfillment remain outside this
fix.

Initial sandbox test/listener failures, browser setup failures and the discovered
query-loss failure were corrected/retested; they are not counted as passes.
Evidence: `/tmp/checkout-{api-final,web-verified,integration-final}.log`,
`/tmp/checkout-browser-{postgres,mongodb}.log`,
`/tmp/checkout-browser-{postgres,mongodb}-requests.json`,
`/tmp/checkout-{before,final-diagnose}.jsonl`, `/tmp/checkout-db-evidence.json` and
`/tmp/checkout-simulator.png`. No bearer tokens or credentials are written there.

## Files changed in this checkout fix

Pre-existing catalog/OIDC/audit edits were retained. This task changed:

- API wiring: `apps/api/src/app.ts`, `apps/api/src/server.ts`.
- Order pricing: `apps/api/src/modules/orders/order.module.ts`,
  `order.service.ts`, `order.validation.ts`.
- Payment behavior: `apps/api/src/modules/payments/simulator-checkout.ts`,
  `payment-workflow.ts`, `postgres-payment.repositories.ts`, `razorpay.routes.ts`.
- Web: `apps/web/src/api/orders.ts`, `apps/web/src/auth/access.ts`,
  `apps/web/src/auth/session.ts`,
  `apps/web/src/features/checkout/CheckoutSection.tsx`, `SimulatorActions.tsx`.
- Tests: `apps/api/test/simulator-checkout.test.ts`,
  `apps/api/test/integration/order-runtime.test.ts`, `apps/api/test/razorpay.test.ts`,
  `apps/web/test/checkout.test.tsx`, `apps/web/test/e2e/local-checkout.mjs`,
  `apps/web/package.json` (checkout smoke command).
- Local tools: `scripts/local/checkout-diagnose.mjs`,
  `scripts/local/repair-zero-price-order.mjs`.
- Documentation: this report, `docs/current-state.md`, `docs/local-ui-audit.md`.

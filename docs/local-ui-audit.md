# Local customer/admin audit — 2026-11-17

Scope: current local source, including the six pre-existing uncommitted OIDC/config/realm changes. No GitHub snapshot, cloud deployment, real payment, external email, database reset or volume deletion. PostgreSQL and MongoDB are independent alternatives, not synchronized replicas.

The original Home bug was an unconditional registration paragraph/link in `Storefront.tsx`. `App.tsx` already read the session for the navbar, so the two rendered conflicting information. Home now subscribes to the same external session store. `ready` is checked before guest/customer rendering; a stable initial server snapshot lets `useSyncExternalStore` render safely in SSR tests. The navbar and footer also wait for readiness. Signed-in `/login` and `/register` show continuation/account links. An unavailable provider gets a neutral Home message.

The order service also accepted quantities above product stock. It now rejects excessive combined quantities (including repeated product lines) with 409 before saving an order. This is an availability check, not a concurrent inventory reservation/decrement system.

| Feature | Issue / severity | Correction or finding | Evidence | Result |
|---|---|---|---|---|
| Home CTA | Medium: authenticated users prompted to register | Shared session, ready/customer/guest/unavailable branches | SSR CTA regressions; real customer/staff browser Home/reload | PASS |
| Header/footer | Medium: guest links during initialization; footer ignored auth | Wait for ready; consistent account links | Source review; browser navigation/logout | PASS |
| Login/register | Medium: registration copy shown to signed-in users | Signed-in continuation view; initialization status | Browser signed-in routes; native registration entry and failed login | PASS |
| Registration submission, password recovery, email verification | Email flows require live realm/SMTP setup | Native Keycloak actions preserved; no settings weakened | Form entry only; account claims reviewed | NOT TESTED end to end |
| OIDC trust / Docker transport | High if internal issuer is trusted as public identity | Retained existing local backchannel fix; strict public issuer/audience/signature/expiry/client-role validation | Fast JWT/discovery tests; real Keycloak/API suite | PASS |
| Session reload/navigation/logout | Previous hard-coded UI state | Session adapter retained; no persistent browser tokens added | Browser login/reload/routes/logout; refresh/revocation protocol checks | PASS |
| Frontend automatic refresh / elapsed expiry | Timer-driven browser-clock experiment did not establish a reliable result | No auth weakening or speculative adapter change | Protocol refresh tested separately; actual elapsed expiry remains manual | NOT TESTED |
| Backend authorization | Guards alone cannot protect data | Backend policy + owner checks retained; stale integration assertions corrected | Missing/invalid token 401, catalog role denial 403, foreign-order concealment 404, scope=all denial | PASS |
| Shop/detail/empty/loading/errors | Empty storefront | Live public API returned total=0; SQL confirmed no dev products; temporary browser fixture removed | Public ACTIVE-only tests, browser details, source review of loading/error states | PASS; visual error injection NOT TESTED |
| Cart | Persistence/quantity/removal need browser evidence | Existing cart behavior retained | Browser add/quantity/reload/remove, cart unit tests | PASS |
| Checkout stock | High: quantities could exceed stock | Service sums repeated product quantities and rejects excess before persistence | Both real database ownership suites | PASS |
| Browser payment completion | High workflow gap: UI requires Razorpay; Docker uses local simulator | No new payment UI feature added; removed unconditional unsupported “no live money” claim | Browser review stops before payment; simulator tested through API | FAIL for complete local browser payment |
| Orders/detail/status/ownership | Historical role-only test expectations stale | Update fixtures to valid catalog products/current owner policy | Both database suites; simulated signed callbacks/failure/retry; listing tests | PASS |
| Admin catalog/categories/orders | Role visibility and direct routes | Existing permission boundaries retained | Real staff browser routes, customer access restricted, backend catalog checks | PASS for read/navigation; browser CRUD NOT TESTED |
| Notifications/outbox/Kafka | Historical fixtures omitted real products and newer cleanup receipt | Test-owned product fixtures, explicit provider/storage, owned receipt cleanup | Real relay/consumer, duplicate, retry/DLQ and crash-recovery tests | PASS |
| Mailpit | Need observed local transport | One application SMTP adapter message to example.invalid, removed by exact message ID | Local Mailpit HTTP/SMTP smoke | PASS transport; payment email attachment flow NOT TESTED |
| PostgreSQL/MongoDB | Must remain intentional alternatives | No adapter removal or dual write | Separate real business/payment/ownership/parity tests in ecommerce_test | PASS |
| Mobile/accessibility | Need basic browser evidence | Existing layout retained | 375px Home overflow/menu check, semantic SSR/loading tests | PASS limited checks; exhaustive keyboard/focus NOT TESTED |

## Reproduce safely

Use Node from `.nvmrc` (`source ~/.nvm/nvm.sh && nvm use 24`). From each app directory:

- `npm run typecheck`
- `npm run build`
- `npm test`

From the repository root, `node scripts/local/verify-integration.mjs` privately reads `infra/.env`, selects Docker ports, passes a separate `ecommerce_test` configuration and disables cloud opt-ins/SMTP. The existing harness runs `npm run test:integration` (including test migrations), with Mongo tests explicitly selecting `ecommerce_test`. No secrets are printed or rewritten.

From `apps/web`, `npm run test:e2e` uses Playwright and the default installed Chromium. For this machine:

```sh
CHROMIUM_EXECUTABLE="$HOME/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome" npm run test:e2e
```

This local-only script reads private `infra/.env`, creates temporary customer/staff users and one catalog product, and deletes them in `finally`. It verifies real Keycloak/browser/API interactions; it does not submit payment or send mail. Run against the rebuilt local web/API containers. Browser hard reloads must finish session restoration before proceeding; use the app links for ordinary navigation.

The local Mailpit adapter smoke is reproducible after building the API with `node scripts/local/mailpit-smoke.mjs` from the repository root. It uses only hard-coded loopback SMTP/HTTP endpoints and deletes its exact message.

## Development catalog (updated 2026-11-18)

The explicit local seed supplies six categories and 30 ACTIVE products (five per
category), unique `LOCAL-CATALOG-*` SKUs, descriptions, INR prices stored in paise,
and positive stock. Categories: Bags & Travel, Stationery, Drinkware, Home Textiles,
Desk Accessories and Planters. Existing products, including edits to seeded
products, are never updated. SKU/ID conflicts are skipped; category identity
conflicts abort with an error. Conflicts may prevent a complete sample catalog;
the verifier reports mismatches rather than repairing user data. PostgreSQL is
transactional; MongoDB standalone can retain partial inserts after failure and is
safe to rerun. Neither seed deletes records or resets volumes.

Images were inspected end to end: PostgreSQL `image_asset` / MongoDB `image`
contains bucket, objectName, generation, contentType and size, rather than a URL.
React `ProductImage` requests the public image-url endpoint, renders its URL, and
hides failed images. The new `local-catalog` bucket is a **bundled, read-only local
asset namespace**, not a claim that an object was uploaded to S3/GCS. The API checks
PNG bytes against recorded size/SHA-256 generation before returning a same-origin
`/api/local-catalog/<uuid>.png` URL. Both this resolution and static serving require
`NODE_ENV=development`; existing cloud upload/read behavior is preserved.

The 30 original PNG illustrations, manifest and CC0 notice live in
`apps/api/assets/local-catalog/`. These are stylized sample illustrations, not
third-party product photographs. Regenerate reproducibly from the repository root
with `python3 scripts/local/generate-catalog-assets.py` (standard library only).
Docker copies these assets into the API image. No external image hosts are needed.

Run these commands from the repository root with local Compose services already
running, dependencies installed, and the existing private `infra/.env` present:

```sh
source ~/.nvm/nvm.sh
nvm use 24

# Independent PostgreSQL development seed; repeat the same command to rerun.
NODE_ENV=development node scripts/local/seed-catalog.mjs postgres

# Independent MongoDB development seed; does not write PostgreSQL.
NODE_ENV=development node scripts/local/seed-catalog.mjs mongodb
```

The runner uses fixed loopback Compose ports (PostgreSQL 5433, MongoDB 27018),
fixed `ecommerce_dev` names, and credentials privately loaded from `infra/.env`.
It refuses an explicitly non-development NODE_ENV and ignores arbitrary application
connection URLs. Never point these commands at production port forwards. Neither
command seeds `ecommerce_test`. The older SQL entrypoint remains insert-only and
`current_database()` guarded; prefer the Node commands above for explicit backend
selection. Seeding one backend does not populate or synchronize the other.

Select **one** local runtime backend and rebuild API/web without dependencies or
volume changes. `ORDER_STORAGE` is the existing Compose selector feeding the
business storage configuration; use the same selection for workers when running
order workflows. These catalog checks only change the API selection.

```sh
# PostgreSQL catalog runtime:
ORDER_STORAGE=postgres docker compose --env-file infra/.env -f infra/compose.yaml up -d --build --wait --no-deps api
# OR MongoDB catalog runtime:
ORDER_STORAGE=mongodb docker compose --env-file infra/.env -f infra/compose.yaml up -d --build --wait --no-deps api

# Run after either API selection; also refreshes nginx's upstream DNS.
docker compose --env-file infra/.env -f infra/compose.yaml up -d --build --force-recreate --wait --no-deps web
node scripts/local/verify-catalog.mjs
node scripts/local/verify-catalog-browser.mjs
```

If Chromium is not on Playwright's default path, prefix the browser command with
`CHROMIUM_EXECUTABLE="$HOME/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome"`.
The HTTP verifier compares all 30 sample fields and actual PNG response hashes;
the browser verifier visits shop pages and decodes each sample card's image.
Both are read-only checks of the deliberately seeded development catalog, separate
from automated integration tests. Open **http://localhost:8088/shop**: expect 12,
12 and six sample cards when there are no other products; use Next/Previous and
open a detail page to check description, rupee price, stock and image. Existing
`/products` remains available; `/shop` is an added route alias.

Verification tests: from `apps/api`, run `npm run typecheck`, `npm run build`,
`npm test` (including `test/local-catalog.test.ts`). The seed tests use fakes only:
no seed is run against any test database. From the repository root run
`node scripts/local/verify-integration.mjs` for existing real persistence
regressions in **ecommerce_test only**. From `apps/web` run `npm run typecheck`,
`npm run build`, `npm test`.

## Manual browser verification still required

At `http://localhost:8088`, check guest Home, sign-up/sign-in, empty catalog and footer. Optionally apply the explicit local seed above to browse samples. Sign in as a customer; Home must offer shopping/orders, including after reload, without a registration flash. Check account details/email verification, notifications, orders/detail ownership and logout. As staff, check direct admin URLs and actual catalog/category CRUD; a customer must see restricted access and receive API denial independently of the UI. Check keyboard focus, mobile navigation and product/error states. Leave a real session through expiry to verify automatic refresh and provider-unavailable recovery. Full browser payment requires an explicitly configured test Razorpay environment or a separately implemented local simulator UI; do not use live credentials. Shipping/fulfillment transitions and payment email/PDF delivery are not certified by this audit.

## Execution results

Observed final results (Node 24.18.0):

- API `npm run typecheck`, `npm run build`: PASS; `npm test`: 217 passed, 0 failed.
- Web `npm run typecheck`, `npm run build`: PASS; `npm test`: 13 passed, 0 failed.
- `node scripts/local/verify-integration.mjs`: 104 checks, 97 passed, 0 failed, 7 explicitly skipped (cloud/GCS opt-ins). Includes separate PostgreSQL/Mongo business, stock, ownership and persistence parity; simulator payment success/failure/retry; Kafka retries/DLQ, outbox failure/recovery and durable notifications; real Keycloak/Redis checks.
- `CHROMIUM_EXECUTABLE=... npm run test:e2e`: seven browser/protocol groups passed. Registration *entry* was checked; submission was not. Real refresh/revocation was checked directly with the token endpoint; browser automatic timer refresh was not certified. A simulated-browser-clock experiment timed out/lost its view and was replaced by direct protocol verification, not counted as an automatic-refresh pass.
- Docker web/API builds and no-dependency restarts: PASS; local `/ready`: 200; live public catalog: 200 with zero products before/after temporary fixtures.
- Application SMTP -> Mailpit smoke: PASS, owned message removed. Does not certify payment-originated PDF/email delivery.
- `git diff --check`: PASS.
- Historical two-product sample seed was not executed during the original audit. The expanded development catalog was explicitly applied during the 2026-11-18 follow-up below.

Execution logs are in `/tmp/ecommerce-audit-unit-final.log`, `/tmp/ecommerce-audit-web-final.log`, `/tmp/ecommerce-audit-integration-verified.log`, `/tmp/ecommerce-audit-browser-accepted.log`, and `/tmp/ecommerce-audit-{web,api}-docker.log`. Earlier attempts hit sandbox socket/network restrictions, a wrong local PostgreSQL port, mismatched app-vs-Compose credentials, stale fixtures and a test cleanup FK error. Those attempts are not reported as passes. Exact owned fixtures left by failed cleanup were removed; unrelated rows were not deleted. Local web and API containers were rebuilt without dependencies, volume changes or cloud configuration edits.


## Exact files changed

Changed in this audit:

- `apps/api/src/modules/orders/order.service.ts`
- `apps/api/test/integration/kafka.test.ts`
- `apps/api/test/integration/oidc.test.ts`
- `apps/api/test/integration/order-ownership.test.ts`
- `apps/api/test/integration/outbox-runtime.test.ts`
- `apps/web/package.json`
- `apps/web/package-lock.json`
- `apps/web/src/App.tsx`
- `apps/web/src/auth/session.ts`
- `apps/web/src/commerce/Account.tsx`
- `apps/web/src/commerce/Storefront.tsx`
- `apps/web/src/features/checkout/CheckoutSection.tsx`
- `apps/web/test/commerce.test.tsx`
- `apps/web/test/spa-config.test.tsx`
- `apps/web/test/e2e/local-shopping.mjs`
- `scripts/local/sample-catalog.sql`
- `scripts/local/verify-integration.mjs`
- `scripts/local/mailpit-smoke.mjs`
- `docs/local-ui-audit.md`
- `docs/current-state.md`

Pre-existing uncommitted changes retained and verified, not authored in this audit:
`apps/api/src/auth/oidc.ts`, `apps/api/src/config/env.ts`, `apps/api/test/oidc-discovery.test.ts`, `docs/authentication.md`, `infra/compose.yaml`, `infra/keycloak/ecommerce-realm.json`.

## Learning notes

React renders what each component asks for: a navbar reading authentication does not automatically make an unrelated Home paragraph conditional. Both must read the same session, and readiness is a separate state from signed out. `useSyncExternalStore` needs a stable server snapshot for SSR; returning a new object each call would also be incorrect.

Express validates request shapes before the order service checks product availability and computes authoritative prices. Summing stock quantities in the service covers both persistence adapters and prevents bypass through duplicated cart lines. It cannot prevent two concurrent buyers racing without an inventory transaction/reservation design.

Keycloak's public issuer identifies who signed a token. Docker's internal hostname only tells the API where to fetch discovery/keys; changing transport must never change the issuer trusted by JWT verification. Frontend role visibility improves navigation, while API JWT/role/ownership checks enforce security.

Docker images contain a built snapshot: editing local TSX does not update an already built nginx container. Only the local web/API services were rebuilt, preserving volumes. Realm import files also do not automatically reconcile an existing live realm; current live behavior was checked rather than inferred from JSON.

Tests must create real prerequisite products, select their own database explicitly and clean all records they own, including newer dependent receipts. Passing callback tests and browser checkout review are separate pieces of evidence; together they still do not prove a browser completed payment.

## Catalog follow-up execution evidence — 2026-11-18

- Both separate ecommerce_dev seeds executed twice successfully. All sample fields
  and PNG hashes verified through localhost:8088 with PostgreSQL and MongoDB selected
  independently. Browser decoded all 30 catalog images in each backend mode.
- PostgreSQL restored as the local API backend; web restarted after API selection
  to refresh nginx upstream DNS. No volumes removed; no authentication/payment
  configuration edited. Original audit changes retained.
- API typecheck/build passed; fast suite 222 passed, zero failed. Catalog tests
  cover completeness, image integrity, development guards, rollback before writes,
  insert-only PostgreSQL SQL and Mongo rerun/user-edit preservation with fakes.
- Existing integration harness: 104 checks, 97 passed, zero failed, seven opt-in
  skips, ecommerce_test only. Web typecheck/build and its three test files passed.
- Initial sandbox listener/database failures were rerun with local access. An
  initial browser check exposed the missing `/shop` route, fixed by an alias.
  An initial backend-switch check hit startup 502; readiness waits and a web
  restart resolved it. These attempts were not counted as passes.
- Logs: `/tmp/catalog-unit-final.log`, `/tmp/catalog-integration-final.log`,
  `/tmp/catalog-web-tests.log`; browser screenshot `/tmp/local-catalog-shop.png`.
- New/updated catalog files: `scripts/local/{seed-catalog.mjs,sample-catalog.sql,
  generate-catalog-assets.py,verify-catalog.mjs,verify-catalog-browser.mjs}`,
  `apps/api/assets/local-catalog/`, `apps/api/src/modules/products/local-catalog-image.ts`,
  `apps/api/src/modules/products/product-image.service.ts`, `apps/api/src/app.ts`,
  `apps/api/Dockerfile`, `apps/api/test/local-catalog.test.ts`,
  `apps/web/src/App.tsx`, this document and `docs/current-state.md`.

## Checkout follow-up — 2026-11-18

The historical browser-payment FAIL above is superseded **for local simulator
mode** by [the checkout correction report](local-checkout-fix.md). Both independent
backends passed actual Docker/browser create/retrieve/resume, successful/failed
simulation, idempotent retries, status refresh, My Orders and ownership checks.
The original zero-price order was repaired in place to INR 948 with all identities
retained and remains pending. The API now always uses catalog prices; provider
selection prevents Razorpay invocation in simulator mode. Session restoration
preserves the saved order query. API: 223 tests passed; web: 16 passed; existing
integration: 97 passed, seven opt-in skips. No real Razorpay capture, external
email or original-customer login is claimed. See the report for exact requests,
DB records, files, commands and the unreproduced reported GET-404 distinction.

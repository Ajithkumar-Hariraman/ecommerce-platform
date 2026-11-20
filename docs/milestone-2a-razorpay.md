# Milestone 2A — Razorpay Test Mode

## Findings and implementation

- Before this milestone, the API already had a Test Mode Orders adapter, durable provider-order mappings, signed browser confirmation, signed webhooks, and storage-specific payment workflows. The store already derived prices from active catalog products and checked combined quantities against stock. Order access used the verified Keycloak subject with the existing manager and admin permissions.
- Verified browser confirmations recorded the attempt but left even a captured payment pending until webhook delivery. This blocked local confirmation without a public webhook URL. The API now fetches the payment after verifying the checkout HMAC and checks the payment ID, stored provider order ID, amount, INR currency, and capture status. An authorization alone leaves the order awaiting capture.
- Reopening an order now checks the payment attempts directly with Razorpay. A confirmed capture settles the saved order, and an authorized or refunded attempt blocks reopening. Failed attempts can reuse the same provider order. The provider order is created with partial payments disabled. [Razorpay order-payment lookup](https://razorpay.com/docs/api/orders/fetch-payments/)
- Browser verification, reopening reconciliation, and signed captured webhooks use the same deterministic event ID for the same capture. PostgreSQL commits the status, audit, and outbox together. MongoDB uses its atomic embedded status, receipt, and outbox with idempotent projections. A late failure cannot reverse a captured payment or downgrade its attempt record.
- Dismissing the widget saves the order for later. An in-widget failure keeps the storefront button locked while the widget is open. The UI refreshes saved state after dismissal and verification, ignores stale order versions, and keeps polling a failed Razorpay order for a delayed capture. Storefront messaging is provider-neutral and checkout identifies either local simulation or Razorpay Test Mode.
- The opt-in Compose override sets Razorpay credentials on the API service. The base Compose stack defaults to the simulator. The selected provider controls which webhook route is enabled.

## Configuration

Use Node 24. Keep the existing Keycloak realm, local catalog, and database setup. Run Compose commands from the repository root. The schema already includes the Razorpay tables in migration 007, and the API ensures MongoDB indexes at startup. For a fresh local database, run the normal Compose migration service before starting the API. Use a new order after switching providers. A pending order retains the payment mapping from the provider that created it.

### Local simulator

Use the existing ignored `infra/.env` settings, including the simulator's shared `PAYMENT_WEBHOOK_SECRET`. The simulator requires no Razorpay keys.

```sh
docker compose --env-file infra/.env -f infra/compose.yaml up -d --build
```

Open `http://localhost:8088`, sign in through Keycloak, add an in-stock item, and choose **Place order & simulate payment**. Try success and failure on separate orders. An unsuccessful simulation is terminal for that simulator order.

### Razorpay Test Mode

1. Switch the Razorpay Dashboard to **Test Mode**. In **Account & Settings → API Keys**, generate the Test Mode key pair. Use the `rzp_test_` key ID and its matching key secret.
2. In ignored `infra/.env`, set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. Use a separate random webhook secret at least 32 characters long. Set the identical secret on the Dashboard webhook if testing delivery. The optional `RAZORPAY_TIMEOUT_MS` defaults to 8000 and accepts 1000–10000. Currency is INR. Keep the API and webhook secrets server-side. [Razorpay Standard Checkout setup](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
3. With the base services healthy, run:

   ```sh
   docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.razorpay.yaml \
     up -d --build --wait --no-deps api
   ```

   To run the API directly instead, put those variables and `PAYMENT_PROVIDER=razorpay` in ignored `apps/api/.env`, run `npm run db:migrate` from `apps/api`, and restart the local API. For Docker, `ORDER_STORAGE=postgres` or `ORDER_STORAGE=mongodb` selects the business adapter when `BUSINESS_STORAGE` is unset.
4. Use automatic payment capture in the Test Mode account. For actual webhook delivery, configure a reachable HTTPS URL ending in `/api/v1/webhooks/razorpay` and subscribe to `payment.captured` and `payment.failed`. Use an HTTPS tunnel or reverse proxy forwarding that path to the local Docker API at `127.0.0.1:3001` (or the direct API at port 3000). Razorpay cannot call loopback directly. Without a public endpoint, signed checkout verification can still confirm a captured payment, and continuing an order can recover a lost browser callback. A capture still pending at verification requires a later callback or reconciliation. [Razorpay webhook validation and testing](https://razorpay.com/docs/webhooks/validate-test/)
5. Restore the local simulator using the base Compose file alone:

   ```sh
   docker compose --env-file infra/.env -f infra/compose.yaml up -d --wait --no-deps api
   ```

### Browser verification

1. Sign in as a normal customer and add an in-stock item. Confirm the checkout says **Razorpay Test Mode**. Place the order and check that the hosted checkout amount matches the saved order total.
2. Close the widget and use **Continue payment**. Confirm the internal order ID and Razorpay order ID stay the same. Use a Dashboard-enabled test method to produce a failure, then retry the same order. Netbanking, when enabled, offers a mock bank page with success and failure actions. [Razorpay test payment methods](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
3. Complete a Test Mode payment. Check the payment is captured in the Dashboard and the order is **PAID** in My Orders after reload. In a second customer session, the original order URL should return HTTP 404.
4. With a configured public endpoint, redeliver the captured webhook. Check that the order keeps the same paid version and that one paid audit transition and one order-paid outbox event exist. A delayed failure must leave the order paid.

## Files changed

- API wiring and payment handling under `apps/api/src/app.ts` and `apps/api/src/modules/payments/`: `razorpay.api.ts`, `razorpay.gateway.ts`, `razorpay.routes.ts`, `postgres-checkout.repository.ts`, and `mongo-checkout.repository.ts`.
- Web: `apps/web/src/features/checkout/CheckoutSection.tsx`, `apps/web/src/api/orders.ts`, `apps/web/src/App.tsx`, and `apps/web/src/commerce/Storefront.tsx`.
- Regression tests: `apps/api/test/integration/razorpay.test.ts`, `apps/api/test/integration/order-ownership.test.ts`, and `apps/web/test/e2e/local-checkout.mjs`.
- Configuration and documentation: `infra/compose.razorpay.yaml`, `docs/razorpay.md`, and this report.

## Test results

Node 24.18.0. The integration suite ran against local `ecommerce_test` databases only. The browser smokes used the development catalog and retained their test orders. To repeat the simulator and widget-stub checks with the local stack running, run `npm --prefix apps/web run test:e2e:checkout` with Playwright Chromium available. They used disposable Keycloak accounts and did not reset databases or remove volumes.

| Check | Result | Evidence |
| --- | --- | --- |
| API typecheck and build | PASS | `npm run typecheck`, `npm run build` |
| API fast tests | PASS | `npm test`, 223 passed |
| Web typecheck, build, and tests | PASS | 16 tests passed |
| Full local integration suite | PASS | `node scripts/local/verify-integration.mjs`, 107 passed, 7 cloud opt-in skips |
| Original simulator with no Razorpay credentials | PASS | Docker Chromium and Keycloak in PostgreSQL and MongoDB. Created, resumed, succeeded, failed, refreshed, denied access by a foreign owner, and made zero Razorpay requests. |
| Razorpay security and settlement with provider boundary mocked | PASS | Both databases exercised signed capture verification and reopen reconciliation, authorized-only responses, amount and order mismatch, forged signatures and client-supplied status, delayed and duplicate webhooks, and stable audit/outbox effects. |
| Razorpay widget lifecycle with browser stub | PASS | Widget dismiss, failed attempt, same-order retry, duplicate browser callback, and status refresh. |
| Actual Razorpay Test Mode order creation and hosted checkout | PASS | Test key authentication, unpaid INR 1 Orders API probe, and authenticated PostgreSQL-backed storefront order with hosted Test Mode widget. |
| Hosted payment automation | FAIL | The hosted contact prompt remained open after submission. The run did not reach the mock bank. |
| Actual Razorpay Test Mode capture and storefront settlement | NOT TESTED | Verified with mocked provider responses in both storage modes. |
| Razorpay-delivered public HTTPS webhook | NOT TESTED | No test webhook tunnel was opened. Signed webhook delivery was covered locally. |
| Live-mode charges and cloud opt-ins | NOT TESTED | Outside Milestone 2A. |

Initial checks surfaced fixture issues when the mock did not implement the new lookup and when repository updates no longer matched the existing attempt contract. The final integration run includes both corrected paths. Verification logs are under `/tmp/milestone-2a-*.log`.

## Remaining blockers

An ambiguous Orders API POST can leave an intent with no mapped provider ID. Retry the saved order so the API can look up its exact receipt. The Test Mode receipt index showed a delay after creation. If the receipt stays absent or the match is ambiguous, inspect the Dashboard and reconcile the retained order before any further creation attempt. Complete one payment manually with a supported Test Mode contact and payment method to verify actual capture. The automated browser run reached the hosted contact prompt but could not advance to the mock bank. Public webhook delivery requires a reachable configured endpoint. Without the failure webhook, an unsuccessful widget attempt can leave the saved order waiting for payment and eligible for retry. Inventory validation checks availability at order creation. Reservation and inventory decrement are outside this milestone.

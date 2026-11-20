# Razorpay Test Mode checkout

> Historical implementation notes. For the current setup, storefront flow, and verification results, see [Milestone 2A](milestone-2a-razorpay.md).

## Runtime configuration

Set these only in the ignored `apps/api/.env` (or process environment):

- `PAYMENT_PROVIDER=razorpay`
- `RAZORPAY_KEY_ID`: Test Mode key ID (`rzp_test_...`).
- `RAZORPAY_KEY_SECRET`: API secret paired with that key ID.
- `RAZORPAY_WEBHOOK_SECRET`: a separate random secret, at least 32 characters under this application's policy; use the identical value in Dashboard.
- `RAZORPAY_CURRENCY=INR` (only supported currency).
- `RAZORPAY_TIMEOUT_MS=8000` (allowed 1000–10000).

Run `npm run db:migrate` from `apps/api` before restarting the API. Migration 007 adds provider mappings, attempts and webhook receipt IDs. PostgreSQL stores these mappings even when Orders use MongoDB; PostgreSQL is already required for Products. No existing migration is changed.

`PAYMENT_PROVIDER=local` preserves the existing simulator adapter and its separate `/api/v1/webhooks/payments` contract. Only the selected provider's webhook is registered at runtime.

## Dashboard and frontend

In Razorpay **Test Mode**, configure a webhook URL:

`https://<your-ngrok-host>/api/v1/webhooks/razorpay`

Select **payment.captured** and **payment.failed**. Configure automatic payment capture. The tunnel must forward to the API on `127.0.0.1:3000`, not to Vite. Authorised but uncaptured payments remain pending.

Run the existing frontend at `http://127.0.0.1:5173`; Vite already proxies `/api` to port 3000. No new frontend environment variable or secret is required. For a deployed frontend, preserve the same-origin `/api` reverse proxy. Only the public key ID is returned to the browser. The small checkout panel accepts an existing ACTIVE Product UUID and customer UUID. With authentication enabled, supply a valid `order_manager` or `admin` access token in the panel; it stays in React memory. Existing RBAC is retained; this is an administrative checkout flow, not a customer ownership/auth redesign.

The server loads the authoritative Product prices before creating an Order. Browser prices are ignored for Razorpay. Resume the same Order after an interruption. If initial creation returns a retained Order UUID in its safe error message, paste that UUID into Resume checkout rather than creating another Order.

## Payment boundaries

- OrderService -> unchanged PaymentClient contract -> RazorpayPaymentClient -> real HTTPS Orders API.
- Internal Order/payment UUIDs remain stable. The mapping separately preserves `order_...` and `pay_...` provider IDs.
- Durable creation intent and a PostgreSQL advisory lock serialize initiation. Reuse the provider Order for a repeated business key. Razorpay Orders has no assumed generic Idempotency-Key guarantee.
- After an ambiguous HTTPS result, reconcile by the internal Order UUID in `receipt`. Never blindly repeat POST. If no remote Order can be found, the checkout stays blocked for operator reconciliation; do not reset intent until provider non-creation is established.
- Verify Checkout's `stored_provider_order_id + "|" + payment_id` using HMAC-SHA256 and the API key secret. Fetch the payment to check amount/currency/association. This does **not** mark the Order PAID.
- Webhook verification uses exact raw request bytes, `X-Razorpay-Signature`, HMAC-SHA256 and the **webhook** secret. Normal JSON parsing and JWT requirements do not intercept this route.
- Preserve `x-razorpay-event-id` with a body hash. A deterministic internal event ID per provider payment/status also prevents duplicate effects across delivery IDs. Raw payloads and secrets are not persisted.
- `payment.failed` records a failed attempt. A later captured attempt can move PAYMENT_FAILED to PAID. Late failures cannot reverse PAID. The simulator retains its original stricter transition rules.
- Only captured settlement enters the existing durable paid workflow. PostgreSQL commits status/audit/event/outbox together. Mongo keeps the existing atomic embedded receipt/outbox with repairable projections. Kafka event format and relay are unchanged.
- Provider receipt acknowledgement can lag the durable workflow after a crash; redelivery repairs it without a second paid transition/outbox.

Database commits and provider HTTPS calls cannot form one ACID transaction. Durable intent, stable IDs, receipt reconciliation, retries and the existing outbox address separate failure boundaries. Automated tests replace only the external Razorpay boundary, use real `ecommerce_test` databases and clean test-owned records.

## Manual acceptance

After configuring the webhook secret and restarting the API, create/resume an Order in the frontend, complete Razorpay's hosted Test Mode checkout, and confirm server state progresses PAYMENT_PENDING -> PAID. Redeliver the captured event and confirm the Order version/audit/outbox do not duplicate. No real card details belong in this application or repository. Live settlement verification remains pending until this sequence succeeds.

References: [Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/), [webhook signatures](https://razorpay.com/docs/webhooks/validate-test/), [Orders API](https://razorpay.com/docs/api/orders/create/).

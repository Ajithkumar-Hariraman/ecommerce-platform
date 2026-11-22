# Milestone 3 — Reliability and security

## Changes and confirmed failures

Customers can mark individual notifications as read. New notifications and legacy records without a read timestamp are unread. The paginated list includes a total unread count for the signed-in subject. React refreshes the navigation count after a read or manual refresh and shows loading, empty, and out-of-range states. The owner-scoped PATCH returns 204 on repeat without changing the first read timestamp. A foreign or missing ID returns 404, including for a manager who does not own the order. Notification responses use private, no-store caching. PostgreSQL migration 014 adds a nullable timestamp. MongoDB uses the existing collection and treats absent timestamps as unread.

The original Compose build succeeded for both images. The API fast-test summary hid the assertion details. A diagnostic run exposed sandbox-denied loopback listeners (`listen EPERM`), and the affected files passed with loopback access. Both Python-wrapped notification checks delegated to a Node harness and redirected its output. The saved focused log shows both database cases failed with a temporal dead zone in the test fixture. The fixture now uses the original event ID and asserts that the response preserves it. The resumed harness skipped the already-applied test migration. The OpenAPI 3.1 schema now expresses the nullable timestamp as a union of string and null.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| API typecheck, build, OpenAPI | PASS | Node 24.18.0, typecheck and build succeeded, 2 OpenAPI tests passed after the schema correction. |
| API fast tests | PASS | Original run had 12 passing files. Only the 15 failed files were rerun, with 173 tests passing and zero failures. |
| Web typecheck, build, and tests | PASS | Original run passed, including all 4 test files. |
| Compose image build and notification migration | PASS | Both images built in the previous turn. Migration 014 applied in `ecommerce_test` and the local development stack. Existing images were reused to start the services. |
| Notification API, PostgreSQL and MongoDB | PASS | 2 focused real-service cases passed in `ecommerce_test`. Covered legacy unread state, global count off-page, authentication, ownership including manager denial, malformed and missing IDs, stable read timestamps under repeated calls, Kafka redelivery, and one Mailpit message per order. |
| Chromium, PostgreSQL and MongoDB | PASS | The two notification-only runs used real Keycloak and local simulator orders. Each observed loading, an empty inbox, receipt of a paid-order notification, badge update after marking as read, persistence on reload, and a separate customer's empty inbox. The local stack returned to PostgreSQL. |
| Complete local integration, initial run | FAIL | 105 passed, 2 failed, 7 skipped. The failures were Kafka DLQ exhaustion timeout and a Kafka CreateTopics request timeout. See focused rerun below. |
| Kafka integration, focused rerun | PASS | Both failed cases passed in isolation with zero failures. Verified partition ordering, durable deduplication, database lock recovery, committed offsets, DLQ routing, and real Keycloak payment through a separate worker. The initiating cause of the original timeouts remains unconfirmed. |
| Razorpay capture using Test Mode and Razorpay-delivered HTTPS webhook | NOT TESTED | Local regression exercised mocked Razorpay settlement and signed webhook handling. The browser runs used the simulator. |
| External SMTP acceptance reconciliation, production HTTPS and cloud opt-ins | NOT TESTED | Local mail verification used Mailpit. No external delivery or hosted environment was exercised. |

Evidence is under `/tmp/m3-*.log`. The Chromium runner used an existing cached browser binary after Playwright's default executable was absent. Browser smoke users were disposable and their development orders were retained. Automated persistence tests used the separate test databases. No database reset or volume removal was needed.

## JWT policy

The realm issues access tokens for 300 seconds. The API validates RS256 signatures against Keycloak JWKS and enforces issuer, audience, and token timing with five seconds of clock tolerance. Ending or revoking the Keycloak session prevents renewal. A previously issued bearer can still authorize requests until its expiry plus tolerance, or roughly 305 seconds in the worst case for a freshly issued token. Milestone 2F observed this behavior with real Keycloak.

Keep the five-minute lifetime and five-second tolerance for production if that exposure window meets the application's requirements. Use HTTPS, synchronized clocks, short-lived in-memory browser access tokens, and strict role and ownership checks. Define a narrower revocation target for privileged actions if the business requires one. Add a server-side revocation check only if measured requirements call for it. Token verification behavior remains as implemented before this milestone.

## Payment and delivery reliability

- Payment retries use stable identifiers. Razorpay capture reconciliation and signed captured callbacks converge on the same deterministic payment event. PostgreSQL commits the paid transition, audit and outbox together. MongoDB records the status, receipt and outbox atomically on the order and repairs projections on replay. For an ambiguous provider order creation, reconcile the saved order against the exact provider receipt before attempting another create.
- The relay uses bounded retries and leases. Publish followed by a lost acknowledgement can deliver an event twice. The worker deduplicates the notification and separately tracks email delivery. Investigate individual dead-letter events by ID before replaying them.
- Stock validation combines repeated product lines and checks the catalog's current quantity. There is no reservation or atomic decrement. Two orders can each pass against the same remaining stock. Treat this as a blocker for real sales until a reservation policy and a concurrent checkout test are in place.
- A definite pre-acceptance SMTP error allows retry from `PENDING`. An ambiguous outcome can leave `UNCERTAIN`, while an interrupted worker or a failed status write after SMTP acceptance can leave `SENDING`. For either state, record the order and stable Message-ID and check provider acceptance logs or the mail queue for that exact ID and recipient. Confirm the claim is inactive and record the evidence and operator. On confirmed acceptance, reconcile the stored state to `SENT` through an audited update conditional on the current state. On confirmed non-acceptance, authorize a single conditional transition to `PENDING` and replay only the affected event. If acceptance remains unknown, retain the state and escalate for manual review. A local Mailpit capture confirms local acceptance.

## Remaining external verification

1. Use the Razorpay Dashboard in **Test Mode**, with a matching `rzp_test_` key pair and a dedicated webhook secret in the ignored local configuration. Enable automatic capture and an available Test Mode payment method. Start the API with the existing `infra/compose.razorpay.yaml` override. Use a fresh order and confirm checkout identifies the provider as Razorpay Test Mode. Follow the repository's local setup instructions. [Milestone 2A setup](milestone-2a-razorpay.md) · [Razorpay Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
2. Register an approved public HTTPS staging endpoint or supported tunnel ending in `/api/v1/webhooks/razorpay`, with the same webhook secret and subscriptions for `payment.captured` and `payment.failed`. The route must receive the original body and signature. Use a supported test payment method to capture one payment and record the Dashboard payment status, webhook event ID and successful HTTP delivery. [Razorpay webhook testing](https://razorpay.com/docs/webhooks/validate-test/)
3. Verify the order reaches `PAID` after reload and that one paid audit transition, outbox event and customer notification exist. Redeliver the captured webhook and confirm the version and counts stay stable. Run a separate failed test attempt and verify a delayed failure does not reverse a capture. Restore the local simulator after the run.

Before presenting the project as production-ready, distinguish the independently verified local simulator and multi-store notification flows from hosted payment and production delivery. Capture and webhook evidence are needed for a hosted Razorpay demo. Atomic inventory reservations and an exercised external SMTP reconciliation procedure remain production readiness gaps.

## Milestone 3 files

- API data and readiness under `apps/api/migrations/014_add_notification_read_at.sql`, `apps/api/src/database/business.ts` and `apps/api/src/post-purchase/repository.ts`.
- Notification HTTP and contract under `apps/api/src/post-purchase/routes.ts` and `apps/api/src/openapi.ts`.
- Storefront under `apps/web/src/App.tsx`, `apps/web/src/auth/session.ts` (subject in the session snapshot) and `apps/web/src/commerce/Notifications.tsx`.
- Verification under `apps/api/test/integration/post-purchase.test.ts` and this report. The temporary Chromium harness is under `/tmp`. Existing Milestone 2 changes were preserved.

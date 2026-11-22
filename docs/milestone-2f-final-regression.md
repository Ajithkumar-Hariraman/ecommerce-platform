# Milestone 2F — Final end-to-end regression

**Result.** The local storefront, simulator checkout, post-purchase processing and administration passed on PostgreSQL and MongoDB. Notification read/unread is missing. The API still accepts a signed, unexpired JWT after Keycloak revokes its session. All executed automated cases passed. Actual Razorpay capture and webhook delivery, cloud adapters and the hosted CI run remain unverified.

Verification used Node.js 24.18.0, headless Chromium, and the running local Docker images. Source typechecks, builds and automated tests ran against the working tree, which already contained Milestones 2D and 2E edits. The browser runs reused the running images and did not establish byte-for-byte identity with the source builds. Browser runs used uniquely named fixtures in the development stores. Automated persistence tests used the two independent `ecommerce_test` databases.

## Feature matrix

| Feature | PostgreSQL | MongoDB | Evidence |
| --- | --- | --- | --- |
| Register, verify through Mailpit and sign in | PASS | PASS | Chromium received the local verification email. A separate browser completed verification and the signed-in account displayed **Verified**. Resend cooldown, tampered links and reuse were checked. |
| My Account, password reset and logout | PASS | PASS | Reset responses matched for known and unknown accounts. Tampered and reused reset links were rejected. The old password failed and the new one worked. Logout cleared protected views in both modes. MongoDB also exercised logout directly after the reset sign-in. |
| Natural expiry of verification and reset links | NOT TESTED | NOT TESTED | The PostgreSQL email harness was capped at 180 seconds after the core assertions. The live realm allows 300 seconds for user action codes. The MongoDB run used the core email checks. |
| Home, Shop, product details, cart and checkout review | PASS | PASS | Chromium covered guest and customer navigation, catalog selection, quantity changes, reload, removal and checkout review. |
| Login, navigation, reload and session refresh | PASS | PASS | Actual Keycloak renewal produced an access token accepted by the API. Advancing browser time exercised the refresh timer. An intercepted token endpoint failure recovered in the same browser session. |
| Session revocation blocks refresh | PASS | PASS | Real fixture-session revocation caused failed renewal and a sign-in gate. A separate controlled renewal rejection also forced sign-in. |
| Instant rejection of a revoked session's issued access JWT | FAIL | FAIL | The real protected Orders API responded HTTP 200 immediately after session revocation in both modes. |
| Checkout and simulator success | PASS | PASS | Order creation HTTP 201, checkout reload restored the pending order, simulator HTTP 200, thank-you UI and persisted `PAID` version 3. The server used catalog prices. |
| Simulator failure | PASS | PASS | Separate order creation HTTP 201 and failure callback HTTP 200. Browser showed the failure state. Storage confirmed `PAYMENT_FAILED` version 3. |
| Payment idempotency and conflict handling | PASS | PASS | Payment initialization retained its payment ID, a success replay kept version 3, and a conflicting failure returned HTTP 409. Each order had one terminal audit record. |
| My Orders, order details and ownership | PASS | PASS | Chromium listed the paid order, followed an order link and displayed details. A different customer received HTTP 404. The integration suite covered staff elevation and private document ownership. |
| Invoice and receipt | PASS | PASS | Each Chromium download returned HTTP 200 and started with `%PDF-`. Mailpit captured both PDF attachments. |
| Customer notifications | PASS | PASS | The authenticated Notifications API returned HTTP 200 and Chromium displayed the paid order notification. Integration verified owner scoping. |
| Notification read/unread | FAIL | FAIL | The UI has no read/unread action and the API exposes a GET list without a read-state field or mutation. |
| Keycloak administrator login and role-based navigation | PASS | PASS | Disposable staff reached the product, category and order administration views. Separate customer accounts were denied. |
| Unauthorized customer access to administrator APIs | PASS | PASS | Real management requests returned HTTP 401 without a token and HTTP 403 with a customer token. Tested catalog, import, image and staff order endpoints. |
| Category CRUD and integrity | PASS | PASS | Chromium created, edited and deleted a test category. Duplicate slug and deleting a category assigned to a product returned HTTP 409. |
| Product CRUD, pricing, stock and activation | PASS | PASS | Chromium created, edited, deactivated, reactivated and deleted a test product. The storefront reflected price, zero stock, activation and deletion. Invalid stock was rejected. |
| Product image upload and storefront display | PASS | PASS | Chromium displayed the decoded fixture image in the storefront. Invalid image content and a tampered upload link were rejected. |
| CSV import | PASS | PASS | Browser reported a mixed import with one successful and one rejected row. The imported product was verified and cleaned up. |
| PAID → outbox → Kafka → worker → notification → Mailpit and PDFs | PASS | PASS | Paid order and matching outbox/notification IDs were read directly from each store. Each outbox was `PUBLISHED` on attempt 1, each delivery was `SENT`, and Mailpit contained one message per paid fixture. |
| Broker failure, relay restart boundary and duplicate event handling | PASS | PASS | The real runtime tests used an unreachable broker endpoint and observed durable retry. After publish without acknowledgement, lease expiry allowed recovery and replay produced one notification. |
| Worker retry, dead-letter routing and SMTP retry | PASS | PASS | Local Kafka tests exercised bounded retry, database lock recovery and poison events. The two post-purchase integrations retried a controlled pre-acceptance SMTP error through Kafka and delivered once to real Mailpit. |
| Ambiguous SMTP outcome protection | PASS | PASS | Fast tests exercised uncertain SMTP acceptance and delivery-state write failure. The shared handler prevents automatic resend. Real external relay reconciliation remains untested. |
| Razorpay signed capture, webhook verification and checkout lifecycle with stubs | PASS | PASS | Browser widget stub and both database integration cases covered verified settlement, malformed signatures, mismatches, duplicates and late callbacks. |
| Actual Razorpay Test Mode capture or provider-delivered webhook | NOT TESTED | NOT TESTED | A test-shaped key set was present in ignored API configuration. Its validity, a working hosted test capture path and a public HTTPS webhook receiver were unverified. The running Compose app used the simulator. |
| Live cloud storage, brokers, production HTTPS and external SMTP | NOT TESTED | NOT TESTED | All mail went to Mailpit. Five cloud tests were skipped, and the two post-purchase tests used local PDF storage. |
| GitHub-hosted regression | NOT TESTED | NOT TESTED | All results in this milestone are local. |

## Browser, API and database evidence

| Store | Paid browser order | Published event | Mailpit message | Browser PDFs |
| --- | --- | --- | --- | --- |
| PostgreSQL | `9cabd5c5-37b9-4e72-8516-3dcca4e47855` | `cbfa5fdd-1b2f-44ee-ac8f-ae2e27875cc7` | `THqtL7fND72ExyKXf62Dhq` | Invoice 2,178 bytes, receipt 2,162 bytes |
| MongoDB | `56d9a46f-4887-4f72-b3e9-0d16353ff122` | `8f011fdd-dacc-47b8-b202-130ce4878aa6` | `AuJWAZaw3iseuRsRdH3fWX` | Invoice 2,167 bytes, receipt 2,152 bytes |

The PostgreSQL failed order was `fcb1662e-636e-4825-abc3-d4f36316b97c`. The MongoDB failed order was `1bdab6e1-03f7-4247-a686-b4e22b9ab7d0`. Neither order produced a paid outbox event, notification or email-delivery record. Read-only queries checked all four order IDs in both stores. Each existed only in the selected store, with the payment ID matching the browser API response. The MongoDB switch recreated the API, outbox relay and order worker from existing images and refreshed the web proxy. The same services were restored to PostgreSQL. Existing accounts, settings, records and volumes were preserved. Disposable catalog and staff fixtures were cleaned up by the existing harnesses. Test orders, registration fixtures and Mailpit captures remain as local evidence.

The existing Chromium scripts under `apps/web/test/e2e/` exercised account email, shopping and session lifecycle, checkout, and administration. A temporary checkout harness additionally waited for the order notification, followed its order link, checked both download responses and PDF bytes, and matched the captured email by its unique test recipient. The temporary harness remained outside the repository.

## Automated results

| Command | Result |
| --- | --- |
| API `npm run typecheck` and `npm run build` | PASS |
| API `npm test` | PASS, 224 passed, 0 failed |
| Web `npm run typecheck` and `npm run build` | PASS |
| Web `npm test` | PASS, 16 passed, 0 failed |
| `LOCAL_POST_PURCHASE_INTEGRATION=true node scripts/local/verify-integration.mjs` from repository root | PASS, 109 passed, 0 failed, 5 skipped. One full integration run with PostgreSQL, MongoDB, Keycloak, Redis, Kafka and Mailpit. Cloud skips were three AWS checks, one GCS product image check and one Pub/Sub check. |

## Investigations and changed files

**Intermittent PostgreSQL outbox test.** Milestone 2D observed attempt count 0 where the real-runtime test expected 1. This run passed that exact assertion and the PostgreSQL rollback, contention and expired-lease cases. The assertion follows one `runOnce()` call, which can return zero after an empty claim. The claim uses `FOR UPDATE SKIP LOCKED`. If it recurs, record the owned event ID, the relay's handled count, row status and eligibility timestamp, and identify any competing relay or transaction before choosing a fix. Lock contention is a possible cause, and the historical failure remains unexplained. Runtime retries and duplicate handling passed in both adapters.

**JWT revocation.** Live Keycloak configuration showed a 300-second access token lifetime. The API checks signature, issuer, audience and expiry locally with five seconds of clock tolerance. Keycloak ended the fixture session and rejected further renewal. During the remaining token lifetime, an already-issued bearer could still reach an authorized resource. Immediate server-side revocation would require a revocation check. Record this behavior in any public demo and retain the tested ownership and role checks.

**SMTP ambiguity.** A connection or pre-acceptance failure can return the delivery to `PENDING`. Missing acknowledgement during DATA can leave it `UNCERTAIN`. A worker interruption or a database write failure after SMTP acceptance can leave it `SENDING`. For reconciliation, correlate the order and stable Message-ID with Mailpit or provider acceptance logs. With positive acceptance evidence, reconcile the stored delivery to `SENT` through a controlled, auditable operation. Permit retry only after establishing non-acceptance and that no worker owns the claim. If the outcome is still unknown, retain the uncertain state and avoid replaying the message. A Mailpit capture confirms local acceptance. External delivery and reconciliation were unverified.

**Defects fixed and files changed.** No production or test code changed in Milestone 2F. The outbox failure did not reproduce, and implementing read/unread or changing token revocation would extend the existing feature scope. The sole deliverable is `docs/milestone-2f-final-regression.md`. Earlier worktree changes were preserved.

## Recruiter showcase readiness

- The local demo can show registration, catalog, cart, simulator checkout, order PDFs and administration on either store. Describe Notifications as a list of payment confirmations while read/unread remains absent.
- Keep the hosted gateway and cloud claims limited to their verified scope. A separate Test Mode run needs a supported hosted payment path and a configured reachable HTTPS webhook. Current results cover signed verification with local test doubles.
- Confirm a hosted CI run on the intended publication commit. Review the final tracked tree and Git history for credentials and customer data before making it public. The two local environment files were confirmed ignored. A fresh clone and full Git-history credential audit were outside this run.
- The Compose environment uses loopback services, development identity settings and one Kafka broker. Immediate JWT revocation, multi-instance MongoDB catalog write coordination, and operations for terminal outbox or uncertain email deliveries remain limitations for a public deployment.

## How the application fits together

React renders the storefront and administration pages. Nginx serves the web app and proxies API requests to Express. Keycloak handles sign-in and issues access tokens. The browser includes the token with protected requests. Express verifies the token, checks roles and order ownership, and validates input before a controller calls the service that applies the business rules. Services use repository interfaces so the same business rules can work with PostgreSQL or MongoDB. Redis helps with catalog caching and rate limiting.

Checkout saves the order using the server's catalog prices and creates a payment with the configured provider. The local simulator exercises success and failure. Signed payment callbacks update order state. PostgreSQL writes the paid status and its outbox event in one transaction. MongoDB stores the status, receipt and outbox together in one order document, then repairs separate projections idempotently on redelivery.

The outbox is a durable list of events waiting to be sent. A relay publishes those events to Kafka. A separate worker consumes them, creates one notification per event, generates the invoice and receipt, and claims the email delivery before sending it. The storefront lets the owner download the documents and see the notification. A broker outage can delay the notification while the paid order remains saved. An event can arrive more than once, so the notification ID and email delivery claim protect against duplicate effects.

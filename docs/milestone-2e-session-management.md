# Milestone 2E — Authentication, sessions and token lifecycle

## Existing functionality inspected

The React application uses Keycloak Authorization Code with PKCE and keeps tokens
in adapter memory. On reload, Keycloak's `check-sso` restores eligible sessions.
React's route gates wait for initialization and check authentication and staff
roles before mounting protected pages. Home, Shop and Cart are public. Checkout,
My Account, My Orders, Notifications and Operations use protected routes.

The Express API verifies RS256 signatures against Keycloak's JWKS and checks
issuer, API audience, expiry, issued-at time, token type and subject. Staff roles
come from the API client's role claim. Orders, documents and notifications use
the verified subject for ownership. The API returns 401 for invalid/missing
credentials, 403 for insufficient role and 404 for cross-account object reads
where exposing the record's existence would disclose information.

## Confirmed issues and fixes

- Every refresh error ended the session. Transient provider errors now leave
  renewable sessions intact, report the outage and retry after five seconds.
  Requests use only a current access token. When renewal is rejected, the app
  clears the session and requires explicit sign-in, including after reload.
- The request helper presented session errors as API connectivity errors.
  Connectivity handling now applies to the HTTP request itself, and the helper
  retains its single refresh-and-retry on 401.
- Logout depended on the provider navigation to complete before other tabs
  consistently reflected the sign-out. The initiating tab now gates protected
  content immediately and signals other same-origin tabs. A successful explicit
  sign-in prompts guest tabs to restore their session. Browser storage carries
  event identifiers only.
- A back/forward cache can restore rendered private content. The app hides a
  cached document on departure and reloads it on restore, applying the current
  gate. Authenticated API routes also send `Cache-Control: private, no-store`.

## Files changed

| File | Change |
| --- | --- |
| `apps/web/src/auth/session.ts` | Renewal recovery, explicit reauthentication, tab events and history handling |
| `apps/web/src/api/http.ts` | Preserve actionable authentication errors from token acquisition |
| `apps/api/src/auth/middleware.ts` | Prevent caching of protected responses |
| `apps/web/test/e2e/local-shopping.mjs` | Extend the existing Chromium/Keycloak fixture with lifecycle and access checks |
| `docs/milestone-2e-session-management.md` | Record checks, limitations and token concepts |

## Verification

- Node 24.18.0. API typecheck and build passed. The focused JWT/authorization
  command passed 14 tests with loopback listener access. Web typecheck,
  production build and test command passed.
- One full API regression passed 224 fast tests. The final local integration run
  passed 107, failed 0 and skipped 7 opt-in cloud scenarios. The skipped
  scenarios were three AWS checks, two GCS PDF/notification checks, one GCS
  product-image check and one Pub/Sub check. The integration runner used
  `ecommerce_test`. PostgreSQL and MongoDB each passed verified JWT order
  ownership, business persistence and separate outbox/worker checks. The local
  opt-in PDF/notification suite then passed independently on both test stores,
  using Kafka and Mailpit. Its owner and foreign-subject HTTP checks exercised
  the application authorization policy with controlled test identities.
- The intermittent PostgreSQL outbox failure from Milestone 2D did not recur.
  PostgreSQL outbox rollback, contention and lease cases passed. It remains a
  historical intermittent issue.
- Chromium passed all 12 lifecycle and navigation groups against the Docker
  web/API services and local Keycloak. No
  realm-wide expiry setting was changed. The expiry test advances Chromium's
  clock, then restores wall time before delivering Keycloak's signed refresh
  response. Signed expired-token rejection on the server was independently
  exercised by the JWT tests. Browser runs reused the running infrastructure
  and cleaned up only their disposable fixtures. Earlier Chromium attempts
  exposed test setup issues with the bundled executable path, shared context,
  navigation timing and ambiguous button selectors. The final run used the
  installed Chromium executable and the corrected harness, with a fresh
  browser context for the administrator. The interrupted attempt left two
  disposable identities, which were verified and cleaned up separately.

## PASS / FAIL / NOT TESTED matrix

| Check | Status | Evidence |
| --- | --- | --- |
| Login, navigation and browser reload | PASS | Keycloak restored the customer session. Account, Orders and Notifications mounted after initialization. The protected Orders route stayed hidden during the intercepted code exchange. |
| Guest Home, Shop and Cart; protected checkout/account/orders/notifications/admin | PASS | Chromium verified public access and sign-in gates. A signed-in customer could review Checkout and saw Access restricted for Admin. |
| Access-token expiry and renewal | PASS | Browser clock triggered renewal, Keycloak issued a fresh token and the session stayed authenticated. A separate refresh response was accepted by the API. |
| Provider refresh outage and recovery | PASS | Intercepted token endpoint HTTP 503, observed the recovery message, restored the endpoint and retried Orders successfully. |
| Sign-out, multiple tabs and browser Back | PASS | Guest tab saw login, active second tab cleared on sign-out, history navigation showed the sign-in gate, and Keycloak rejected the old refresh grant. |
| Revoked refresh or rejected renewal | PASS | Keycloak rejected renewal after a real test-user session revocation. A separate controlled `invalid_grant` forced explicit sign-in even with the provider cookie still present. |
| Immediate rejection of an issued access JWT after Keycloak session revocation | FAIL | The real protected Orders endpoint returned HTTP 200 for the still-unexpired JWT after the provider revoked the session. |
| JWT signature, expiry, issuer, audience, token type and role checks | PASS | Focused JWT tests covered malformed, expired, wrong-issuer, wrong-audience and invalid-signature tokens and 401/403. |
| Customer blocked from staff operations; admin controls available | PASS | Customer saw Access restricted and received HTTP 403 from catalog management. Staff reached catalog, category and order management. |
| Customer order ownership and admin elevation | PASS | Real PostgreSQL and MongoDB suites independently verified owner access, cross-account denial, and elevated order access. |
| Customer notifications and documents | PASS | Local post-purchase tests on each test store verified owner-scoped lists, foreign PDF denial, and permitted manager PDF access. |
| Local PostgreSQL outbox regression | PASS | Previously reported intermittent failure did not recur. |
| Elapsed Keycloak refresh-session expiry | NOT TESTED | No wall-clock Keycloak session TTL was changed or awaited. |
| Full Keycloak process outage at browser startup | NOT TESTED | The active-session token endpoint outage and startup error rendering were tested separately. |
| Provider deployment and cloud integrations | NOT TESTED | Verification used Docker-local services. |

## Remaining limitations

The API uses offline JWT verification. A previously issued access token can
remain valid through its signed expiry after Keycloak revokes the session. The
development access-token lifespan is five minutes, and the API allows five
seconds of clock tolerance. Revocation blocks future renewal. An idle browser did not discover administrative
revocation within an earlier 30-second check. The verified transition happened
when the app next tried to renew. Immediate rejection
of an already-issued, unexpired JWT would require a server-side revocation
mechanism or an online session check.

Tabs share sign-in and sign-out events within one browser origin. Other origins,
independent browser profiles and deployments were outside this Chromium run.
A request that failed during an outage may need a user retry even after the
session recovers. The browser test covered a token endpoint outage in an active
session. A full Keycloak process outage during cold startup was not induced.

## Access tokens, refresh tokens and session expiry

An **access token** is a short-lived credential the browser attaches to a protected
API request. Its signature lets the API verify who issued it and whether it still
applies. The API checks roles for staff operations and ownership for individual
customer records.

A **refresh token** goes to Keycloak to request a new access token. Keycloak can
reject it when the underlying session expires or is revoked. The app then
requires sign-in. A temporary connectivity failure can recover while the
refresh grant remains valid.

On reload, the app starts with empty token memory. Keycloak can issue new tokens
using its own session cookie. On sign-out, the app clears its view of the session
and asks Keycloak to end the provider session as well.

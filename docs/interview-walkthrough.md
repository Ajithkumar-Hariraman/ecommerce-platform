# Interview walkthrough

## Business problem

A shopper needs to see available products, pay the catalog price, and get a
durable confirmation. Staff need role-gated catalog tools and order visibility.
Payment callbacks can arrive late or twice, and an email outage should leave the
paid order available. This project demonstrates those boundaries on a
reproducible local stack.

## Explain the architecture in one minute

React and TypeScript manage storefront state and admin screens. Vite builds the
SPA, and Nginx serves it and proxies API requests. Express 5 and Zod handle the
HTTP boundary. The application groups catalog, orders and payments in one
backend so business rules stay together. Background publishing and delivery
run as separate processes so they can retry independently of HTTP requests.
Keycloak handles identity, Redis caches product reads and backs principal-level
rate limits, Kafka carries paid-order events, and Mailpit captures local SMTP.
[Architecture diagram](architecture.md)

## Follow one request in the code

Trace checkout from the web commerce screens into the order router and service
under [`apps/api/src/modules/orders`](../apps/api/src/modules/orders). Explain
how the authenticated subject scopes customer access and how the service
rebuilds the total from the active catalog instead of trusting a client total.
It saves snapshots in integer minor units so subsequent product changes do
not rewrite purchase history. The repository interface keeps the service
independent of the SQL or MongoDB driver. The application composition root
wires the selected implementation.

## Compare the databases

PostgreSQL uses explicit constraints and migrations with parameterized SQL.
Order lines and transitions can share a transaction with the outbox row.
MongoDB embeds lines, the canonical payment receipt and the outbox intent in
the order, so one document update is atomic even on the local standalone
server. Separate projections can be repaired on replay. Keeping a comparable
contract costs two adapter implementations and two real-database test paths.
Backend selection is deployment configuration, with separate datasets.

## Explain verification and idempotency

The simulator signs callbacks. Razorpay checks the checkout signature and
provider facts before settling via reconciliation, and the webhook path verifies
the signature over the original body. The stored order, provider payment,
amount and currency constrain settlement. Stable provider keys and deterministic
payment events let retries converge. The outbox closes the gap between committing
`PAID` and recording publication intent. A relay crash after send can still
redeliver, so the consumer deduplicates its durable side effect before advancing
the offset. Kafka keys by order ID, with ordering scoped to a partition.
[Payments](payment-integration.md) · [Outbox](transactional-outbox.md)

## Discuss identity and operating trade-offs

The SPA signs in with Authorization Code and PKCE. The API verifies RS256
signatures, issuer, audience and token timing. Client roles guard management
routes, and the token subject guards customer records. Keycloak revocation
blocks renewal, while an already issued bearer can remain valid for a five-minute
lifetime plus five seconds of clock tolerance.

Compose starts dependencies with health checks and explicit migration and topic
jobs. GitHub Actions installs locked dependencies and exercises the fast
suites, real services and both Compose storage paths. Deployment workflows are
separate from validation. The local baseline uses one Kafka broker and HTTP.
Redis cache and rate-limiter failures can fail open while authorization remains
enforced. Stock checks neither reserve nor decrement stock. Ambiguous SMTP
delivery can leave `UNCERTAIN` or interrupted `SENDING` state, which requires
checking provider evidence before replay. Real Razorpay Test Mode capture and
public HTTPS webhook delivery remain pending. [Verification record](recruiter-showcase.md)

## Four-minute demo script

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:35 | Storefront and product detail | “This is the bundled sample catalog. Shoppers can browse active products without signing in.” |
| 0:35–1:35 | Cart, customer login and checkout | “The cart shows an estimate. The API verifies products, quantities and price when I submit. This checkout uses the local simulator.” |
| 1:35–2:40 | Simulate success, open My Orders, download invoice and receipt, open Notifications | “Payment changes the order to paid and records an outbox event. The worker writes this notification and sends the confirmation to Mailpit. I can mark it as read and refresh to show that the state persists.” |
| 2:40–3:20 | Admin dashboard in a separate signed-in session | “Keycloak grants the staff role. The dashboard manages catalog data and exposes operational order views.” |
| 3:20–4:00 | Architecture and verification report | “PostgreSQL and MongoDB use different atomic write boundaries. Both feed the same Kafka flow, and redelivery is expected. The report shows what was exercised locally and which external checks remain.” |

Use synthetic users and a seeded Compose stack. Open the Mailpit inbox only for
the demo order. This is a walkthrough script for a live demo.

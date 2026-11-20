# Milestone 2C — Kafka, transactional outbox and order notifications

Verified locally on 2026-11-20 with Node.js 24.18.0, PostgreSQL, MongoDB, Kafka, the
payment simulator, Keycloak and Mailpit. Automated persistence tests used
`ecommerce_test`. The browser smoke used local development checkout and retained
its order and captured message as evidence.

## What already worked

- The signed payment callback persisted the PAID transition and a stable
  `OrderPaid` event together. PostgreSQL uses a transaction. MongoDB embeds the
  outbox entry and payment receipt in the same atomic order update.
- The relay claimed due entries with leases, retried broker failures with backoff,
  and reclaimed expired leases. Kafka can deliver an event again after publication
  or consumption succeeds but its acknowledgement is lost.
- The notification repositories deduplicated by event ID. Customer notification
  queries filtered by the authenticated subject on the associated order. Email
  used a separate per-order claim and a stable Message-ID.
- The worker generated invoice and receipt PDFs, kept document downloads private,
  and sent email after payment. SMTP acceptance uncertainty was already guarded
  against automatic resends.

## Confirmed defects and changes

| Defect | Change |
| --- | --- |
| The Compose worker inherited an SMTP default of `127.0.0.1`, which points to the worker container. | Configured the worker to use the existing `mailpit:1025` service. |
| Local invoice and receipt generation returned 503 without a document bucket. | Development can render PDFs directly. Configured cloud storage still uses the existing adapters. |
| An order or email state lookup and some delivery-state writes could fail with a raw database error, sending the event straight to the DLQ. | Route those failures through the bounded transient retry path. Preserve the send claim when SMTP acceptance or a post-send write is uncertain. |
| Kafka retries could spend their entire budget immediately during the same brief outage. | Wait two seconds before processing each retry-topic message. |
| MongoDB can publish PAID before its separate audit projection exists. A receipt PDF depended on that projection. | Read the atomic embedded PAID receipt when history is missing. The MongoDB integration test exercises this by removing only its own test projection. |

The tests also exercise the existing idempotency and ownership checks. No schema
migration, Keycloak configuration change, volume reset or external email was
required.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| API typecheck and build | PASS | Node.js 24.18.0. |
| Focused API tests | PASS | Kafka handler, outbox and post-purchase tests. Covered concurrent send claims, pre-acceptance retry, delivery-state failure and uncertain acceptance. |
| PostgreSQL payment callback and relay recovery | PASS | A signed callback made the order PAID while Kafka was unreachable. The event remained PENDING, was published before acknowledgement, then recovered after lease expiry. Replay resulted in one notification. |
| MongoDB payment callback and relay recovery | PASS | The same failure and recovery sequence verified the embedded outbox. The existing runtime test uses a PostgreSQL notification sink. The separate MongoDB post-purchase check below uses the actual MongoDB notification repository. |
| PostgreSQL post-purchase integration | PASS | Kafka worker, PostgreSQL notification and email delivery state, real Mailpit, owner filtering and two private PDF routes. |
| MongoDB post-purchase integration | PASS | Kafka worker, MongoDB notification and email delivery state, real Mailpit, owner filtering and two private PDF routes. |
| Chromium simulator to Mailpit | PASS | Real local Keycloak sign-in, checkout, simulator payment, PostgreSQL records, Kafka relay and worker logs, and downloaded Mailpit attachments. |
| API fast regression | PASS | 224 passed, 0 failed. The initial sandboxed invocation blocked HTTP test listeners. The run with local socket access passed. |
| Full API integration regression | FAIL | 108 passed, 1 failed, 5 skipped. The PostgreSQL order runtime fixture reported a startup failure without a child-process diagnostic. Both post-purchase cases passed in this run. |
| Focused order runtime recheck | PASS | The PostgreSQL and MongoDB cases both passed on the isolated rerun. The full integration regression was run once. |
| Cloud document stores, deployed brokers and external SMTP | NOT TESTED | Scope was the local Kafka and Mailpit path. |
| MongoDB browser checkout-to-email | NOT TESTED | The single browser smoke ran on PostgreSQL. MongoDB was exercised independently with real persistence, Kafka and Mailpit integration tests. |

In both post-purchase integration cases the first SMTP send was made to fail
before acceptance. The order stayed PAID and email state became PENDING. A
Kafka retry then delivered the real email to Mailpit. Explicit replay of the
same Kafka event produced one notification and one message for the fixture.

Run the local integration suite from the repository root with the existing
Compose services and `infra/.env` in place.

```sh
LOCAL_POST_PURCHASE_INTEGRATION=true python3 scripts/run-compose-integration.py
```

For a browser check, sign in as a local test customer at
[the storefront](http://localhost:8088), add a product to the cart, place the
order and click **Simulate successful payment**. Look for the matching order
reference in [Mailpit](http://127.0.0.1:8025). The local worker and API come from
the same API image. Docker Hub timed out during this verification, so the smoke
used the compiled API output packaged into the cached local runtime image.

## Browser smoke evidence

| Stage | Observed |
| --- | --- |
| Checkout | The simulator returned HTTP 200 and the storefront showed the thank-you page. Replay returned the same version. A subsequent conflicting failure returned HTTP 409. |
| Order | `7d0f8a53-7c12-417b-b43e-eb28d351e9a6`, PAID, version 3, INR 948.00. |
| Payment | `70a7b483-7363-43ea-8f9a-39c641750adf` matched the payment ID on the notification. |
| Outbox | One row for the order, event `1eefd112-4db8-42db-b916-d9a05e55a2ae`, PUBLISHED on attempt 1. |
| Kafka | Relay logged PUBLISHED. The worker logged processed for the same event on `order-events`, partition 0, offset 6. |
| Notification | One stored row for the event and order. The owner saw one matching notification and a second customer saw zero. |
| Email | One SENT delivery row and one captured message with the matching Message-ID, order reference, item names, quantities and total. Mailpit ID `ahtAqthx85HydjnH8oDWH7`. |
| PDFs | Mailpit downloads `invoice.pdf` (2,185 bytes) and `receipt.pdf` (2,170 bytes) both had PDF signatures. The owner's API PDF downloads succeeded. Both returned 404 for the second customer. |

## How the pieces fit together

The **outbox** is the app's durable to-send list. The payment handler saves a
paid order and its event together. If the broker is down, the payment still
stands and the relay can find the event later.

**Kafka** stores events in topic partitions. The order ID determines the
partition. The relay publishes the event, and the notification worker reads
it. The worker commits its position after handling the event or safely routing
it to the retry or dead-letter topic.

A **worker** is a separate process that does work outside the checkout request.
This worker records the customer notification, generates PDFs, and claims the
email send. An event can arrive more than once, so the notification uses a
unique event ID and the email uses a separate per-order claim.

## Remaining limitations

- SMTP cannot atomically commit with the database. A crash after an email claim,
  loss of acknowledgement during SMTP DATA, or storage failure after acceptance
  can leave a delivery in SENDING or UNCERTAIN. Those cases require
  reconciliation before replay to avoid sending a second email.
- Outbox rows that exhaust their attempt budget become FAILED. Exhausted Kafka
  processing goes to the dead-letter topic. Recovery from either terminal state
  requires operator diagnosis and controlled replay.
- The local Kafka setup uses one broker. The integration tests simulated broker
  unavailability and the publish-before-acknowledgement boundary. They did not
  certify a replicated cluster or a process kill during SMTP DATA.

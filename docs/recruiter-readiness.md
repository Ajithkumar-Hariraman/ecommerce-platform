# Recruiter readiness

Milestone 1 establishes a local engineering baseline for the checkout based on
`4c16606`. The application demonstrates a React storefront, an authenticated
Express API, two persistence adapters and an asynchronous payment-to-notification
flow. The matrix records what was actually exercised.

## Verification matrix

| Check | Result | Evidence |
| --- | --- | --- |
| GitHub Actions Platform verification #8 | FAIL | The fast job and host integration step passed. The full application and HTTP event flow exited 1. [Integration job](https://github.com/Ajithkumar-Hariraman/ecommerce-platform/actions/runs/44145082686/job/134257891428) |
| API clean dependency install, typecheck, build and fast tests | PASS | `npm ci`, `npm run typecheck`, `npm run build`, `npm test` in `apps/api`. Node 24.18.0, 223 passed, 0 failed, 0 skipped. |
| React clean dependency install, typecheck, build and fast tests | PASS | Same commands in `apps/web`. 16 passed, 0 failed, 0 skipped. |
| Full real-service integration suite | PASS | `python3 scripts/run-compose-integration.py`. 97 passed, 0 failed, 7 cloud opt-in skips on both the default local stack and the isolated infrastructure-only stack. PostgreSQL and MongoDB paths ran against `ecommerce_test`, with real Keycloak, Redis and Kafka. |
| Fresh Compose build and infrastructure | PASS | Config validation, image build and health-gated startup with newly initialized isolated Compose volumes. |
| Full Compose HTTP and Kafka smoke with PostgreSQL | PASS | `docker compose up -d --wait` and `python3 scripts/verify-compose.py`. Verified frontend proxy, OIDC 401/403, Redis TTL and invalidation, simulator HMAC, outbox publication and one notification. |
| Full Compose HTTP and Kafka smoke with MongoDB | PASS | Same commands with `ORDER_STORAGE=mongodb`. Verified the embedded outbox, one notification, duplicate callback handling and fixture cleanup. |
| Anonymous storefront screenshots | PASS | Chromium rendered all 30 bundled products with decoded images across catalog pages. Captured the storefront and one product detail. [Screenshots](../README.md#screenshots) |
| Tracked-file credential and customer-data review | PASS | Targeted pattern and filename scan and review of flagged configuration, realm users, fixtures and screenshots. Scope below. |
| Corrected workflow on GitHub-hosted runner | NOT TESTED | Local changes were verified without a push or remote dispatch. |
| Deployed AWS/GCP, live Razorpay and production HTTPS | NOT TESTED | Live providers and deployment verification require separate environments and authorization. |
| Full browser checkout, registration email and payment PDFs/email in this run | NOT TESTED | The smoke exercises HTTP, signed simulator callbacks and Kafka. Browser capture covers anonymous rendering. |

The isolated Compose project started with new volumes. Its local verification
copy used alternate published ports, project-scoped names and a matching
Keycloak hostname so the existing Compose stack could stay online. The
unmodified integration command also passed on the repository’s default local
ports. Verification used the simulator and test-owned database fixtures.
The disposable stack was stopped with its volumes retained.

## Failure investigation

GitHub’s Actions job logs API returned the log for job `134257891428`. The
step **Full application and HTTP event flow** failed with:

```text
[TypeError: fetch failed] {
  [cause]: Error: connect ECONNREFUSED 127.0.0.1:8180
}
Container smoke failed
```

The same fetch from inside the running API container reproduced the connection
refusal. The smoke used the browser-facing issuer as a network address. From
inside the API container its loopback points at the API container itself.
The test now obtains tokens through the Compose Keycloak backchannel while the
API validates the original public issuer and audience. The workflow still
fails on a smoke assertion or nonzero command exit.

Further local runs exposed additional stale assumptions. The smoke now checks
the backend/database namespace of Redis keys, uses the current order request
shape, waits for outbox publication and notification processing, and cleans up
only the fixture’s records, including the worker’s email-delivery row. Compose
now waits for service health and restarts Nginx when it updates the API
dependency, so switching backends refreshes the upstream address. PostgreSQL
readiness checks TCP to skip the temporary initialization server and MongoDB’s
published port is bound to loopback.

A separate suite run observed two outbox test claims where one was expected.
The PostgreSQL fixture’s 60 ms lease expired during the concurrent claim
assertion. The test now follows the existing MongoDB approach and advances
only its own stored deadline to exercise recovery and retry deterministically.
An exploratory isolated run started the host suite while its Compose relay was
still operating on the test database. The relay could claim the MongoDB
fixture before the test’s deliberate send-before-ack boundary. The documented
verification order follows CI and runs the host suite with only infrastructure
services started.

## Seven cloud opt-in tests

All seven contact live cloud infrastructure. Their existing opt-in gates stay
in place. Local Kafka retry and DLQ, persistence, duplicate callbacks, Redis
and OIDC checks already run without cloud credentials.

| Test | Flag | Why it stays outside credential-free CI |
| --- | --- | --- |
| AWS poison retry and repaired DLQ replay | `AWS_DLQ_INTEGRATION` | Sends poison data to a deployed SQS queue and receives, changes visibility and deletes test messages in the source and dead-letter queues. |
| AWS outbox through SNS and SQS | `AWS_EVENTS_INTEGRATION` | Publishes to a deployed SNS topic and consumes the deployed SQS queue, with a PostgreSQL fixture for deduplication. |
| AWS product upload and private PDF | `AWS_STORAGE_INTEGRATION` | Uses deployed S3 buckets, signed uploads, object-version reads and fixture version deletion. |
| PostgreSQL post-purchase PDF and email | `GCS_POST_PURCHASE_INTEGRATION` | Uses PostgreSQL, Kafka and Mailpit locally, plus authenticated private GCS PDF writes, reads and cleanup. |
| MongoDB post-purchase PDF and email | `GCS_POST_PURCHASE_INTEGRATION` | Exercises the MongoDB adapter with the same private GCS dependency and local mail/event services. |
| GCS signed product upload | `GCS_RUN_INTEGRATION` | Requires a live bucket, signing access, generation-bound reads and fixture object cleanup. |
| Pub/Sub publication and duplicate delivery | `PUBSUB_RUN_INTEGRATION` | Creates and deletes Pub/Sub topics and a subscription and publishes to the live GCP project. |

## Tracked-file review

Reviewed the current checkout for private-key blocks, common credential token
formats, literal connection credentials, tracked env or database dumps, and
email-like and customer data in fixtures and screenshots. The scan found
placeholders, synthetic fixture addresses, deployment identifiers and public
RDS CA certificates. No usable credential or private customer record was
identified in the tracked files reviewed. The Keycloak realm import references
environment-provided service secrets and contains service accounts rather than
shared human login credentials. Local env files are ignored. This was a
pattern-based review of the current tree, with Git history and external
deployment configuration outside its scope.

## Remaining gaps and next milestones

1. Confirm a new GitHub-hosted run after the changes land. Preserve failing
   integration diagnostics as evidence when a service fails.
2. Automate browser sign-in, cart, simulator success/failure and admin smoke
   against disposable fixtures. Add credential-free PDF and Mailpit coverage
   that exercises the local workflow independently of live GCS.
3. Certify cloud adapters and Razorpay Test Mode separately in dedicated
   environments. Document public HTTPS, recovery, observability and
   deployment verification before making production-readiness claims.

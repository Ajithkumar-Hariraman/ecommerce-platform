# Milestone 4 — Recruiter showcase

Verified locally with Node.js 24.18.0 and Docker Compose on 2026-11-22.
The [README](../README.md) is the quick introduction, the
[architecture](architecture.md) traces the payment-to-email flow, and the
[interview walkthrough](interview-walkthrough.md) includes a four-minute live
demo script.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| KafkaJS elapsed-time regression | PASS | The new test failed before the patch with a simulated forward clock jump. After the patch, all seven timer checks passed, including expiry after a backward jump. |
| Both Milestone 3 Kafka integration cases | PASS | Before and after focused runs each passed both cases. Assertions cover partitioning, deduplication, offset persistence, lock recovery, retry exhaustion, invalid events and real Keycloak/API/provider/worker traffic. |
| API typecheck, build and fast regression | PASS | 225 passed, 0 failed. |
| Web typecheck, build and fast regression | PASS | 16 passed, 0 failed. |
| Complete host integration regression | PASS | One unfiltered run against `ecommerce_test` passed 109 tests with 0 failures and 5 cloud opt-in skips. Both Kafka cases and both local PDF, notification and Mailpit cases passed. |
| Compose configuration and application image build | PASS | Validated the Compose configuration and built the API, web and provider images with the current checkout. |
| Compose HTTP and event smoke, PostgreSQL and MongoDB | PASS | Ran the workflow smoke locally against `ecommerce_test` in both modes. Verified Nginx proxying, OIDC, Redis behavior, simulator HMAC, Kafka/outbox publication and durable notification deduplication. |
| Chromium demo and screenshots | PASS | Reused the storefront capture and refreshed product details on the current build. Captured cart, checkout, orders, notifications and admin using disposable Keycloak users and local PostgreSQL/simulator data. Verified paid order, persistent notification read state and both downloaded PDF headers. A first browser harness attempt waited for the wrong paid-status label. The corrected run passed. |
| Hosted GitHub Actions for this checkout | NOT TESTED | Both hosted jobs passed on the public repository for baseline commit `6a26237` on November 20. This milestone's changes are local. [Hosted baseline run](https://github.com/Ajithkumar-Hariraman/ecommerce-platform/actions/runs/44709539656) |
| Actual Razorpay Test Mode capture and Razorpay-delivered public HTTPS webhook | NOT TESTED | Checkout screenshots use the simulator. Local regression covers mocked provider responses and signed callback handling. |
| External SMTP acceptance reconciliation and cloud opt-ins | NOT TESTED | Mailpit represents local SMTP. Cloud skips cover three AWS checks, GCS signed upload and Pub/Sub. External SMTP acceptance was outside this run. |

## Kafka timeout investigation

- The Milestone 3 DLQ test reported a 15-second polling timeout in a test that
  ran for about 15.3 seconds total, including a 12-second idle check and a
  separate retry-recovery step. The broker log timestamps on fixture records
  show a wall-clock discontinuity of about 32 minutes. Using `Date.now()` for
  elapsed polling time allowed the DLQ deadline to expire early.
- The adjacent `CreateTopics` case failed after about 109 ms despite a
  substantially longer configured request deadline. KafkaJS 2.2.4 measured
  in-flight time from epoch timestamps. The synthetic clock test reproduced
  that premature expiry mechanism. The exact ordering of clock changes and
  the original failing request is unverified.
- The integration poll and KafkaJS socket request expiry now use monotonic
  elapsed time. The patch preserves wall-clock diagnostic timestamps. Existing
  deadlines and assertions are intact. Compose gates on a broker metadata
  check, and topic setup separately checks leaders. The two tests use unique
  topics and groups, and their child processes explicitly use the same broker
  and Kafka transport. The idle delay continues to exercise long polling.
- No Kafka test failed in this milestone. The clock-jump regression covers
  the reproduced mechanism. One full pass leaves long-run flakiness unmeasured.

## Reproduce credential-free CI

Use a fresh checkout on a Docker host with the default loopback ports
available. Keep application workers stopped during the host integration
run so they cannot claim test fixtures. The generated env file is private
and targets `ecommerce_test`.

```sh
(cd apps/api && npm ci && npm run typecheck && npm test && npm run build)
(cd apps/web && npm ci && npm run typecheck && npm test && npm run build)
python3 scripts/prepare-ci-env.py
docker compose -f infra/compose.yaml config --quiet
docker compose -f infra/compose.yaml build
docker compose -f infra/compose.yaml up -d --wait postgres mongodb redis-cache kafka mailpit keycloak
LOCAL_POST_PURCHASE_INTEGRATION=true python3 scripts/run-compose-integration.py
for backend in postgres mongodb; do
  export ORDER_STORAGE="$backend"
  docker compose -f infra/compose.yaml up -d --wait
  python3 scripts/verify-compose.py
done
docker compose -f infra/compose.yaml stop
```

## Remaining release gates

- Observe a hosted Actions run on the milestone revision.
- Capture a genuine Razorpay Test Mode payment and verify the provider delivers
  the signed webhook to an approved public HTTPS endpoint.
- A revoked Keycloak session blocks refresh. An already issued JWT remains
  usable through expiry plus clock tolerance, up to about 305 seconds.
- Checkout validates current stock. Concurrent checkouts can oversell because
  there is no inventory reservation or atomic decrement.
- On ambiguous SMTP acceptance, preserve the delivery record and reconcile
  the stable Message-ID with provider logs before retrying. See the
  [reconciliation procedure](milestone-3-reliability-security.md#payment-and-delivery-reliability).

## Milestone 4 files

- `README.md`, `docs/architecture.md`, `docs/interview-walkthrough.md`, and
  `docs/recruiter-showcase.md`.
- `docs/screenshots/product-detail.png`, `docs/screenshots/cart.png`,
  `docs/screenshots/checkout.png`,
  `docs/screenshots/orders.png`, `docs/screenshots/notifications.png`, and
  `docs/screenshots/admin-dashboard.png`.
- `apps/api/scripts/patch-kafkajs-timer.cjs`,
  `apps/api/test/kafka-timer.test.ts`, and
  `apps/api/test/integration/kafka.test.ts`.
- `.github/workflows/ci.yml` enables credential-free PDF and Mailpit
  integration checks by starting Mailpit with the host-test infrastructure.

Milestone 2 and 3 worktree changes were preserved. Browser-created synthetic
orders were retained for local demonstration. Disposable Keycloak users
were removed. The original PostgreSQL development runtime was restored. Local credentials and volumes were preserved. No commit, push,
paid deployment or live payment was made.

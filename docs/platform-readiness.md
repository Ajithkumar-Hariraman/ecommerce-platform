# Platform readiness checkpoint

Final local verification: 2026-10-02. Branch: release/platform-readiness.

| Checkpoint | Commit | Result |
|---|---|---|
| Isolated fixtures | 64cfe75 | Full integration suite includes status fixture; unrelated rows preserved |
| OpenAPI | 4cdc776 | OpenAPI 3.1; /openapi.json and /docs; Bearer JWT and independent HMAC |
| Container platform | 83b7827 | API/web/provider images, PostgreSQL and separate event workers |
| CI | 8f92446 | actionlint and local workflow commands passed; no remote execution |
| GCP foundation | 9b949db | Project-locked script committed; live provisioning blocked |

## Final verification

- Backend npm run typecheck, npm test, npm run build, npm run test:integration.
- Full fast suite: 172 passed, zero failed/skipped.
- Full integration suite: 61 passed, zero failed/skipped; ecommerce_test only.
- Frontend typecheck and production build passed; no browser automation.
- Compose config/image builds and real container HTTP smoke passed, including after
  host restart and API recreation. API, web, provider and infrastructure are healthy;
  relay and notification worker run as separate processes.
- Real Keycloak 401/403/success and Redis 429 regressions passed. HMAC rejection,
  duplicate webhook, cache hit/miss/invalidation, Kafka retry/DLQ/deduplication and
  PostgreSQL/Mongo outbox recovery passed in the full suite.
- Container smoke observed PAID plus PENDING outbox, then PUBLISHED and one notification.
- Structured runtime JSON logs observed. Credentials/generated-file scan passed.

Final review corrected CSV API documentation: duplicate SKU is a failed row in the
HTTP 200 summary, not an HTTP 409 import response. The host restart also exposed Kafka
request timeouts in the idle worker. The client request budget is now 10 seconds,
allowing long polls/admin requests scheduling headroom; producer broker acknowledgement
remains bounded separately. A real integration assertion covers idle consumer survival.
The rebuilt worker and container event flow passed. CI previously exposed and corrected
Nginx stale upstream DNS after API recreation. No data reset was used for either issue.

## External limitations

GCP project: ecommerce-platform-510208. At preflight, gcloud was not installed and no
standard login configuration was found. No cloud APIs/resources were mutated or verified;
no Cloud Run revision, cloud health or Cloud Logging ingestion is certified. Install the
CLI, authenticate and supply production endpoints following [deployment steps](gcp-deployment.md).
Local development Keycloak is not exposed as a production issuer. Kafka worker hosting,
external broker, Redis and optional managed Mongo remain explicit cloud deployment choices.

No Git remote or remote CI execution is configured. CI syntax and its commands were
verified locally. No push or merge occurred. Existing development data and unrelated
containers were preserved. Local application containers currently use ecommerce_test
for verification; see [container runtime](container-runtime.md) before changing to dev data.
Personal understanding is not inferred from passing automated tests.

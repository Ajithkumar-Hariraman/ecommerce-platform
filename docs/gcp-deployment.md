# GCP deployment foundation

Project is locked to **ecommerce-platform-510208**. No other project is created.
`infra/gcp/deploy.py` defaults to a mutation-free plan. `--apply` requires an active
gcloud account, checks project selection, validates external endpoints, then creates
or reuses resources. No secret, token, or service-account JSON is stored in Git.

```sh
python3 infra/gcp/deploy.py --region asia-south1
# After installing Google Cloud CLI and authenticating interactively:
gcloud auth login
gcloud auth list
gcloud config get-value project
gcloud config set project ecommerce-platform-510208
```

Use a region approved for your data and budget; asia-south1 is an example, not a
provisioned location. Cloud resources incur charges. Verify billing and IAM permissions
before apply. The script enables only Run, Artifact Registry, SQL Admin, Secret Manager,
IAM, Logging and Monitoring; local Docker builds do not require Cloud Build API.
It does not print account identities, secrets, or captured cloud command output.

## Resources and release sequence

1. Artifact Registry Docker repository `ecommerce` and identity `ecommerce-api`.
2. Cloud SQL PostgreSQL 17 instance `ecommerce-postgres`, initially db-f1-micro,
   10 GB SSD, daily backup, deletion protection; database ecommerce and dedicated user.
   This small single-zone foundation is not an HA/SLA production sizing claim.
3. Secret Manager DB password and provider HMAC secret; numeric versions pinned into
   revisions. Existing secrets/users are reused, not silently rotated. A mismatch
   requires coordinated rotation. Redis URL is secret-backed when it embeds a password.
4. Identity receives Cloud SQL Client and access only to the referenced secrets.
5. Build/push API image, resolve immutable digest, run explicit migration Cloud Run Job.
6. Deploy private Cloud Run API with auth enabled, HTTPS OIDC issuer, Unix Cloud SQL
   socket, /health startup probe, zero minimum / two maximum instances, concurrency 20.
   Existing pool max=5 bounds API connections to approximately 10 at two instances;
   migrations, other workloads and transient rollout overlap need additional headroom.

Runtime configuration must be supplied privately before applying:

```sh
export OIDC_ISSUER=https://YOUR_REACHABLE_ISSUER/realms/ecommerce
export OIDC_AUDIENCE=ecommerce-api
export PAYMENT_PROVIDER_BASE_URL=https://YOUR_REACHABLE_PROVIDER
export REDIS_URL=rediss://YOUR_REACHABLE_REDIS:6379
read -r -s -p 'Provider shared webhook secret: ' PAYMENT_WEBHOOK_SECRET
export PAYMENT_WEBHOOK_SECRET
# Optional, required when private Redis connectivity needs an existing connector:
# export GCP_VPC_CONNECTOR=YOUR_EXISTING_CONNECTOR
python3 infra/gcp/deploy.py --region asia-south1 --apply
unset PAYMENT_WEBHOOK_SECRET
```

Do not enable shell tracing. The Cloud SQL CLI requires a password argument for user
creation; the script captures output and never logs arguments. Execute only on a trusted
operator host. Existing SQL user/password mismatch is not automatically repaired.
A failed provisioning operation stops subsequent operations; inspect the named operation
in the cloud console, correct IAM/billing/configuration, then rerun. No resource deletion
or destructive rollback is performed. The operator needs service enablement, resource
administration, IAM binding/service-account use and secret permissions; runtime identity
is substantially narrower.

## Boundaries that still require deployment decisions

- Local development Keycloak must not be exposed publicly. Supply a real HTTPS issuer.
- Local payment simulator is not a hosted commercial provider. Supply a reachable
  provider and matching HMAC secret. Default Cloud Run is IAM-private: callback delivery
  additionally needs an authorized Google identity, or a reviewed edge exposure policy.
  App-level HMAC and JWT must remain intact whichever edge policy is chosen.
- Redis needs reachable external infrastructure, such as a Memorystore-compatible
  deployment plus VPC connectivity. No managed Redis is provisioned here. Cache and
  limiter retain the documented fail-open policy.
- API Order storage deploys as PostgreSQL. Mongo requires a separately managed deployment;
  local Mongo Docker is not a cloud resource.
- Kafka remains Kafka. Managed Kafka, external Kafka or GKE is a separate decision.
  The relay and long-running consumer need always-running compute and broker networking.
  This script does **not** deploy them to request-driven Cloud Run services or replace
  Kafka with Pub/Sub. Paid events remain durably pending until a relay is deployed.
- Cloud Run filesystem is temporary; application state remains in external stores.
  API/outbox/worker logs emit JSON severity/message/details on stdout/stderr for Cloud
  Logging; do not insert request payloads or credentials into log call sites.

## Verification and current blocker

On 2026-10-01, `gcloud auth list` and `gcloud config get-value project` both failed:
`gcloud: command not found`. No CLI was on Windows or WSL PATH; standard local gcloud
configuration directories were absent. Account availability and cloud project resources
could not be verified. **No APIs, registry, SQL, secrets, or Cloud Run resources were
created or verified.** Repository-side plan/syntax and local structured logging are tested.

Next operator action: install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install),
run the login/project commands above, configure the required external endpoints, then
review the plan before --apply. No deployment success is implied by repository tests.

After successful apply, record service, region, ready revision and image digest:

```sh
gcloud run services describe ecommerce-api --project=ecommerce-platform-510208 --region=asia-south1 --format='value(status.latestReadyRevisionName,status.url)'
gcloud run services proxy ecommerce-api --project=ecommerce-platform-510208 --region=asia-south1 --port=8085
# In another terminal, through the authorized proxy:
curl --fail http://127.0.0.1:8085/health
curl --fail http://127.0.0.1:8085/ready
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="ecommerce-api"' --project=ecommerce-platform-510208 --limit=10 --format=json
```

Authenticated API verification additionally requires a valid token from the configured
OIDC issuer. Readiness checks required SQL; Redis degradation does not change readiness.
Swagger is off by default in this production deployment. Record failures as failures.

References: [Cloud SQL sockets](https://docs.cloud.google.com/sql/docs/postgres/connect-run),
[service identity](https://docs.cloud.google.com/run/docs/configuring/services/service-identity),
[structured logging](https://docs.cloud.google.com/run/docs/logging).

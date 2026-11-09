# AWS deployment runbook

## Current gate

PUBLIC HTTPS: **BLOCKED MANUAL ACTION — DOMAIN OR CLOUDFRONT ACCOUNT VERIFICATION REQUIRED**.
Route53 hosted zones and registered domains, plus ap-south-1 ACM certificates,
were empty on inspection. Repository configuration supplied no user-owned domain.
CloudFront remains optional and disabled; its AWS account-verification rejection
does not gate ECS. Web/API can run behind the closed diagnostic ALB already.

For direct ALB HTTPS, supply the owned base domain as `domain_name` and, when
applicable, `route53_zone_id` in ignored deployment.auto.tfvars. First leave
`enable_https=false` and apply the reviewed certificate/DNS plan. Terraform
output `acm_dns_validation` gives exact CNAME name/type/value tuples. If DNS is
external, enter those records at its provider: **BLOCKED MANUAL ACTION — DNS
VALIDATION** until ACM is ISSUED. Add shop/api/auth CNAMEs to the ALB DNS name
(or Route53 alias A records are managed automatically). Then set
`enable_https=true`, review/apply: validation gates the 443 listener, host rules,
and HTTP redirect. Do not set this without a domain. Rebuild web using
`VITE_KEYCLOAK_URL=https://auth.<owned-domain>/auth`; API requests use existing
same-origin `/api`, routed by ALB directly to API. S3 CORS uses exact shop origin.
Realm import does not overwrite an existing realm: deliberately update its exact
redirects/origin/logout settings through the admin API after the domain exists.
No SMTP credentials are required for durable notifications; email delivery remains
**BLOCKED MANUAL ACTION — PROVIDER CREDENTIALS**.

## Identity and state

Use Node from .nvmrc, Terraform >=1.10 and AWS profile cloudops, region ap-south-1.
Both provider and backend restrict account ID to 201943655840.

```
aws sts get-caller-identity --profile cloudops --region ap-south-1
terraform -chdir=infra/aws/bootstrap init
terraform -chdir=infra/aws/environments/dev init
terraform -chdir=infra/aws/environments/dev plan -out=review.tfplan
terraform -chdir=infra/aws/environments/dev apply review.tfplan
```

Bootstrap is separate from the environment and already applied. Its own state
was moved into S3 at bootstrap/terraform.tfstate; environment state uses
 dev/terraform.tfstate. Bucket ecommerce-tfstate-201943655840-ap-south-1 has
versioning, AES256 encryption, blocked public access, owner-enforced ownership,
TLS-only policy and prevent_destroy. S3 locking uses use_lockfile=true.
No DynamoDB lock table or application files share this bucket.

Never commit .terraform, state, plans, auto.tfvars, local env or Docker credentials.
The operator state policy limits object access to the two state keys and lockfiles;
application deployment roles receive no state access. Generated passwords remain
sensitive in encrypted state, so treat state readers as privileged operators.

## Initial deployment ordering

1. Apply foundation and private data resources. Record actual Terraform outputs.
2. Build API/web/keycloak Linux AMD64 images. Use the final auth hostname for the production
   build; closed bootstrap deployments use the actual ALB identity only. Run backend/frontend typechecks, tests and builds before release.
3. Run infra/aws/scripts/push-images.py to push built images with a Git SHA plus
   source digest. This script does not push Git and removes its temporary Docker
   login directory. The unrelated existing ECR repository is never addressed.
4. Set ignored deployment.auto.tfvars release_tag to the pushed tag. Initially
   keep start_services=false and enable_database_bootstrap=true.
5. Register ECS bootstrap and migration definitions. These are independent of CloudFront; use a
   full reviewed plan.
6. Run python3 infra/aws/scripts/run-task.py database-bootstrap, inspect exit 0.
   This creates runtime/migration/Keycloak roles and keycloak_prod, without old data.
7. Run python3 infra/aws/scripts/run-task.py migration, inspect exit 0. The command
   invokes existing checksum migrations followed by a safe idempotent product seed.
8. Disable enable_database_bootstrap and apply removal of its temporary execution
   access. Never leave ongoing migration tasks able to retrieve the RDS admin secret.
9. Run import-razorpay.py only with valid existing local Test Mode credentials.
   It transfers values through process memory/stdin and prints secret names only.
10. Deploy Keycloak/API/web independently of optional CloudFront. Resolve trusted
    HTTPS and exact CORS before browser auth/payment certification. Use deploy-release.py after initial
    service definitions exist. It registers migration, verifies exit code before
    any service change, and waits for each service group to stabilize.
11. Configure Razorpay Dashboard webhook to the deployed API route from razorpay.md,
    using the same AWS webhook secret. Perform actual Test Mode browser checkout.

Keycloak import occurs only for a fresh realm; later changes require deliberate
admin configuration, not assumption that --import-realm overwrites live settings.
No sample users or client secrets are imported into AWS. Redirects are exact routes;
new product/order return routes may require an explicit callback strategy before
allowlisting. Never add broad wildcard redirect origins to resolve a login error.

## Verification

From apps/api run npm run typecheck, npm run build, npm test and npm run
 test:integration. Integration configuration enforces ecommerce_test. Historical
multi-provider suites also require Mongo credentials and some require GCS/Mailpit;
do not restore GCP to satisfy them. Report failures/skips, not a fabricated pass.

Explicit opt-in AWS tests, with cloudops, include:

```
AWS_PROFILE=cloudops AWS_STORAGE_INTEGRATION=true node --import tsx --test test/integration/aws-storage.test.ts
AWS_PROFILE=cloudops AWS_EVENTS_INTEGRATION=true node --import tsx --test test/integration/aws-events.test.ts
```

Storage cleans uniquely owned versions. Events use an owned ecommerce_test schema
and delete only test-event messages. Run while no live worker can consume the test
fixture. These tests prove adapters and real transports; they do not prove an ECS
checkout or cloud database deployment. The event schema test is at-least-once,
with one durable notification observed after duplicate delivery.

Required remaining live checks: health/ready/catalog; browser signup/login/logout/
login and protected routes; cart/order/Test Mode captured payment; signed webhook;
PAID/outbox/SNS/SQS/worker/one notification; private PDF; cache hit/invalidation/
rate limiter; worker crash/native queue-wide redrive; graceful DB/cache outage checks;
CloudWatch metrics and service stabilization. Never deliberately damage resources.

## CI/CD

.github/workflows/deploy-aws.yml is manual-dispatch and restricted to
release/platform-readiness. Verification precedes OIDC authentication/image push.
Set repository variables AWS_STOREFRONT_ORIGIN, AWS_AUTH_ORIGIN and AWS_API_ORIGIN
to their final exact HTTPS origins. The checkpoint commit/push is authorized;
manual workflow dispatch is still required and has not been requested.
OIDC trust binds audience sts.amazonaws.com and the exact repository and branch.
No static AWS access keys are used. The deploy role has dedicated ECR push,
ECS registration/deployment, migration-only RunTask and restricted PassRole.

Remote OIDC/CI execution remains uncertified. The authorized checkpoint push
does not trigger this manual-only workflow. Its migration gate checks task exit
before service deployment; final HTTPS origins remain a deployment prerequisite.

## Operations, monitoring and costs

CloudWatch log retention is seven days. Dashboard ecommerce-dev and alarms cover
RDS CPU/connections/storage, Valkey memory/evictions, SQS age/DLQ, ALB target errors;
additional widgets cover requests/4xx/latency, cache connections, queue depth and
ECS running/desired counts. No external alarm recipient is configured. Inspect
console state and logs; missing metrics are not evidence that a workload is healthy.
Task restart alarm/event monitoring still requires verification/extension.

On an SQS failure, inspect redrive/receive counts and sanitized worker logs keyed
by eventId. Repair the dependency or payload before controlled replay. Never purge
queues as a retry strategy. Keep source seven days, DLQ 14 days, visibility at
least maximum observed handling time, and acknowledge only after durable processing.

Idle billing includes RDS, Valkey, ALB/LCUs, Fargate when started, public IPv4,
Secrets Manager, S3/versioned state/assets, ECR image storage and CloudWatch.
RDS deletion protection and retained backups/snapshots can continue billing after
application scale-down. No NAT Gateway, EKS, interface endpoint fleet, Multi-AZ RDS
or extra unrelated ECR resources are created. No blanket destroy is authorized.

SMTP provider credentials and Razorpay Dashboard actions are manual dependencies.
Do not invent SMTP settings or use production Mailpit. Durable notification
functionality must work independently with SMTP_ENABLED=false.

## Verified checkpoint after initialization

Bootstrap and migration/seed exited 0. The bootstrap task was deregistered and its
extra secret access removed. start_background=true is recorded in the ignored
deployment.auto.tfvars; start_services remains false. ecommerce-relay and
ecommerce-worker are stable at desired/running 1. The verification RunTask exited
0 and logged RDS TLS, denied runtime schema creation, seed and Valkey commands.
A real deployed-DLQ test passed five receives and repaired message-specific replay;
this is not a claim of queue-wide native redrive or full browser E2E.

For retained local multi-adapter regressions, run from apps/api:
`node scripts/run-aws-regressions.mjs`. It privately reuses the existing local
Mongo service URI, selects ecommerce_test through the test harness, and explicitly
disables GCP integration. The configured final run passed 88 with 12 opt-in skips;
these skips are not equivalent to certification of browser/OIDC/GCP scenarios.
Migration 013 prevents the runtime DB role from modifying schema_migrations.
Two moderate gaxios/uuid audit findings remain in retained Google dependencies;
compatible fixes removed high findings, and no forced major upgrade was used.

Stopped ECS task events are captured through a cluster-scoped EventBridge rule to
/ecommerce/dev/task-events (seven days). A metric filter counts nonzero essential
container exits; its console alarm excludes normal zero-exit migrations/deployments.
Actual delivery to this log group was observed. See the AWS EventBridge resource
policy model: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-use-resource-based.html.

The active-service transport check is `python3 infra/aws/scripts/verify-deployed-events.py`.
It inserts one owned synthetic outbox fixture, observes actual relay publication
and worker persistence, replays that fixture, verifies processed/duplicate worker
logs with one durable notification, and cleans its own rows. It passed against
the deployed services. It does not create or certify a Razorpay payment/order.

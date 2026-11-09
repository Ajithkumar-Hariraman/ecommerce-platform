# AWS deployment status — application services deployed, E2E incomplete

Observed 2026-11-09 in account 201943655840, ap-south-1. Checkpoint commit/push authorized; manual AWS deployment remains pending.

PUBLIC HTTPS: **BLOCKED MANUAL ACTION — DOMAIN OR CLOUDFRONT ACCOUNT VERIFICATION REQUIRED**.
Route53 hosted zones and registered domains were empty; ap-south-1 ACM list was
empty. No user-owned domain was found in project configuration/documentation.
The actual ALB DNS is `ecommerce-dev-631363343.ap-south-1.elb.amazonaws.com`.
It is a gated diagnostic origin, not a trusted public storefront URL.

CloudFront: **BLOCKED MANUAL ACTION — AWS ACCOUNT VERIFICATION**; optional and
disabled. It no longer prevents ECS task definitions/services from deploying.
ALB + ACM is the prepared HTTPS path, not a deployed HTTPS claim. No certificate
was requested for an invented domain and no TLS/authentication check was disabled.

## Original eight additions

| Terraform resource | Classification |
|---|---|
| aws_cloudfront_distribution.main | CLOUDFRONT-ONLY |
| aws_ecs_task_definition.task["web"] | REQUIRED |
| aws_ecs_task_definition.task["api"] | REQUIRED |
| aws_ecs_task_definition.task["keycloak"] | REQUIRED |
| aws_ecs_service.task["web"] | REQUIRED |
| aws_ecs_service.task["api"] | REQUIRED |
| aws_ecs_service.task["keycloak"] | REQUIRED |
| aws_s3_bucket_cors_configuration.products[0] | REQUIRED for browser upload; deferred until exact origin exists |

No original addition was otherwise OPTIONAL. Future CloudFront usage itself is
optional. Initial plan observed exactly 8 additions, 0 changes, 0 deletions.
After deployment, full Terraform plan reports no changes. Release rollouts
replaced old ECS task-definition revisions only; no data resources were deleted.
Future ACM, DNS, 443 listener/host rules and exact CORS remain domain-dependent.

## New live evidence

- Web/API/Keycloak/relay/worker each desired 1, running 1, deployment COMPLETED.
- Web/API/Keycloak targets healthy. Keycloak management health checks use port
  9000 and /auth/health/ready with ALB-only security-group access.
- Gated HTTP /health, /ready, catalog, /, /account and /orders returned 200.
  SPA fallback delivered the React document; this is not browser auth evidence.
- Catalog returned Classic Everyday Tote, SKU CLASSIC-EVERYDAY-TOTE, 79900 paise.
- Live unauthenticated and invalid-token Order requests returned 401; an invalid
  Razorpay HMAC returned 401 without creating an Order/payment.
- Corrected optimized Keycloak image builds /auth in advance. Logs confirmed
  Keycloak 26.7.4, fresh ecommerce realm import and bootstrap completion.
  JDBC uses verify-full RDS TLS and max pool 5; database connection health is UP.
  Registration/reset, exact bootstrap redirects, S256 and RBAC are imported.
  Final domain redirects must be deliberately updated; reimport does not overwrite.
- API-role ECS probe authenticated to Razorpay Test Mode Orders GET over HTTPS
  (no payment/order creation), and put/read exact S3 versions in both buckets.
  It used injected Secrets Manager credentials; owned S3 versions were removed.
- Independent ECS verification exited 0: RDS TLS, denied runtime schema creation
  and migration-history UPDATE, seed, and authenticated TLS Valkey commands.
- New synthetic event 2d7ce120-25bb-41a4-bc2c-cfd715fbe454 passed actual ECS relay
  -> SNS -> SQS -> actual worker -> one durable RDS notification after replay.
  Worker processed/duplicate outcomes observed. Only fixture rows were removed.
- RDS private/encrypted, S3 all four BPA controls/versioning and Valkey TLS/auth/
  encryption read back live. Bounded logs showed no credential-pattern matches;
  this is a sample, not proof about every historical log entry.
- Prior live S3 signed upload/VersionId/GET/private PDF and poison DLQ recovery
  evidence remains valid; neither substitutes for browser/application E2E.

## Verification and changes

Node 24.18.0: backend typecheck/build PASS; 215 fast tests PASS; retained local
integration run 88 PASS, 0 FAIL, 12 explicit opt-in skips on ecommerce_test.
Frontend typecheck, three test files and build PASS. All AMD64 image builds PASS.
A first sandbox-restricted run failed and one concurrent lifecycle run timed out;
the full rerun above passed after builds finished. No failed result is hidden.
Terraform fmt -check/validate PASS; final plan no changes; git diff --check PASS.
No active a.run.app reference found in web source/Dockerfile/AWS workflow/config.
Localhost development defaults remain. Final AWS frontend build URL awaits domain.

This continuation changed AWS edge/services/storage/network configuration, added
https.tf, corrected Keycloak Docker build, added deferred fail-closed OIDC discovery
and two tests, adjusted CI origin variables, and updated the six requested docs.
All pre-existing uncommitted AWS/frontend work was preserved.

## Completion matrix

| Area | Status | Evidence / remaining boundary |
|---|---|---|
| AWS FOUNDATION | PASS | Dedicated deployed foundation; private data tier |
| ECR | PASS | Three immutable AMD64 images; release 5964dc48fd39-46653dc516c9 |
| VPC | PASS | Dedicated two-AZ VPC and isolated data subnets |
| ALB | PASS | Three healthy targets; gated diagnostic listener |
| HTTPS | BLOCKED MANUAL ACTION | DOMAIN OR CLOUDFRONT ACCOUNT VERIFICATION REQUIRED |
| WEB ECS | PASS | desired/running 1/1; COMPLETED; target healthy; SPA fallback 200 |
| API ECS | PASS | desired/running 1/1; COMPLETED; health/ready/catalog 200 |
| KEYCLOAK ECS | PASS | 26.7.4; 1/1 COMPLETED; management readiness healthy; fresh realm imported |
| RDS | PASS | Private 16.14; verified TLS; migrations 001–013; runtime restrictions |
| VALKEY | PASS | Private; TLS/auth/encryption; live bounded command probe |
| S3 | PASS | Private/versioned/BPA; API task-role versioned PUT/GET |
| SNS | PASS | Actual deployed relay publication |
| SQS | PASS | Actual worker processing and duplicate replay |
| DLQ | PASS | Prior live message-specific poison/recovery evidence retained |
| OUTBOX RELAY | PASS | 1/1 COMPLETED; synthetic event published |
| NOTIFICATION WORKER | PASS | 1/1 COMPLETED; exactly one durable notification after replay |
| AUTH SIGNUP | BLOCKED MANUAL ACTION | Trusted HTTPS origin absent; realm registration enabled |
| AUTH SIGNIN | BLOCKED MANUAL ACTION | Trusted HTTPS origin absent; PKCE S256 configured |
| AUTH LOGOUT | BLOCKED MANUAL ACTION | Trusted HTTPS origin absent; exact final redirects pending |
| PROTECTED ROUTES | PARTIAL | Live missing/invalid token 401; JWT/RBAC tests pass; authenticated browser pending |
| RAZORPAY ORDER | PARTIAL | Implementation/regressions pass; no live AWS order created |
| RAZORPAY CHECKOUT | BLOCKED MANUAL ACTION | Trusted HTTPS and browser checkout required |
| RAZORPAY WEBHOOK | PARTIAL | Live invalid HMAC 401; final Dashboard endpoint/captured payment pending |
| PAYMENT PAID | BLOCKED MANUAL ACTION | No captured AWS browser Test Mode payment |
| OUTBOX E2E | PARTIAL | Deployed synthetic transport passes; payment-originated transaction pending |
| S3 E2E | PARTIAL | Live adapter and ECS-role evidence; browser upload/revision/image and order PDF E2E pending |
| VALKEY E2E | PARTIAL | Live TLS commands pass; API miss/hit/mutation/rate-limit certification pending |
| DUPLICATE WEBHOOK | PARTIAL | Regression evidence only; live signed duplicate pending |
| DUPLICATE SQS | PASS | Live replay processed as duplicate; one durable notification |
| IAM | PASS | Scoped workload roles; no runtime admin; temporary bootstrap grant removed |
| SECRETS | PASS | Named Secrets Manager injection; no secret values committed/output |
| CLOUDWATCH | PASS | Task logs, dashboard, nine alarms; bounded log credential scan clean |
| TERRAFORM | PASS | fmt-check/validate; final full plan no changes, zero deletes |
| GITHUB OIDC | PARTIAL | Exact repository/branch trust deployed; remote assumption unexecuted |
| GITHUB ACTIONS | BLOCKED MANUAL ACTION | PUSH AUTHORIZATION; final HTTPS repository variables also required |
| DOCUMENTATION | PASS | Six requested documents updated to actual deployed/blocked state |
| GCP ACTIVE DEPENDENCIES | PARTIAL | Retained intentionally until AWS application E2E passes |
| FINAL AWS E2E | BLOCKED MANUAL ACTION | Public HTTPS, browser auth and captured Test Mode payment remain unproven |

## Manual boundaries

1. Supply a user-owned base domain and DNS provider. The runbook describes the
   staged ACM DNS validation -> ALB 443 -> host DNS -> HTTP redirect path.
   Exact ACM CNAMEs can only be produced after the real certificate request.
2. Once HTTPS exists, update exact realm redirects/origin/logout and rebuild SPA
   with auth hostname, then run native browser signup/signin/logout/PKCE/RBAC.
3. Razorpay Dashboard, Test Mode: add `https://api.<owned-domain>/api/v1/webhooks/razorpay`,
   subscribe payment.captured and payment.failed, use the existing named AWS
   ecommerce/dev/razorpay-webhook-secret through an authorized private operator
   session. Do not paste it into Git/docs/chat. No endpoint is presently final.
   Then perform one INR 799 checkout and verify PAID/dedupe/outbox/notification.
4. GitHub: checkpoint commit/push authorized. Manual AWS workflow dispatch remains
   pending and is not part of this checkpoint.
   Remote execution additionally needs final AWS_STOREFRONT_ORIGIN,
   AWS_AUTH_ORIGIN and AWS_API_ORIGIN variables. A push alone does not resolve HTTPS.
5. SMTP: **BLOCKED MANUAL ACTION — PROVIDER CREDENTIALS** (not a core E2E gate).
   CloudFront account verification is optional, not a portfolio completion gate.

GCP cleanup was intentionally not started: its explicit AWS E2E prerequisite has
not passed. No Google SDK was removed while retained adapters still import it.
No full AWS migration/portfolio-ready claim is made.

## Scores

IMPLEMENTATION COMPLETION / AWS IMPLEMENTATION: **90/100**.
Engineering estimate: foundation 30/30, runtime 25/25, final identity/frontend
configuration 15/20, commerce/adapters 15/15, delivery/operations 5/10.

AWS LIVE CERTIFICATION: **60/100**.
Evidence-weighted: foundation 25/25, deployed services 20/20, async transport
10/10, storage/cache application/browser coverage 5/10, auth 0/15, payment 0/15,
remote delivery 0/5. Optional CloudFront and SMTP carry no penalty. These are
scope estimates, not a claim that unexecuted scenarios pass.

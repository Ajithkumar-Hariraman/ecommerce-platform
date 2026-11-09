# Fresh AWS architecture — implementation in progress

This is a fresh deployment in account `201943655840`, region `ap-south-1`.
No GCP restoration, data export, migration, rollback, or dual writing is involved.
Existing GCP files remain until AWS browser/payment E2E is proven. Their presence
must not be interpreted as an active GCP recovery plan.

## Observed deployed foundation

Terraform created the dedicated two-AZ VPC, public ECS subnets and private data
subnets, isolated security groups, private Single-AZ PostgreSQL 16.14 RDS,
TLS/authenticated Valkey 8.2, three dedicated immutable ECR repositories,
ECS cluster, six seven-day CloudWatch log groups, private versioned S3 product
and document buckets, SNS Standard topic, raw SQS subscription, source queue
and DLQ. Workload IAM/OIDC, ALB, alarms and dashboard are deployed. The relay and
notification worker are stable at one task each. Bootstrap/migration/seed tasks
exited 0; RDS TLS, runtime schema restrictions, seed and Valkey commands passed
an ECS probe. Web/API are now stable and healthy behind the gated ALB.
Keycloak 26.7.4 is also stable, healthy and has imported the fresh ecommerce realm. No user-owned domain was found;
public HTTPS and browser/payment certification remain blocked.

```text
Browser -> HTTPS -> ALB + ACM (pending user-owned domain)
                         |-> shop hostname -> web (React/Nginx:8080)
                         |-> api hostname -> API (Express:3000)
                         `-> auth hostname -> /auth Keycloak:8080
API -> private RDS ecommerce_prod / private TLS Valkey
API -> private S3 products + order documents
Browser -> Razorpay Test Mode -> signed API webhook
Webhook transaction -> PAID + audit + deduplication + outbox
Outbox relay -> SNS -> SQS -> worker -> durable notification in RDS
                       `-> after five failed receives -> SQS DLQ
Keycloak -> private RDS keycloak_prod
ECS execution roles -> ECR / specific Secrets Manager secrets / CloudWatch
GitHub OIDC -> repository/branch-restricted deployment role
Terraform -> dedicated encrypted/versioned S3 state + S3 lockfile
```

The diagram is the target HTTPS architecture, not a claim that HTTPS is deployed.
CloudFront is optional (`enable_cloudfront=false`) and is not a dependency of ECS.
The current diagnostic HTTP listener requires an origin header and is not the
public storefront. A real domain enables regional ACM DNS validation, host-based
TLS 1.2/1.3 ALB routing, and HTTP-to-HTTPS redirect. No domain or certificate is
invented. Keycloak retains strict HTTPS identity, PKCE S256, and external SSL.
API discovery is deferred until a token is presented and fails closed; this lets
public catalog/health start independently of the final issuer hostname.
Keycloak readiness uses management port 9000, allowed only from ALB.

## Cost and network decision

Public-subnet Fargate with public IP egress avoids NAT Gateway hourly and traffic
charges. Alternative private ECS tasks plus NAT adds a continuously billed gateway
and data processing. Tasks accept inbound only from ALB on their individual port.
Relay, worker and migration security groups have no ingress. RDS and Valkey have
no internet route and accept only their authorized task security groups.
Public addresses provide task egress, not authorization for inbound requests.

Steady-state requested CPU is 2.25 vCPU; full 200% rolling overlap is 4.5 vCPU,
plus a 0.25-vCPU migration/bootstrap task, below the account's reported 8-vCPU quota.
Runtime database pools: API 5 + relay 5 + worker 5 + Keycloak 5 = 20; full overlap
40 plus migration 5, against max_connections 60. Administrative headroom remains.

RDS is db.t4g.micro, 20 GiB gp3, capped autoscaling 30 GiB, Single-AZ,
encrypted, seven-day backups, deletion protection enabled and final snapshot
required on authorized teardown. Valkey is one cache.t4g.micro node with TLS,
authentication and at-rest encryption; it has no automatic failover. Both are
portfolio development choices, not high-availability production certification.

## Contracts and security

SQL remains parameterized behind repository interfaces. The API never migrates
on startup. A migration RunTask uses the existing checksum/advisory-lock runner;
012 adds SNS failure diagnostics without modifying historical checksums.
One-time bootstrap creates separate runtime/migration/Keycloak roles and the
fresh Keycloak database. The safe seed adds only Classic Everyday Tote at INR 799.

RDS uses its actual hostname and the public AWS ap-south-1 CA bundle with
rejectUnauthorized=true. No TLS bypass is added. Valkey retains deliberately
fail-open cache/rate-limit behavior; authentication and database integrity remain
mandatory. An outage can remove cache acceleration and rate-limit enforcement.

Product signed PUT binds size/type and If-None-Match:*. Bucket policy requires a
conditional write. Validation checks metadata and a bounded header read. The
historical API field `generation` carries the opaque S3 VersionId on AWS; it never
uses ETag as a revision. Signed GET targets that exact version. Product assets
and PDFs are separate from Terraform state. PDFs remain private, create-only,
bounded to 2 MiB, owner-authorized and private/no-store.

SNS/SQS delivery is at-least-once. Event JSON and eventId/eventType/aggregateId
attributes remain stable. DeleteMessage follows durable processing/deduplication.
Poison/storage failures are not deleted. Source retention is seven days,
visibility 60 seconds, long polling 20 seconds, maxReceiveCount five; DLQ
retention is 14 days. Live poison retries, DLQ forwarding and repaired message-specific replay passed.
Actual worker crash injection and native queue-wide redrive remain unverified.

Workload task roles and execution roles are separate. Web/Keycloak/migration
runtime roles have no AWS API policy. API gets scoped product/document S3 access;
relay gets only topic Publish; worker gets only source SQS operations and document
S3 access. Execution roles resolve specific secrets, images and log streams.
Generated passwords are sensitive but exist in encrypted Terraform state;
state access is privileged and must never be granted to the application CI role.
RDS manages its master password in Secrets Manager. No secret values belong in Git.

Keycloak 26.7.4 uses strict HTTPS hostname, xforwarded proxy headers, PKCE S256,
exact redirects and origins, no implicit/direct grants, one 1-vCPU/2-GiB task and
pool min/initial 1, max 5. Registration and password recovery are enabled; actual
email delivery requires externally supplied SMTP credentials. No old users import.

Request IDs are validated or generated, returned in X-Request-ID and included in
API logs through async context. Stable event IDs correlate relay/worker logs.
Raw webhook bodies, authorization headers and secret values are not logged.

Migration 013 revokes runtime changes to schema_migrations. A deployed synthetic
fixture additionally verified the actual ECS relay task role publishing to SNS,
the SQS subscription, the actual ECS worker role consuming, and one durable RDS
notification after replay. Worker logs recorded processed and duplicate outcomes;
only the fixture outbox/notification rows were removed. This does not establish
a Razorpay payment, PAID transaction or browser checkout.

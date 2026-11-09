# OIDC resource-server authentication

## Boundaries

OAuth2 is an authorization framework. OIDC adds an identity/authentication layer.
JWT is a token format. JWKS publishes public signing keys and supports rotation.
Express is the Resource Server; Keycloak is the Authorization Server / Identity Provider.
The API has no password/login endpoint, symmetric JWT signing secret or per-request introspection.

AUTH_ENABLED defaults to true. OIDC_ISSUER and OIDC_AUDIENCE are validated centrally.
Production forbids disabling auth and requires an HTTPS issuer. Local loopback HTTP is
allowed outside production. AUTH_ENABLED=false is an explicit local/test opt-out; do not
use it for a deployed public API. Omitting the app access policy fails closed.

Startup retrieves OIDC discovery metadata, checks its issuer and same-origin JWKS URI,
and constructs a long-lived jose remote JWKS verifier. Each token must have an RS256
signature, configured issuer/audience, exp/iat/sub claims, valid time bounds, header typ
JWT and Keycloak access-token typ Bearer. ID tokens and unsigned/other-algorithm tokens
are rejected. Five seconds of clock tolerance accommodates small clock skew.

Public keys are cached for ten minutes. Unknown key IDs can trigger refresh, subject to
a 30-second cooldown; network requests have a five-second timeout. This supports key
rotation without downloading keys for every request. Discovery failure prevents startup;
verification/key-fetch failures return a safe 401 without library details. Cached keys
can validate unexpired tokens during a brief IdP outage. Offline validation does not
provide immediate token revocation; development access tokens last five minutes.

Only resource_access[ecommerce-api].roles is trusted for API authorization. Realm roles
and another client's roles do not confer API privileges. The principal contains subject,
optional username, roles and scopes, never the full JWT. Scopes are normalized metadata;
these endpoints authorize on roles. Duplicate/malformed Bearer headers are rejected.

## Endpoint permissions

| Endpoint                                                | Allowed client roles                            |
| ------------------------------------------------------- | ----------------------------------------------- |
| Product and Category GET/HEAD                           | catalog_reader, catalog_manager, admin          |
| Product create/update/delete/import and Category create | catalog_manager, admin                          |
| Order GET/HEAD                                          | order_reader, order_manager, admin              |
| Order POST and payment retry POST                       | order_manager, admin                            |
| /health and /ready                                      | Public                                          |
| POST /api/v1/webhooks/payments                          | Existing provider HMAC, never human Bearer auth |

Authentication runs before protected request parsing and module dispatch. Missing,
invalid or expired tokens return 401 with WWW-Authenticate. Verified identities without
an allowed role receive 403. Responses do not include tokens, signing keys or IdP errors.
The raw webhook route remains ahead of the global JSON parser and outside JWT middleware.
A valid Bearer token cannot substitute for the webhook HMAC.

## Keycloak infrastructure

infra/compose.yaml pins quay.io/keycloak/keycloak:26.7.4. It starts development mode,
imports infra/keycloak/ecommerce-realm.json, binds HTTP to 127.0.0.1:8180 and management
health to 127.0.0.1:9190, and persists its development database in keycloak_data.
Existing Mongo configuration is preserved with credentials moved to ignored infra/.env.
No existing Docker volumes, Mongo containers or Redis resources are recreated.

The ecommerce realm has a bearer-only ecommerce-api resource client and five client roles:
catalog_reader, catalog_manager, order_reader, order_manager, admin. No service account
is assigned admin by default. Three confidential CLI service clients use client credentials:

- ecommerce-cli-reader: catalog_reader and order_reader.
- ecommerce-cli-manager: catalog_manager and order_manager.
- ecommerce-cli-unprivileged: no API roles, for checking denied access.

The realm includes an access-token audience mapper and a client-role mapper. Client
secrets are environment placeholders resolved by Keycloak, never literal secrets in JSON.
Password grants and interactive login on these service clients are disabled. Client
credentials represent service identity, not a human user. Browser Authorization Code
with PKCE, user accounts and frontend login are separate work; the unchanged frontend
will receive 401 unless supplied an access token or run with an explicit local auth opt-out.

On a fresh setup copy infra/.env.example to infra/.env and replace every placeholder.
Use independent random values (for example secrets.token_urlsafe(32)) for the Keycloak
admin password and the three client secrets; retain the existing local Mongo values.
Restrict the file with chmod 600 infra/.env. Never print it or use shell tracing.
This checkpoint generated local values in that ignored file without editing apps/api/.env.

Import runs only when the realm is absent. Restart skips an existing realm, so changing
JSON does not silently overwrite live configuration. Apply subsequent realm changes
through reviewed administration; never delete the volume to force an update.

## Exact local commands

Run from the repository root in Ubuntu WSL. Do not enable set -x.

```bash
docker compose --env-file infra/.env -f infra/compose.yaml up -d --no-deps keycloak
curl --fail http://127.0.0.1:9190/health/ready
curl --fail http://127.0.0.1:8180/realms/ecommerce/.well-known/openid-configuration
```

Start the API in a separate terminal with its existing database/payment configuration:

```bash
export AUTH_ENABLED=true
export OIDC_ISSUER=http://127.0.0.1:8180/realms/ecommerce
export OIDC_AUDIENCE=ecommerce-api
cd apps/api
npm run dev
```

The payment provider and shared webhook secret are still required for Order creation;
see payment-integration.md. Product reads do not call the payment provider.

In the verification terminal, load the local CLI credentials without displaying them:

```bash
set -a
. infra/.env
set +a
export OIDC_ISSUER=http://127.0.0.1:8180/realms/ecommerce

token_for() {
  python3 - "$1" <<'PY'
import json, os, sys, urllib.parse, urllib.request
name = sys.argv[1]
body = urllib.parse.urlencode({
    "grant_type": "client_credentials",
    "client_id": "ecommerce-cli-" + name,
    "client_secret": os.environ["ECOMMERCE_" + name.upper() + "_CLIENT_SECRET"],
}).encode()
request = urllib.request.Request(os.environ["OIDC_ISSUER"] + "/protocol/openid-connect/token", data=body)
with urllib.request.urlopen(request, timeout=5) as response:
    print(json.load(response)["access_token"])
PY
}
READER_TOKEN=$(token_for reader)
MANAGER_TOKEN=$(token_for manager)
UNPRIVILEGED_TOKEN=$(token_for unprivileged)

# 401: no token
curl -i http://127.0.0.1:3000/api/v1/products
# 401: malformed token
curl -i -H 'Authorization: Bearer invalid' http://127.0.0.1:3000/api/v1/products
# 403: signed token without an API role
printf 'header = "Authorization: Bearer %s"\n' "$UNPRIVILEGED_TOKEN" | curl --config - -i http://127.0.0.1:3000/api/v1/products
# 200: authorized reader
printf 'header = "Authorization: Bearer %s"\n' "$READER_TOKEN" | curl --config - -i http://127.0.0.1:3000/api/v1/products
# 403: reader cannot mutate
printf 'header = "Authorization: Bearer %s"\n' "$READER_TOKEN" | curl --config - -i -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3000/api/v1/products
# 400 body validation (authorization succeeded); no data is created
printf 'header = "Authorization: Bearer %s"\n' "$MANAGER_TOKEN" | curl --config - -i -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3000/api/v1/products
# 401: webhook still needs HMAC, even when a Bearer token is valid
printf 'header = "Authorization: Bearer %s"\n' "$MANAGER_TOKEN" | curl --config - -i -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3000/api/v1/webhooks/payments
unset READER_TOKEN MANAGER_TOKEN UNPRIVILEGED_TOKEN
```

Use the existing provider /payments/<paymentId>/succeed trigger to send a correctly
signed callback. The provider requires no OAuth token and continues using HMAC.
Never paste tokens into issue reports or commit shell output containing credentials.

## Verification and security limits

The real Keycloak integration test obtains client-credentials tokens, starts the actual
API with AUTH*ENABLED=true, and checks missing/invalid=401, unprivileged=403, reader=200,
manager Product/Order creation=201 and HMAC-only provider callback=200. It uses
ecommerce_test and removes only its own database records. Enable with OIDC_TEST_ISSUER
and the three ECOMMERCE*\*\_CLIENT_SECRET environment variables. Mongo/payment regressions
use MONGODB_TEST_URI privately. Local JWKS tests verify expiry, issuer/audience,
signature rejection, role boundaries, caching and a rotated key; live realm signing
keys were not changed during verification.

This reduces broken authentication and broken function-level authorization risks.
It does NOT establish complete OWASP compliance, object ownership/tenant authorization,
rate limits, abuse prevention, browser CSRF/XSS protection or immediate revocation.
Order reader/manager roles currently grant broad staff/service access; customerId is
not bound to the token subject. Do not expose this as a customer-isolated API without
object-level policy. Protect TLS and secrets, restrict service-account grants and use
production Keycloak database/availability hardening before external deployment.
The local start-dev/H2 setup is not a production IdP deployment.

References: [Keycloak container configuration](https://www.keycloak.org/server/containers),
[realm import semantics](https://www.keycloak.org/server/importExport),
[jose remote JWKS](https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md).

## Production SPA redirect reconciliation (2026-10-20)

The `ecommerce-web` client policy is recorded in `infra/keycloak/ecommerce-realm.json`.
Cloud Keycloak stores its live realm/client configuration in its existing database;
Terraform manages the service, not the realm. Startup realm import skips an existing
realm and does not apply updates to it. Normal image redeployments retain the database
configuration. Reconcile client-policy changes through the Keycloak Admin API/Console;
do not delete/reimport the realm or reset users to apply this policy.

The source allow-list includes the deployed storefront origin and the intentionally
supported local Vite origin. In realm `ecommerce`, client `ecommerce-web`:

- Login settings: copy `redirectUris` and `webOrigins` from the source client.
- Valid post logout redirect URIs: use only the exact homepage for each allowed origin,
  as listed in `attributes.post.logout.redirect.uris` (Admin API separator: `##`).
- Client authentication OFF; standard flow ON; implicit/direct-access/service-account
  flows OFF; PKCE S256. Self-registration remains enabled at realm level.
- The public cloud frontend origin is a client allow-list value, not an application
  secret. New frontend domains require explicit allow-list review, never wildcard origins.

React login/register/logout use the Keycloak adapter. Registration returns to `/account`
(or the existing safe return path); logout returns to the current origin homepage and
uses the adapter POST method so its ID-token hint is sent in the form body. Passwords
remain with Keycloak; no secret belongs in the SPA. The frontend Keycloak base URL and
bounded cookie-check timeout are supplied at Vite image-build time. Public browsing
survives provider initialization failure; account/protected routes fail closed.

These production/ownership notes supersede the older broad-access limitations above:
current customer Orders are owner-scoped by verified subject. Production SMTP delivery
and password-reset email remain separately unverified until SMTP is provisioned.

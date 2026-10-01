# REST API contract

OpenAPI 3.1 is served at `/openapi.json`; local Swagger UI assets at `/docs/`.
`DOCS_ENABLED` defaults to true outside production and false in production.
Explicitly enable it only where documentation exposure is appropriate. Tokens entered
in Swagger UI are not persisted. No credentials are included in the specification.

Input bodies are generated from the same Zod schemas used by runtime validation.
Product responses reuse the runtime cache validator; Order/Category response schemas
are checked against their TypeScript domain types. Router-inventory and OpenAPI parser
tests guard missing paths. Service normalization and business constraints are described
on operations; generated schemas do not replace service checks.

Catalog and Order routes require OIDC-verified Bearer access tokens and their documented
reader/manager roles or admin. Payment callbacks require HMAC over exact raw bytes,
not user JWTs. Health/readiness remain public. Documentation includes the existing CSV
stream import and payment-retry endpoints; no new business endpoints are introduced.

References: [Zod JSON Schema](https://zod.dev/json-schema),
[Swagger UI](https://swagger.io/docs/open-source-tools/swagger-ui/usage/installation/).

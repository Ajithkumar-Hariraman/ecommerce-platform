# Container runtime

From the repository root, populate ignored `infra/.env` using the placeholders in
`infra/.env.example`. Use unique passwords and at least 32 random characters for the
webhook secret. URL-encode Mongo credentials in COMPOSE_MONGODB_URI.

```sh
docker compose -f infra/compose.yaml config --quiet
docker compose -f infra/compose.yaml build
docker compose -f infra/compose.yaml up -d
docker compose -f infra/compose.yaml ps
```

Never use `--remove-orphans` or remove persistent volumes to apply configuration.
Existing Mongo, Keycloak, Redis and Kafka volumes are preserved. A separate PostgreSQL
volume listens on host 5433; it does not replace the host PostgreSQL database.
Initialization creates a non-superuser application role and separate dev/test databases.
Credentials changed later in an env file do not rotate already-created database users.

| Component  | Host endpoint   | Internal endpoint     |
| ---------- | --------------- | --------------------- |
| API        | 127.0.0.1:3001  | api:3000              |
| Web        | 127.0.0.1:8088  | web:8080              |
| PostgreSQL | 127.0.0.1:5433  | postgres:5432         |
| Mongo      | 127.0.0.1:27018 | mongodb:27017         |
| Redis      | 127.0.0.1:6381  | redis-cache:6379      |
| Kafka      | 127.0.0.1:9093  | kafka:19092           |
| Keycloak   | 127.0.0.1:8180  | keycloak:8080         |
| Provider   | 127.0.0.1:4101  | payment-provider:4100 |

The API image uses a Node 24 build stage and production-only dependencies in a non-root
runtime. The same image runs the outbox relay, event worker, migration and topic setup.
The web image builds Vite then serves static files and proxies /api through unprivileged
Nginx. The provider runs as non-root and persists its idempotency database in its own volume.
Health checks gate startup; migrations and topic setup must complete successfully.
Workers stop through their existing signal/resource lifecycle. No build-time secrets.

Compose is a **local development topology**, including development-mode Keycloak.
OIDC_ALLOW_HTTP is explicitly enabled for internal DNS in this topology; production
rejects that option and still requires an HTTPS issuer. JWT signatures, issuer/audience,
expiry and RBAC checks are unchanged. Tokens issued through the host issuer do not match
the internal issuer: obtain container tokens through keycloak:8080, as the smoke script does.
The existing React UI has no login flow; authenticated verification uses HTTP clients.
Do not publish this development IdP as production authentication.

## Reproducible verification

```sh
COMPOSE_DB_NAME=ecommerce_test docker compose -f infra/compose.yaml up -d
python3 scripts/verify-compose.py
```

The smoke refuses any database other than ecommerce_test and expects PostgreSQL Order
storage. It temporarily stops the relay to observe PENDING, starts it, observes PUBLISHED
and one notification, checks HMAC duplicate behavior, and removes only owned rows/keys
and its provider payment. Redis rate counters expire normally; Kafka records use normal
broker retention. Do not run it against a runtime serving development traffic.
The full host integration suite separately covers Mongo Order mode, retries/DLQ, rate
limiting and outages. It uses host PostgreSQL, not the Compose PostgreSQL port.

At this checkpoint all container services started; real token, API/docs, web proxy,
PostgreSQL/Mongo ping, Redis cache/invalidation, provider HMAC, outbox and Kafka consumer
checks passed. Verification used the Compose ecommerce_test database.

[Compose dependency conditions](https://docs.docker.com/compose/how-tos/startup-order/).

Nginx uses Docker DNS resolution at request time so API container recreation does not
leave the web proxy pointing to an obsolete container IP. CI restart verification covers this path.

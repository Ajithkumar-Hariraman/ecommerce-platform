# Redis cache and distributed rate limiting

PostgreSQL is the Product source of truth. Redis holds derived temporary cache
and coordination state, never authoritative Product persistence.

## Product flow

- Cache hit: Redis -> response.
- Cache miss: Redis miss -> PostgreSQL -> Redis -> response.
- Mutation: PostgreSQL -> Redis DEL, after successful update/delete.

Only Product ID reads use ProductCache through ProductService. Updates read
PostgreSQL directly before merging fields. Create/list/pagination/status/CSV and
Category listings do not cache results. RedisProductCache owns UUID-normalized
`product:v1:<id>` keys, strict JSON/domain validation and atomic SET EX. Missing
Products are not cached. Invalid entries are ignored/deleted and rebuilt.

## Configuration and lifecycle

Start the dedicated service only:

```sh
docker compose --env-file infra/.env -f infra/compose.yaml up -d --no-deps redis-cache
docker exec ecommerce-redis redis-cli PING
```

Redis 8.2.9 Alpine maps loopback 6381 to container 6379 with AOF and a named volume.
The old Redis on 6379 remains separate. A future Node container would use
redis-cache:6379; Node running in WSL uses redis://127.0.0.1:6381.

| Setting | Default | Bounds |
| --- | --- | --- |
| REDIS_URL | redis://127.0.0.1:6381 | redis/rediss URL |
| PRODUCT_CACHE_TTL_SECONDS | 60 | 1..86400 |
| RATE_LIMIT_WINDOW_SECONDS | 60 | 1..3600 |
| RATE_LIMIT_MAX_REQUESTS | 100 | 1..1000000 |

Central env validation supplies server.ts, which creates one shared Node Redis
client. Startup connect/PING is bounded to 1500 ms; failure permits startup while
reconnection continues. Offline queuing is disabled. A 500 ms wall-clock command
deadline also covers in-flight replies; timeout resets/reconnects the client.
No application write retries occur. HTTP drains before bounded Redis close.

Redis is optional: /health remains liveness; /ready checks required PostgreSQL
and selected Mongo only. Redis loss is logged as degraded operation without
changing endpoint response shapes.

## Distributed rate policy

JWT verification -> verified principal -> Redis limiter -> RBAC -> controller.
All protected Product/Category/Order routes share a principal's allowance. The
key is `rate:v1:<sha256-of-verified-subject>:api`, for the configured single issuer.
Client identity headers and unverified JWT claims are never used. Atomic Lua EVAL
performs INCR and expiry/TTL. Each fixed window starts at the first request;
Redis owns expiry, so API-instance clocks are irrelevant. Excess requests receive
safe HTTP 429 and Retry-After seconds. Denied requests count without extending the
window. Fixed-window boundaries may allow bursts; this is not a sliding window.

Health/readiness and HMAC payment webhooks bypass this limiter. Explicitly
disabled non-production auth also bypasses it because no verified principal
exists. Production cannot disable auth. Invalid tokens still receive 401 before
Redis; authenticated requests still undergo RBAC.

## Failure boundaries

Cache GET/SET/DEL and rate-limit errors FAIL OPEN with safe operational messages.
GET falls back to PostgreSQL, failed SET retains the database result, and failed
DEL never rolls back committed mutations. Limiter outages admit authenticated
requests but do not bypass RBAC. High-risk systems may choose fail-closed.
Redis URLs, keys, credentials and raw errors are not exposed in client responses.

Database and Redis do not share an ACID transaction. Crash after DB commit,
failed invalidation, or a concurrent old read refilling after DEL can leave stale
data until expiry. TTL bounds residency after each write, not strong consistency.
Do not use cache data for authoritative stock/payment decisions. Concurrent misses
can cause a cache stampede; no stampede lock is implemented. Cluster/Sentinel,
Streams, distributed locks and background reconciliation remain outside scope.

## Verification isolation

Fast tests: test/redis.test.ts. Real adapters/HTTP: test/integration/redis.test.ts.
Automated tests use dedicated Redis 6381 and ecommerce_test, unique test:<uuid>:
namespaces, and cleanup only owned keys/records. NODE_ENV=test server processes
also create a unique prefix and remove it at graceful shutdown; outage leftovers
expire by TTL. Never FLUSHALL or FLUSHDB. Runtime always uses Redis adapters.

Real HTTP tests use private Keycloak credentials supplied through environment
and OIDC_TEST_ISSUER. A temporary limit of three verifies 200/200/200/429 and
independent principals without changing normal defaults. Tests cover TTL expiry,
corruption, invalidation, actual socket failure/recovery and readiness.

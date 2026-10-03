# Host API and workers

The host runtime reads `apps/api/.env` through the existing validated config layer. Shell overrides take precedence: use the same environment for all three terminals. No secrets belong in commands or tracked files.

The current host selects MongoDB `ecommerce_dev` at `127.0.0.1:27018` for Orders and their embedded outbox. The consumer intentionally persists notifications in PostgreSQL `ecommerce_dev` at `127.0.0.1:5432`, using the same DB configuration as the host API. It does not need a Mongo notification implementation.

Stop the alternate Compose workers before starting host workers (leave databases, broker and API untouched):

```sh
cd /home/ak_soft_2017/projects/ecommerce-platform
docker compose -f infra/compose.yaml stop outbox-relay order-event-worker
```

Use Node 24. In each terminal start from `/home/ak_soft_2017/projects/ecommerce-platform/apps/api`:

```sh
# Terminal 1 — reuse the existing API if already running
npm run dev
# Terminal 2
npm run worker:outbox:dev
# Terminal 3
npm run worker:orders:dev
```

These source entrypoints need no build and load the same central configuration as `npm run dev`. Existing compiled worker scripts remain available for deployment. Run one relay and one consumer for this local flow. Do not run `docker compose up` for the worker services simultaneously, or start a second copy of the host commands. Ctrl+C stops a foreground worker gracefully.

Kafka defaults use port 9093, topics `order-events`, `order-events-retry`, `order-events-dlq`, and group `order-notification-worker`. Consumers sharing this group must use the same intended notification database. The prior Compose workers used their separate PostgreSQL `ecommerce_test` database and must remain stopped while this host flow is active.

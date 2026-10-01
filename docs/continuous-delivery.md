# Continuous integration and delivery

`.github/workflows/ci.yml` runs on every pull request and pushes to main, feat/** and
release/**. Fast checks use Node from .nvmrc, npm ci, backend typecheck/tests/build and
frontend typecheck/build. The separate integration job builds all images and runs real
PostgreSQL, MongoDB, Redis, Kafka and Keycloak with freshly generated disposable secrets.
It runs the complete unfiltered integration suite and the full Compose HTTP/event smoke.
No infrastructure tests are silently omitted; failures block the job.

CI credentials are generated on the ephemeral runner, never stored in source or printed.
The setup script refuses to overwrite existing local infra/.env. Do not run it over a
working local environment. The integration runner uses ecommerce_test on Compose port
5433. Do not run it concurrently with the application relay against that same test DB.

Workflow permissions are read-only; checkout credentials are not persisted. Pull requests
receive no deployment credentials. CI currently does not publish images or deploy.
After review, promote a verified commit/image digest through an explicitly authorized
release using the GCP deployment configuration. Use Workload Identity Federation and
protected GitHub environments for future cloud automation; no service-account JSON.

Local workflow commands and syntax are verified. A remote GitHub run remains unverified:
this repository currently has no remote and no push or workflow dispatch was performed.

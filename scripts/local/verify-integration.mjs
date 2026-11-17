// Docker-local only; credentials remain in process memory. No cloud opt-ins.
import { loadEnvFile } from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
loadEnvFile(new URL("../../infra/.env", import.meta.url));
const uri = new URL(process.env.COMPOSE_MONGODB_URI);
uri.hostname = "127.0.0.1";
uri.port = "27018";
const child = spawn(process.execPath, ["scripts/run-aws-regressions.mjs"], {
  cwd: fileURLToPath(new URL("../../apps/api/", import.meta.url)),
  stdio: "inherit",
  env: {
    ...process.env,
    DB_HOST: "127.0.0.1",
    DB_PORT: "5433",
    DB_USER: "ecommerce_app",
    DB_NAME: "ecommerce_dev",
    DB_TEST_NAME: "ecommerce_test",
    NODE_ENV: "test",
    DB_TLS: "false",
    SMTP_ENABLED: "false",
    SMTP_HOST: "127.0.0.1",
    MONGODB_TEST_URI: uri.href,
    REDIS_URL: "redis://127.0.0.1:6381",
    OIDC_TEST_ISSUER: "http://127.0.0.1:8180/realms/ecommerce",
    OIDC_ALLOW_HTTP: "true",
    AWS_STORAGE_INTEGRATION: "false",
    AWS_EVENTS_INTEGRATION: "false",
    AWS_DLQ_INTEGRATION: "false",
  },
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

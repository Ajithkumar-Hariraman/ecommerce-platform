// Reuse local service credentials privately; only ecommerce_test is selected by the test harness.
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
try { loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url))); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const mongo = process.env.MONGODB_TEST_URI ?? process.env.MONGODB_URI;
if (!mongo) throw new Error("Local Mongo service URI required for retained multi-adapter regression tests");
const child = spawn("npm", ["run", "test:integration"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: { ...process.env, MONGODB_TEST_URI: mongo, BUSINESS_STORAGE: "postgres", GCS_RUN_INTEGRATION: "false", GCS_POST_PURCHASE_INTEGRATION: "false", PUBSUB_RUN_INTEGRATION: "false" },
  stdio: "inherit",
});
child.on("exit", code => { process.exitCode = code ?? 1; });

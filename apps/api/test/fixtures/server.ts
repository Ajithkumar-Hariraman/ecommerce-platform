import { loadEnv } from "../../src/config/env.js";
import { startServer } from "../../src/lifecycle.js";
import { createTestApp } from "../helpers/app.js";
async function main() {
  await startServer(createTestApp(), loadEnv(), async () => {});
}
main().catch(error => {
  console.error("API startup failed", error);
  process.exitCode = 1;
});

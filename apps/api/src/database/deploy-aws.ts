// Migration is an explicit ECS RunTask, never an API startup side effect.
import { spawn } from "node:child_process";
for (const file of ["migrate.js", "seed-aws.js"]) {
  const exit = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, [new URL(file, import.meta.url).pathname], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (exit !== 0) {
    process.exitCode = 1;
    break;
  }
}

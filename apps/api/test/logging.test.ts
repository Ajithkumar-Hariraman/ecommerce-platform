import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
test("runtime logging emits parseable JSON severity, message and structured fields", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {installStructuredLogging} from './dist/logging.js';installStructuredLogging();console.info('Ready',{operation:'startup'});`,
    ],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(output);
  assert.equal(parsed.severity, "INFO");
  assert.equal(parsed.message, "Ready");
  assert.deepEqual(parsed.details, [{ operation: "startup" }]);
});

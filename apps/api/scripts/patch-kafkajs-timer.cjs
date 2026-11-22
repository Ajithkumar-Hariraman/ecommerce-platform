// KafkaJS 2.2.4 can schedule its -1 (no throttle) sentinel minus Date.now().
// Keep future throttle and pending-queue delays; normalize only the final timer.
const fs = require("node:fs");
const path = require("node:path");
const packageFile = require.resolve("kafkajs/package.json");
const version = JSON.parse(fs.readFileSync(packageFile, "utf8")).version;
if (version !== "2.2.4") throw new Error("Review the KafkaJS timer patch before changing dependency version");
// Use monotonic elapsed time for request expiry while preserving epoch timestamps
// in KafkaJS instrumentation and error metadata.
const directory = path.join(path.dirname(packageFile), "src/network/requestQueue");
function patch(filename, replacements) {
  const file = path.join(directory, filename);
  const original = fs.readFileSync(file, "utf8");
  let source = original;
  for (const [before, after] of replacements) {
    if (source.includes(after)) continue;
    if (source.split(before).length !== 2) {
      throw new Error(`Unexpected KafkaJS timer source in ${filename}`);
    }
    source = source.replace(before, after);
  }
  if (source !== original) fs.writeFileSync(file, source);
}

patch("socketRequest.js", [
  ["const events = require('../instrumentationEvents')",
    "const events = require('../instrumentationEvents')\nconst { performance } = require('node:perf_hooks')"],
  ["    this.sentAt = Date.now()",
    "    this.sentAt = Date.now()\n    this.sentAtMonotonic = performance.now()"],
]);
patch("index.js", [
  ["const SocketRequest = require('./socketRequest')",
    "const SocketRequest = require('./socketRequest')\nconst { performance } = require('node:perf_hooks')"],
  ["Date.now() - request.sentAt > request.requestTimeout",
    "performance.now() - request.sentAtMonotonic > request.requestTimeout"],
  ["      }, scheduleAt)", "      }, Math.max(1, scheduleAt))"],
]);
console.info("KafkaJS timer patches verified");

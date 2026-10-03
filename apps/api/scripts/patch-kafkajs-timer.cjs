// KafkaJS 2.2.4 can schedule its -1 (no throttle) sentinel minus Date.now().
// Keep future throttle and pending-queue delays; normalize only the final timer.
const fs = require("node:fs");
const path = require("node:path");
const packageFile = require.resolve("kafkajs/package.json");
const version = JSON.parse(fs.readFileSync(packageFile, "utf8")).version;
if (version !== "2.2.4") throw new Error("Review the KafkaJS timer patch before changing dependency version");
const file = path.join(path.dirname(packageFile), "src/network/requestQueue/index.js");
const before = "      }, scheduleAt)";
const after = "      }, Math.max(1, scheduleAt))";
const source = fs.readFileSync(file, "utf8");
if (source.includes(after) && !source.includes(before)) {
  console.info("KafkaJS timer patch already applied");
} else {
  if (source.split(before).length !== 2) throw new Error("Unexpected KafkaJS timer source; patch not applied");
  fs.writeFileSync(file, source.replace(before, after));
  console.info("Applied KafkaJS non-negative timer patch");
}

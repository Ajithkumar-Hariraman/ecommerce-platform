import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const RequestQueue = require("kafkajs/src/network/requestQueue");

for (const [name, deadline, pending, expected] of [
  ["unthrottled sentinel executes promptly", -1, false, 1],
  ["past deadline executes promptly", 1791019000000 - 500, false, 1],
  ["current deadline executes promptly", 1791019000000, false, 1],
  ["future throttle retains millisecond deadline", 1791019000000 + 5000, false, 5000],
  ["pending requests retain 10ms polling", -1, true, 10],
  ["throttled pending requests retain deadline", 1791019000000 + 5000, true, 5000],
] as const) {
  test(`KafkaJS timer: ${name}`, (t) => {
    t.mock.method(Date, "now", () => 1791019000000);
    const scheduled: { callback: () => void; delay: number }[] = [];
    t.mock.method(globalThis, "setTimeout", (callback: () => void, delay: number) => {
      assert.ok(Number.isFinite(delay) && delay >= 1, "never pass negative delay to Node");
      scheduled.push({ callback, delay });
      return {} as NodeJS.Timeout;
    });
    const queue = new RequestQueue({ logger: { debug: () => {} } });
    queue.throttledUntil = deadline;
    if (pending) queue.pending.push({});
    let checks = 0;
    queue.checkPendingRequests = () => {
      checks++;
    };
    queue.scheduleCheckPendingRequests();
    queue.scheduleCheckPendingRequests();
    assert.equal(scheduled.length, 1, "an existing timer is not duplicated");
    assert.equal(scheduled[0]!.delay, expected);
    scheduled[0]!.callback();
    assert.equal(checks, 1);
    assert.equal(queue.throttleCheckTimeoutId, null);
  });
}

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

test("KafkaJS request expiry follows elapsed time across wall-clock changes", (t) => {
  const SocketRequest = require("kafkajs/src/network/requestQueue/socketRequest");
  let wall = 1791019000000;
  t.mock.method(Date, "now", () => wall);
  let tick!: () => void;
  t.mock.method(globalThis, "setInterval", (callback: () => void) => {
    tick = callback;
    return {} as NodeJS.Timeout;
  });
  const queue = new RequestQueue({ enforceRequestTimeout: true, requestTimeout: 1000 });
  let expired = false;
  const request = new SocketRequest({
    requestTimeout: 1000,
    entry: { reject: () => {} },
    send: () => {},
    timeout: () => { expired = true; },
  });
  request.send();
  queue.inflight.set(1, request);
  queue.scheduleRequestTimeoutCheck();

  wall += 60_000;
  tick();
  assert.equal(expired, false, "a wall-clock jump cannot expire a new request");
  wall -= 120_000;
  request.sentAtMonotonic -= 1001;
  tick();
  assert.equal(expired, true, "a wall-clock rewind cannot prevent expiry");
});

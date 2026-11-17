import { sessionReturnPath } from "../src/auth/access";
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { SimulatorActions } from "../src/features/checkout/SimulatorActions";
const view = (status: Parameters<typeof SimulatorActions>[0]["status"], busy = false) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <SimulatorActions status={status} busy={busy} onOutcome={() => {}} />
    </MemoryRouter>,
  );
test("pending local checkout offers explicit simulated outcomes without Razorpay", () => {
  const html = view("PAYMENT_PENDING");
  assert.match(html, /Simulate successful payment/);
  assert.match(html, /Simulate failed payment/);
  assert.match(html, /No money is charged/);
  assert.doesNotMatch(html, /Razorpay|checkout\.razorpay/);
  assert.equal((view("PAYMENT_PENDING", true).match(/disabled=""/g) ?? []).length, 2);
});
test("failed simulator payment is terminal and paid orders cannot be simulated again", () => {
  const failed = view("PAYMENT_FAILED");
  assert.match(failed, /Your order is saved in My Orders/);
  assert.doesNotMatch(failed, /<button|Continue payment/);
  assert.match(failed, /Return to cart/);
  assert.equal(view("PAID"), "");
  assert.equal(view("CREATED"), "");
});

test("checkout resume query survives session restoration; OAuth callback data is omitted", () => {
  const id = "12345678-1234-4234-8234-123456789abc";
  assert.equal(sessionReturnPath("/checkout", "?order=" + id), "/checkout?order=" + id);
  assert.equal(
    sessionReturnPath(
      "/checkout",
      "?order=" + id + "&code=private&state=private&session_state=private&iss=private",
    ),
    "/checkout?order=" + id,
  );
  assert.equal(sessionReturnPath("//untrusted.example", "?order=" + id), "/");
});

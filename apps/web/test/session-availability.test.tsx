import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionNotice, initializationFailureCategory, initializationTimeout } from "../src/auth/SessionNotice";
const error = "Sign-in is temporarily unavailable. Reload to try again.";
test("public storefront and cart remain free of account-provider alerts during an outage", () => {
  for (const pathname of ["/", "/products", "/products/123", "/cart"])
    assert.equal(renderToStaticMarkup(<SessionNotice pathname={pathname} error={error} />), "");
});
test("account and protected routes explicitly report unavailable authentication", () => {
  for (const pathname of ["/login", "/register", "/account", "/checkout", "/orders/123", "/notifications", "/admin/products"])
    assert.match(renderToStaticMarkup(<SessionNotice pathname={pathname} error={error} />), /role="alert"/);
  assert.equal(renderToStaticMarkup(<SessionNotice pathname="/login" error="" />), "");
});
test("initialization diagnostics classify failures without exposing untrusted details", () => {
  assert.equal(initializationFailureCategory(new Error("Timeout when waiting for 3rd party check iframe message.")), "provider-timeout");
  assert.equal(initializationFailureCategory({ error: "Timeout waiting" }), "provider-timeout");
  assert.equal(initializationFailureCategory(new TypeError("Failed to fetch")), "provider-network");
  assert.equal(initializationFailureCategory(new Error("secret-token provider-payload")), "provider-initialization");
});

test("cookie-check timeout accommodates observed cold starts and rejects unsafe configuration", () => {
  assert.equal(initializationTimeout(undefined), 60000);
  assert.equal(initializationTimeout("45000"), 45000);
  for (const raw of ["0", "-1", "1.5", "999", "120001", "Infinity", "", "60000ms"])
    assert.throws(() => initializationTimeout(raw));
});

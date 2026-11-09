import test from "node:test";
import assert from "node:assert/strict";
import { createDeferredOidcVerifier } from "../src/auth/oidc.js";
const config = { enabled: true as const, issuer: "https://auth.example.test/realms/ecommerce", audience: "ecommerce-api" };
test("deferred OIDC shares discovery and still rejects invalid tokens", async () => {
  let calls = 0;
  const verify = createDeferredOidcVerifier(config, async () => {
    calls++;
    return async (token) => {
      if (token !== "valid") throw new Error("invalid token");
      return { subject: "owned-test-user", roles: [], scopes: [] };
    };
  });
  assert.equal(calls, 0);
  const results = await Promise.allSettled([verify("valid"), verify("invalid")]);
  assert.equal(calls, 1);
  assert.equal(results[0]?.status, "fulfilled");
  assert.equal(results[1]?.status, "rejected");
});
test("unavailable discovery fails closed with bounded retry pressure", async () => {
  let calls = 0;
  const verify = createDeferredOidcVerifier(config, async () => {
    calls++;
    throw new Error("unavailable");
  });
  await assert.rejects(verify("anything"));
  await assert.rejects(verify("anything"));
  assert.equal(calls, 1);
});

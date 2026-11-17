import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const realm = JSON.parse(
  readFileSync(new URL("../../../infra/keycloak/ecommerce-realm.json", import.meta.url), "utf8"),
);
const client = realm.clients.find(
  (entry: { clientId: string }) => entry.clientId === "ecommerce-web",
);
test("SPA uses public Authorization Code flow with enforced S256 and registration enabled", () => {
  assert.equal(realm.registrationAllowed, true);
  assert.equal(client.protocol, "openid-connect");
  assert.equal(client.publicClient, true);
  assert.equal(client.standardFlowEnabled, true);
  assert.equal(client.implicitFlowEnabled, false);
  assert.equal(client.directAccessGrantsEnabled, false);
  assert.equal(client.serviceAccountsEnabled, false);
  assert.equal(client.attributes["pkce.code.challenge.method"], "S256");
});
test("production and intentional local SPA origins each have an exact logout homepage", () => {
  assert.deepEqual(client.webOrigins, [
    "https://ecommerce-web-eoiwssibea-el.a.run.app",
    "http://127.0.0.1:5173",
    "http://localhost:8088",
  ]);
  const logout = client.attributes["post.logout.redirect.uris"].split("##");
  assert.equal(logout.length, client.webOrigins.length);
  for (const origin of client.webOrigins) {
    const parsed = new URL(origin);
    assert.equal(parsed.origin, origin);
    assert.ok(parsed.protocol === "https:" || ["127.0.0.1", "localhost"].includes(parsed.hostname));
    assert.ok(client.redirectUris.includes(origin + "/*"));
    assert.ok(logout.includes(origin + "/"));
  }
  for (const uri of logout) assert.ok(!uri.includes("*") && uri === new URL(uri).origin + "/");
  assert.ok(!client.webOrigins.includes("*") && !client.redirectUris.includes("*"));
});

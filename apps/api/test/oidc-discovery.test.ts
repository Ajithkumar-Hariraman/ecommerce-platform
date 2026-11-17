import test from "node:test";
import assert from "node:assert/strict";
import { createDeferredOidcVerifier } from "../src/auth/oidc.js";
const config = {
  enabled: true as const,
  issuer: "https://auth.example.test/realms/ecommerce",
  audience: "ecommerce-api",
};
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

test("internal transport preserves public issuer and strict JWT verification", async () => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { createOidcVerifier } = await import("../src/auth/oidc.js");
  const key = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  const issuer = "http://127.0.0.1:8180/realms/ecommerce";
  const certs = issuer + "/protocol/openid-connect/certs";
  let metadata = { issuer, jwks_uri: certs };
  const paths: string[] = [];
  const jwk = { ...(await exportJWK(key.publicKey)), kid: "test", alg: "RS256" };
  const server = createServer((req, res) => {
    paths.push(req.url!);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/realms/ecommerce/.well-known/openid-configuration")
      res.end(JSON.stringify(metadata));
    else if (req.url === "/realms/ecommerce/protocol/openid-connect/certs")
      res.end(JSON.stringify({ keys: [jwk] }));
    else {
      res.statusCode = 404;
      res.end();
    }
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const internal = `http://127.0.0.1:${address.port}`;
  const settings = { ...config, issuer, backchannelUrl: internal };
  const token = (claims = {}, signing = key.privateKey) =>
    new SignJWT({
      sub: "customer",
      iss: issuer,
      aud: config.audience,
      typ: "Bearer",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      resource_access: { [config.audience]: { roles: ["catalog_reader"] } },
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "test" })
      .sign(signing);
  try {
    const verify = await createOidcVerifier(settings);
    assert.deepEqual((await verify(await token())).roles, ["catalog_reader"]);
    for (const claims of [
      { iss: internal + "/realms/ecommerce" },
      { iss: "https://wrong.example" },
      { aud: "wrong" },
      { exp: 1 },
      { resource_access: { [config.audience]: { roles: "admin" } } },
    ])
      await assert.rejects(verify(await token(claims)));
    await assert.rejects(verify(await token({}, other.privateKey)));
    assert.deepEqual(paths, [
      "/realms/ecommerce/.well-known/openid-configuration",
      "/realms/ecommerce/protocol/openid-connect/certs",
    ]);
    metadata = { issuer: internal + "/realms/ecommerce", jwks_uri: certs };
    await assert.rejects(createOidcVerifier(settings));
    for (const uri of [
      internal + "/certs",
      "https://evil.example/certs",
      "http://user@127.0.0.1:8180/certs",
      certs + "#x",
      certs + "?x=1",
    ]) {
      metadata = { issuer, jwks_uri: uri };
      await assert.rejects(createOidcVerifier(settings));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("backchannel config validates origins and preserves default cloud transport", async () => {
  const { loadAuthConfig, loadEnv } = await import("../src/config/env.js");
  loadEnv();
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      NODE_ENV: "production",
      AUTH_ENABLED: "true",
      OIDC_ALLOW_HTTP: "false",
      OIDC_ISSUER: config.issuer,
      OIDC_AUDIENCE: config.audience,
    });
    delete process.env.OIDC_BACKCHANNEL_URL;
    assert.equal(loadAuthConfig().enabled, true);
    process.env.OIDC_BACKCHANNEL_URL = "https://internal.example";
    assert.equal(loadAuthConfig().enabled, true);
    for (const value of [
      "http://keycloak:8080",
      "https://user:pass@internal.example",
      "https://internal.example/path",
      "https://internal.example?x=1",
      "https://internal.example#x",
      "",
    ]) {
      process.env.OIDC_BACKCHANNEL_URL = value;
      assert.throws(loadAuthConfig, /OIDC_BACKCHANNEL_URL/);
    }
    Object.assign(process.env, {
      NODE_ENV: "development",
      OIDC_ALLOW_HTTP: "true",
      OIDC_BACKCHANNEL_URL: "http://keycloak:8080",
    });
    const loaded = loadAuthConfig();
    assert(loaded.enabled);
    assert.equal(loaded.backchannelUrl, "http://keycloak:8080");
    process.env.OIDC_ALLOW_HTTP = "false";
    assert.throws(loadAuthConfig, /OIDC_BACKCHANNEL_URL/);
  } finally {
    process.env = saved;
  }
});

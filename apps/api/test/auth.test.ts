import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createRemoteJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createJwtVerifier } from "../src/auth/oidc.js";
import { createAccessPolicy } from "../src/auth/middleware.js";
import { createApp } from "../src/app.js";
import { InMemoryProductRepository } from "../src/modules/products/in-memory-product.repository.js";
import { InMemoryCategoryRepository } from "../src/modules/categories/in-memory-category.repository.js";
import { loadAuthConfig, loadEnv } from "../src/config/env.js";

test("JWT signatures, claims, JWKS caching/rotation and route RBAC", async (t) => {
  const key = await generateKeyPair("RS256");
  const second = await generateKeyPair("RS256");
  let jwks = {
    keys: [
      {
        ...(await exportJWK(key.publicKey)),
        kid: "first",
        alg: "RS256",
        use: "sig",
      },
    ],
  };
  let requests = 0;
  const keysServer = createServer((_req, res) => {
    requests++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(jwks));
  }).listen(0, "127.0.0.1");
  await once(keysServer, "listening");
  const keysAddress = keysServer.address();
  assert.ok(keysAddress && typeof keysAddress !== "string");
  const issuer = `http://127.0.0.1:${keysAddress.port}/realms/ecommerce`;
  const audience = "ecommerce-api";
  const verify = createJwtVerifier(
    { enabled: true, issuer, audience },
    createRemoteJWKSet(new URL(issuer + "/jwks"), { cooldownDuration: 0 }),
  );
  const app = createApp({
    accessPolicy: createAccessPolicy(verify),
    productRepository: new InMemoryProductRepository(),
    categoryRepository: new InMemoryCategoryRepository(),
    checkReady: async () => {},
  });
  const server = createServer(app).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const token = async (
    roles: string[],
    changes: Record<string, unknown> = {},
    signing = key.privateKey,
    kid = "first",
  ) => {
    return new SignJWT({
      sub: "service-subject",
      iss: issuer,
      aud: audience,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      typ: "Bearer",
      resource_access: { [audience]: { roles } },
      scope: "catalog read",
      ...changes,
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid })
      .sign(signing);
  };
  const request = (path: string, authorization?: string, method = "GET") =>
    fetch(base + path, {
      method,
      headers: authorization ? { Authorization: authorization } : {},
    });
  try {
    await t.test("missing and malformed Bearer headers are safe 401", async () => {
      for (const header of [
        undefined,
        "Basic abc",
        "Bearer abc",
        "Bearer a.b.c extra",
        "Bearer a.b.c",
      ]) {
        const res = await request("/api/v1/products", header);
        assert.equal(res.status, 401);
        assert.ok(res.headers.get("www-authenticate"));
        assert.equal(typeof (await res.json()).error.message, "string");
      }
    });
    await t.test(
      "expired, wrong issuer/audience, missing expiry, ID token and invalid signature rejected",
      async () => {
        const invalid = [
          await token([], { exp: 1 }),
          await token([], { iss: "https://wrong.example" }),
          await token([], { aud: "another-api" }),
          await token([], { exp: undefined }),
          await token([], { sub: undefined }),
          await token([], { sub: "" }),
          await token([], { typ: "ID" }),
          await token([], {}, second.privateKey),
        ];
        for (const value of invalid)
          assert.equal((await request("/api/v1/products", "Bearer " + value)).status, 401);
      },
    );
    await t.test("roles are audience-scoped; valid unprivileged identity gets 403", async () => {
      assert.equal((await request("/api/v1/products", "Bearer " + (await token([])))).status, 403);
      const other = await token([], {
        realm_access: { roles: ["admin"] },
        resource_access: { "another-api": { roles: ["admin"] } },
      });
      assert.equal((await request("/api/v1/products", "Bearer " + other)).status, 403);
    });
    await t.test("catalog readers can read but cannot mutate or import", async () => {
      const reader = "Bearer " + (await token(["catalog_reader"]));
      for (const path of ["/api/v1/products", "/api/v1/categories"])
        assert.equal((await request(path, reader)).status, 200);
      for (const [path, method] of [
        ["/api/v1/products", "POST"],
        ["/api/v1/products/import", "POST"],
        ["/api/v1/products/00000000-0000-4000-8000-000000000000", "DELETE"],
      ])
        assert.equal((await request(path!, reader, method!)).status, 403);
      assert.equal((await request("/api/v1/orders/some-id", reader)).status, 404);
    });
    await t.test("catalog manager/admin permissions reach existing validation", async () => {
      for (const role of ["catalog_manager", "admin"]) {
        const manager = "Bearer " + (await token([role]));
        assert.equal((await request("/api/v1/products", manager)).status, 200);
        assert.equal((await request("/api/v1/products", manager, "POST")).status, 400);
      }
    });
    await t.test("Order routes require authentication before per-order authorization", async () => {
      const reader = "Bearer " + (await token(["order_reader"]));
      assert.equal((await request("/api/v1/orders/id", reader)).status, 404); // no Order module in this isolated app
      assert.equal((await request("/api/v1/orders", reader, "POST")).status, 404);
      assert.equal((await request("/api/v1/orders/id/payment", reader, "POST")).status, 404);
      const manager = "Bearer " + (await token(["order_manager"]));
      assert.equal((await request("/api/v1/orders", manager, "POST")).status, 404);
      assert.equal((await request("/api/v1/products", manager)).status, 403);
    });
    await t.test("JWKS is cached and unknown kid triggers rotation fetch", async () => {
      const before = requests;
      await verify(await token(["catalog_reader"]));
      await verify(await token(["catalog_reader"]));
      assert.equal(requests, before);
      jwks = {
        keys: [
          ...jwks.keys,
          {
            ...(await exportJWK(second.publicKey)),
            kid: "second",
            alg: "RS256",
            use: "sig",
          },
        ],
      };
      assert.equal(
        (await verify(await token(["catalog_reader"], {}, second.privateKey, "second"))).subject,
        "service-subject",
      );
      assert.equal(requests, before + 1);
    });
    await t.test("health and readiness remain public", async () => {
      assert.equal((await request("/health")).status, 200);
      assert.equal((await request("/ready")).status, 200);
    });
  } finally {
    server.closeAllConnections();
    keysServer.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => keysServer.close(() => resolve())),
    ]);
  }
});

test("auth config defaults enabled and rejects unsafe production opt-out", () => {
  loadEnv();
  const keys = ["AUTH_ENABLED", "OIDC_ISSUER", "OIDC_AUDIENCE", "NODE_ENV"];
  const saved = keys.map((key) => process.env[key]);
  try {
    process.env.NODE_ENV = "test";
    delete process.env.AUTH_ENABLED;
    process.env.OIDC_ISSUER = "http://127.0.0.1:8180/realms/ecommerce";
    process.env.OIDC_AUDIENCE = "ecommerce-api";
    assert.equal(loadAuthConfig().enabled, true);
    process.env.AUTH_ENABLED = "no";
    assert.throws(loadAuthConfig);
    process.env.AUTH_ENABLED = "false";
    assert.deepEqual(loadAuthConfig(), { enabled: false });
    process.env.NODE_ENV = "production";
    assert.throws(loadAuthConfig, /cannot be disabled/);
    process.env.AUTH_ENABLED = "true";
    assert.throws(loadAuthConfig, /Valid OIDC/);
    process.env.OIDC_ISSUER = "https://identity.example/realms/ecommerce";
    assert.equal(loadAuthConfig().enabled, true);
  } finally {
    keys.forEach((key, i) => {
      const value = saved[i];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

test("internal HTTP OIDC requires explicit non-production opt-in", () => {
  const saved = { ...process.env };
  try {
    process.env.NODE_ENV = "development";
    process.env.AUTH_ENABLED = "true";
    process.env.OIDC_ISSUER = "http://keycloak:8080/realms/ecommerce";
    process.env.OIDC_AUDIENCE = "ecommerce-api";
    process.env.OIDC_ALLOW_HTTP = "false";
    assert.throws(() => loadAuthConfig());
    process.env.OIDC_ALLOW_HTTP = "true";
    assert.equal(loadAuthConfig().enabled, true);
    process.env.NODE_ENV = "production";
    assert.throws(() => loadAuthConfig());
  } finally {
    process.env = saved;
  }
});

// Custom realm scopes must explicitly emit the subject for browser access tokens.
test("SPA API scope explicitly emits required subject into access tokens", async () => {
  const { readFile } = await import("node:fs/promises");
  const realm = JSON.parse(
    await readFile(
      new URL("../../../infra/keycloak/ecommerce-realm.json", import.meta.url),
      "utf8",
    ),
  );
  const scope = realm.clientScopes.find((s: { name: string }) => s.name === "ecommerce-api-access");
  assert.ok(
    realm.clients
      .find((c: { clientId: string }) => c.clientId === "ecommerce-web")
      .defaultClientScopes.includes(scope.name),
  );
  assert.ok(
    scope.protocolMappers.some(
      (m: { protocolMapper: string; config: Record<string, string> }) =>
        m.protocolMapper === "oidc-sub-mapper" && m.config["access.token.claim"] === "true",
    ),
  );
});


test("local realm supports registration/recovery and safe profile claims without mandatory email", async () => {
  const realm = JSON.parse(await (await import("node:fs/promises")).readFile(
    new URL("../../../infra/keycloak/ecommerce-realm.json", import.meta.url), "utf8"));
  assert.equal(realm.registrationAllowed, true);
  assert.equal(realm.resetPasswordAllowed, true);
  assert.equal(realm.verifyEmail, false);
  assert.equal(realm.requiredActions.find((action: {alias: string}) => action.alias === "VERIFY_EMAIL").defaultAction, false);
  const spa = realm.clients.find((client: {clientId: string}) => client.clientId === "ecommerce-web");
  assert.equal(spa.publicClient, true);
  assert.equal(spa.directAccessGrantsEnabled, false);
  assert.equal(spa.attributes["pkce.code.challenge.method"], "S256");
  for (const scopeName of ["profile", "email"]) {
    assert(spa.defaultClientScopes.includes(scopeName));
    const scope = realm.clientScopes.find((scope: {name: string}) => scope.name === scopeName);
    assert(scope?.protocolMappers.length > 0, scopeName + " must resolve to actual mappers");
  }
  const email = realm.clientScopes.find((scope: {name: string}) => scope.name === "email");
  const verified = email.protocolMappers.find((mapper: {name: string}) => mapper.name === "email_verified");
  assert.equal(verified.config["user.attribute"], "emailVerified");
  assert.equal(verified.config["jsonType.label"], "boolean");
});

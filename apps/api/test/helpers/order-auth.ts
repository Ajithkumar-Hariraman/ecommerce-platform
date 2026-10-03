import { createServer } from "node:http";
import { once } from "node:events";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

// Real signed JWT/JWKS boundary for isolated runtime listeners; no production bypass.
export async function startOrderAuth() {
  const keys = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "ownership-test",
    alg: "RS256",
    use: "sig",
  };
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url?.includes(".well-known")
          ? { issuer, jwks_uri: issuer + "/certs" }
          : { keys: [jwk] },
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("JWKS listener unavailable");
  const issuer = `http://127.0.0.1:${address.port}/realms/test`;
  const token = await new SignJWT({
    typ: "Bearer",
    resource_access: { "ecommerce-api": { roles: ["catalog_manager", "order_manager"] } },
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: jwk.kid })
    .setIssuer(issuer)
    .setAudience("ecommerce-api")
    .setSubject("runtime-order-owner")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(keys.privateKey);
  return {
    env: {
      AUTH_ENABLED: "true",
      OIDC_ISSUER: issuer,
      OIDC_AUDIENCE: "ecommerce-api",
      OIDC_ALLOW_HTTP: "true",
    },
    headers: { Authorization: "Bearer " + token },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

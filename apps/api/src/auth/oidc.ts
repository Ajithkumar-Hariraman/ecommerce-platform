import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import type { AuthenticatedPrincipal } from "./principal.js";
import type { EnabledAuthConfig } from "../config/env.js";

export type TokenVerifier = (token: string) => Promise<AuthenticatedPrincipal>;
const roles = new Set([
  "catalog_reader",
  "catalog_manager",
  "order_reader",
  "order_manager",
  "admin",
]);

export function createJwtVerifier(
  config: EnabledAuthConfig,
  keys: JWTVerifyGetKey,
): TokenVerifier {
  return async (token) => {
    const { payload, protectedHeader } = await jwtVerify(token, keys, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "iss", "aud", "exp", "iat"],
      clockTolerance: 5,
    });
    if (
      protectedHeader.typ !== "JWT" ||
      payload.typ !== "Bearer" ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.iat !== "number" ||
      payload.iat > Date.now() / 1000 + 5
    )
      throw new Error("Invalid access token claims");
    const access = payload.resource_access;
    const resource =
      typeof access === "object" && access !== null
        ? (access as Record<string, unknown>)[config.audience]
        : undefined;
    const roleClaim =
      typeof resource === "object" && resource !== null && "roles" in resource
        ? resource.roles
        : [];
    if (
      !Array.isArray(roleClaim) ||
      !roleClaim.every((role) => typeof role === "string")
    )
      throw new Error("Invalid role claim");
    const principal: AuthenticatedPrincipal = {
      subject: payload.sub,
      roles: [...new Set(roleClaim.filter((role) => roles.has(role)))],
      scopes:
        typeof payload.scope === "string"
          ? payload.scope.split(/\s+/).filter(Boolean)
          : [],
    };
    if (typeof payload.preferred_username === "string")
      principal.username = payload.preferred_username;
    return principal;
  };
}

export async function createOidcVerifier(
  config: EnabledAuthConfig,
): Promise<TokenVerifier> {
  try {
    const response = await fetch(
      config.issuer + "/.well-known/openid-configuration",
      { signal: AbortSignal.timeout(5000), redirect: "error" },
    );
    if (!response.ok) throw new Error();
    const metadata = (await response.json()) as {
      issuer?: unknown;
      jwks_uri?: unknown;
    };
    if (
      metadata.issuer !== config.issuer ||
      typeof metadata.jwks_uri !== "string"
    )
      throw new Error();
    const jwksUrl = new URL(metadata.jwks_uri);
    if (
      jwksUrl.origin !== new URL(config.issuer).origin ||
      jwksUrl.username ||
      jwksUrl.password ||
      jwksUrl.hash
    )
      throw new Error();
    const keys = createRemoteJWKSet(jwksUrl, {
      timeoutDuration: 5000,
      cooldownDuration: 30000,
      cacheMaxAge: 600000,
    });
    return createJwtVerifier(config, keys);
  } catch {
    throw new Error(
      "OIDC discovery failed; verify identity provider configuration",
    );
  }
}

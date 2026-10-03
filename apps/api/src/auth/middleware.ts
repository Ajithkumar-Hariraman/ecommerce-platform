import type { RequestHandler } from "express";
import type { ParamsDictionary, Query } from "express-serve-static-core";
import { AppError } from "../errors/app-error.js";
import type { AuthenticatedPrincipal } from "./principal.js";
import type { TokenVerifier } from "./oidc.js";

type AuthHandler = RequestHandler<
  ParamsDictionary,
  unknown,
  unknown,
  Query,
  { principal?: AuthenticatedPrincipal }
>;
export function authenticate(verifier: TokenVerifier): AuthHandler {
  return async (req, res, next) => {
    const header = req.get("Authorization") ?? "";
    const count = req.rawHeaders.filter(
      (value, index) => index % 2 === 0 && value.toLowerCase() === "authorization",
    ).length;
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header);
    if (count !== 1 || header.length > 8192 || !match) {
      res.setHeader("WWW-Authenticate", "Bearer");
      throw new AppError(401, "Authentication required");
    }
    try {
      res.locals.principal = await verifier(match[1]!);
    } catch {
      res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
      throw new AppError(401, "Invalid access token");
    }
    next();
  };
}
export function requireAnyRole(...roles: string[]): AuthHandler {
  return (_req, res, next) => {
    if (!res.locals.principal) throw new AppError(401, "Authentication required");
    if (!res.locals.principal.roles.some((role) => roles.includes(role)))
      throw new AppError(403, "Insufficient permission");
    next();
  };
}
export interface AccessPolicy {
  authenticate: RequestHandler;
  catalog: RequestHandler;
  orders: RequestHandler;
}
export function createAccessPolicy(verifier: TokenVerifier): AccessPolicy {
  const permission =
    (reader: string, manager: string): RequestHandler =>
    (req, res, next) => {
      const allowed =
        req.method === "GET" || req.method === "HEAD"
          ? [reader, manager, "admin"]
          : [manager, "admin"];
      return requireAnyRole(...allowed)(req, res, next);
    };
  return {
    authenticate: authenticate(verifier),
    catalog: permission("catalog_reader", "catalog_manager"),
    orders: permission("order_reader", "order_manager"),
  };
}
// Explicit opt-out for isolated tests/local unauthenticated operation only.
// env.ts forbids AUTH_ENABLED=false in production; server.ts always supplies a policy.
export function disabledAccessPolicy(): AccessPolicy {
  const allow: RequestHandler = (_req, _res, next) => next();
  return { authenticate: allow, catalog: allow, orders: allow };
}
export function denyAccessPolicy(): AccessPolicy {
  const deny: RequestHandler = (_req, res) => {
    res.setHeader("WWW-Authenticate", "Bearer");
    throw new AppError(401, "Authentication required");
  };
  return { authenticate: deny, catalog: deny, orders: deny };
}

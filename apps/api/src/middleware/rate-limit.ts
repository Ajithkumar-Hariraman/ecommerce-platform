import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import type { AuthenticatedPrincipal } from "../auth/principal.js";
import type { RedisCommands, OperationalLog } from "../database/redis.js";
import { AppError } from "../errors/app-error.js";

// Fixed window begins on the first request, using Redis expiry rather than host clocks.
const increment = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;
export class RedisRateLimiter {
  constructor(
    private readonly redis: RedisCommands,
    private readonly windowSeconds: number,
    private readonly maxRequests: number,
    private readonly prefix = "",
  ) {}
  async consume(subject: string): Promise<{ allowed: boolean; retryAfter: number }> {
    const identity = createHash("sha256").update(subject).digest("hex");
    const result = await this.redis.command([
      "EVAL",
      increment,
      "1",
      `${this.prefix}rate:v1:${identity}:api`,
      String(this.windowSeconds),
    ]);
    if (!Array.isArray(result) || result.length !== 2 || !result.every(Number.isSafeInteger))
      throw new Error("Invalid rate counter result");
    return { allowed: result[0] <= this.maxRequests, retryAfter: Math.max(1, result[1]) };
  }
}
export function rateLimit(
  limiter: Pick<RedisRateLimiter, "consume">,
  log: OperationalLog = console.warn,
): RequestHandler {
  return async (_req, res, next) => {
    const principal = res.locals.principal as AuthenticatedPrincipal | undefined;
    // Explicit AUTH_ENABLED=false is only available in non-production environments.
    if (!principal) {
      next();
      return;
    }
    let decision;
    try {
      decision = await limiter.consume(principal.subject);
    } catch {
      log("Redis rate limiter unavailable; authenticated request allowed.");
      next();
      return;
    }
    if (!decision.allowed) {
      res.setHeader("Retry-After", String(decision.retryAfter));
      next(new AppError(429, "Too many requests"));
      return;
    }
    next();
  };
}

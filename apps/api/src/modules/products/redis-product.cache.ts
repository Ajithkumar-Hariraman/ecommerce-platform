import { z } from "zod";
import type { RedisCommands, OperationalLog } from "../../database/redis.js";
import type { Product } from "./product.js";
import type { ProductCache } from "./product.cache.js";

export const cachedProduct = z.strictObject({
  id: z.uuid(),
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  categoryId: z.uuid().nullable(),
  priceInMinorUnits: z.number().int().positive(),
  stock: z.number().int().nonnegative(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export class RedisProductCache implements ProductCache {
  constructor(
    private readonly redis: RedisCommands,
    private readonly ttlSeconds: number,
    private readonly prefix = "",
    private readonly log: OperationalLog = console.warn,
  ) {}
  private key(id: string): string {
    return `${this.prefix}product:v1:${id.toLowerCase()}`;
  }
  async get(id: string): Promise<Product | null> {
    try {
      const raw = await this.redis.command(["GET", this.key(id)]);
      if (raw === null) return null;
      let value: unknown;
      try {
        value = typeof raw === "string" ? JSON.parse(raw) : undefined;
      } catch {
        /* corrupt JSON */
      }
      const parsed = cachedProduct.safeParse(value);
      if (parsed.success && parsed.data.id.toLowerCase() === id.toLowerCase()) return parsed.data;
      this.log("Invalid Product cache entry ignored.");
      await this.delete(id);
    } catch {
      this.log("Product cache GET failed; falling back to database.");
    }
    return null;
  }
  async set(product: Product): Promise<void> {
    try {
      await this.redis.command([
        "SET",
        this.key(product.id),
        JSON.stringify(product),
        "EX",
        String(this.ttlSeconds),
      ]);
    } catch {
      this.log("Product cache SET failed; database result retained.");
    }
  }
  async delete(id: string): Promise<void> {
    try {
      await this.redis.command(["DEL", this.key(id)]);
    } catch {
      this.log("Product cache invalidation failed; TTL bounds stale data.");
    }
  }
}

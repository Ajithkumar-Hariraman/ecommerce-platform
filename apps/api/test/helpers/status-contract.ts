import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Product } from "../../src/modules/products/product.js";
import type { ProductRepository } from "../../src/modules/products/product.repository.js";

// Caller provides empty, isolated storage. The same assertions exercise both adapters.
export async function verifyStatusCollection(t: TestContext, repository: ProductRepository): Promise<void> {
  const now = new Date().toISOString();
  const make = (name: string): Product => ({
    id: randomUUID(), sku: "STATUS-" + randomUUID(), name, description: null,
    priceInMinorUnits: 49999, stock: 1, status: "ACTIVE", createdAt: now, updatedAt: now,
  });
  const a = make("Product A");
  const b = { ...make("Product B"), status: "INACTIVE" as const };
  const c = make("Product C");
  const ids = [a.id, b.id, c.id];
  try {
    await repository.create(a);
    await repository.create(c);

    await t.test("findByStatus no matching rows returns [] with other-status products present", async () => {
      const result = await repository.findByStatus("INACTIVE");
      assert(Array.isArray(result), "status filters must return an array, never null");
      assert.deepEqual(result, []);
    });

    await repository.create(b);
    await t.test("findByStatus ACTIVE returns all matching products only", async () => {
      const result = await repository.findByStatus("ACTIVE");
      assert(Array.isArray(result), "status filters must return an array, never a single Product");
      assert.equal(result.length, 2);
      assert(result.every(product => product.status === "ACTIVE"));
      const byId = (products: Product[]) => [...products].sort((left, right) => left.id.localeCompare(right.id));
      assert.deepEqual(byId(result), byId([a, c]));
    });
    await t.test("findByStatus INACTIVE returns only matching products as an array", async () => {
      const result = await repository.findByStatus("INACTIVE");
      assert(Array.isArray(result));
      assert.equal(result.length, 1);
      assert(result.every(product => product.status === "INACTIVE"));
      assert.deepEqual(result, [b]);
    });
  } finally {
    for (const id of ids) await repository.deleteById(id);
  }
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Product } from "../../src/modules/products/product.js";
import type { ProductRepository } from "../../src/modules/products/product.repository.js";

// Preserve existing rows; compare complete results against the baseline plus owned fixtures.
export async function verifyStatusCollection(t: TestContext, repository: ProductRepository): Promise<void> {
  const baselineActive = await repository.findByStatus("ACTIVE");
  const baselineInactive = await repository.findByStatus("INACTIVE");
  const byId = (products: Product[]) => [...products].sort((left, right) => left.id.localeCompare(right.id));
  const now = new Date().toISOString();
  const make = (name: string): Product => ({
    id: randomUUID(), sku: "STATUS-" + randomUUID(), name, description: null, categoryId: null,
    priceInMinorUnits: 49999, stock: 1, status: "ACTIVE", createdAt: now, updatedAt: now,
  });
  const a = make("Product A");
  const b = { ...make("Product B"), status: "INACTIVE" as const };
  const c = make("Product C");
  const ids = [a.id, b.id, c.id];
  try {
    await repository.create(a);
    await repository.create(c);

    await t.test("findByStatus adds no matches for other-status fixtures", async () => {
      const result = await repository.findByStatus("INACTIVE");
      assert(Array.isArray(result), "status filters must return an array, never null");
      assert.deepEqual(byId(result), byId(baselineInactive));
      assert.deepEqual(result.filter(product => ids.includes(product.id)), []);
    });

    await repository.create(b);
    await t.test("findByStatus ACTIVE returns all matching products only", async () => {
      const result = await repository.findByStatus("ACTIVE");
      assert(Array.isArray(result), "status filters must return an array, never a single Product");
      assert.equal(result.length, baselineActive.length + 2);
      assert(result.every(product => product.status === "ACTIVE"));
      assert.deepEqual(byId(result), byId([...baselineActive, a, c]));
    });
    await t.test("findByStatus INACTIVE returns only matching products as an array", async () => {
      const result = await repository.findByStatus("INACTIVE");
      assert(Array.isArray(result));
      assert.equal(result.length, baselineInactive.length + 1);
      assert(result.every(product => product.status === "INACTIVE"));
      assert.deepEqual(byId(result), byId([...baselineInactive, b]));
    });
  } finally {
    for (const id of ids) await repository.deleteById(id);
  }
}

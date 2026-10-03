import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Product } from "../../src/modules/products/product.js";
import type { ProductRepository } from "../../src/modules/products/product.repository.js";

// Preserve unrelated rows. Expected results include the baseline rather than clearing it.
export async function verifyListing(t: TestContext, repository: ProductRepository): Promise<void> {
  const baseline = await repository.findAll();
  const owned: Product[] = Array.from({ length: 6 }, (_, i) => ({
    id: randomUUID(),
    sku: "PAGE-" + randomUUID(),
    name: "Page fixture " + i,
    description: null,
    categoryId: null,
    priceInMinorUnits: 100,
    stock: 1,
    status: i % 3 === 0 ? "INACTIVE" : "ACTIVE",
    createdAt: "2001-01-01T00:00:00.000Z",
    updatedAt: "2001-01-01T00:00:00.000Z",
  }));
  const expected = [...baseline, ...owned].sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  try {
    // Reverse insertion demonstrates that ID breaks equal-timestamp ties.
    for (const product of [...owned].reverse()) await repository.create(product);
    await t.test("total precedes slicing and second page uses deterministic ordering", async () => {
      const result = await repository.list({ limit: 2, offset: 2 });
      assert.equal(result.total, expected.length);
      assert.deepEqual(result.products, expected.slice(2, 4));
    });
    for (const status of ["ACTIVE", "INACTIVE"] as const) {
      await t.test(status + " filtering combines with pagination and matching total", async () => {
        const matching = expected.filter((p) => p.status === status);
        const result = await repository.list({ status, limit: 1, offset: 1 });
        assert.equal(result.total, matching.length);
        assert.deepEqual(result.products, matching.slice(1, 2));
      });
    }
    await t.test("beyond available rows is empty with real total", async () => {
      assert.deepEqual(await repository.list({ limit: 2, offset: expected.length + 5 }), {
        products: [],
        total: expected.length,
      });
    });
    await t.test("limit 100 is supported and listed products are independent copies", async () => {
      const result = await repository.list({ limit: 100, offset: 0 });
      assert.deepEqual(result.products, expected.slice(0, 100));
      const first = result.products[0]!;
      const original = first.name;
      first.name = "Changed outside repository";
      assert.equal((await repository.findById(first.id))?.name, original);
    });
  } finally {
    for (const product of owned) await repository.deleteById(product.id);
  }
}

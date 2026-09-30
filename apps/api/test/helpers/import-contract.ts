import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/app.js";
import type { ProductRepository } from "../../src/modules/products/product.repository.js";
import type { CategoryRepository } from "../../src/modules/categories/category.repository.js";

export async function verifyImport(repository: ProductRepository, categories: CategoryRepository): Promise<void> {
  const prefix = "IMPORT-" + randomUUID();
  const skus = [prefix + "-A", prefix + "-B"];
  const app = createApp({productRepository: repository, categoryRepository: categories, checkReady: async () => {}});
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/v1/products/import`;
  const send = (body: string, type = "text/csv") => fetch(url, {method: "POST", headers: {"Content-Type": type}, body});
  try {
    const response = await send(`sku,name,priceInMinorUnits,stock,status\n${skus[0]},A,123,4,INACTIVE\nBAD,B,bad,0,ACTIVE\n${skus[1]},B,234,5,`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.totalRows, 3);
    assert.equal(result.imported, 2);
    assert.equal(result.failed, 1);
    assert.equal(result.failuresTruncated, false);
    const a = await repository.findBySku(skus[0]!);
    const b = await repository.findBySku(skus[1]!);
    assert.equal(a?.status, "INACTIVE");
    assert.equal(a?.priceInMinorUnits, 123);
    assert.equal(a?.stock, 4);
    assert.equal(b?.status, "ACTIVE");
    const duplicate = await send(`sku,name,priceInMinorUnits,stock\n${skus[0]},A,1,0`);
    const duplicateResult = await duplicate.json();
    assert.equal(duplicateResult.failed, 1);
    assert.equal(duplicateResult.failures[0].message, "SKU already exists");
    for (const body of ["", "sku,name", "sku,sku", "sku,name,priceInMinorUnits,stock,unknown", 'sku,name,priceInMinorUnits,stock\n"bad']) {
      const bad = await send(body);
      assert.equal(bad.status, 400);
      assert.equal(typeof (await bad.json()).error.message, "string");
    }
    assert.equal((await send("hello", "text/plain")).status, 415);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const sku of skus) {
      const product = await repository.findBySku(sku);
      if (product) await repository.deleteById(product.id);
    }
  }
}

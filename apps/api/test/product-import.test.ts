import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { ProductImportService } from "../src/modules/products/import/product-import.service.js";
import type { ProductImportInput } from "../src/modules/products/import/product-import.types.js";

test("imports valid CSV rows", async () => {
  const created: ProductImportInput[] = [];

  const service = new ProductImportService(async (input) => {
    created.push(input);
  });

  const csv = [
    "sku,name,description,priceInMinorUnits,stock,status,categoryId",
    "A-001,Product A,,1000,5,ACTIVE,",
    "B-001,Product B,,2000,8,INACTIVE,",
  ].join("\n");

  const result = await service.importCsv(Readable.from(csv));

  assert.equal(result.totalRows, 2);
  assert.equal(result.imported, 2);
  assert.equal(result.failed, 0);
  assert.equal(created.length, 2);

  assert.equal(created[0]?.sku, "A-001");
  assert.equal(created[0]?.priceInMinorUnits, 1000);
  assert.equal(created[0]?.stock, 5);
});

test("continues after invalid rows", async () => {
  const created: ProductImportInput[] = [];

  const service = new ProductImportService(async (input) => {
    created.push(input);
  });

  const csv = [
    "sku,name,description,priceInMinorUnits,stock,status,categoryId",
    "GOOD-001,Good Product,,1000,5,ACTIVE,",
    "BAD-001,Bad Product,,abc,-1,WRONG,",
    "GOOD-002,Good Product 2,,2000,2,ACTIVE,",
  ].join("\n");

  const result = await service.importCsv(Readable.from(csv));

  assert.equal(result.totalRows, 3);
  assert.equal(result.imported, 2);
  assert.equal(result.failed, 1);
  assert.equal(created.length, 2);

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]?.sku, "BAD-001");
});

test("limits concurrent product creation", async () => {
  let active = 0;
  let maximumActive = 0;

  const service = new ProductImportService(async () => {
    active += 1;

    maximumActive = Math.max(maximumActive, active);

    await new Promise((resolve) => setTimeout(resolve, 20));

    active -= 1;
  });

  const rows = Array.from(
    { length: 20 },
    (_, index) => `SKU-${index},Product ${index},,1000,1,ACTIVE,`,
  );

  const csv = [
    "sku,name,description,priceInMinorUnits,stock,status,categoryId",
    ...rows,
  ].join("\n");

  const result = await service.importCsv(Readable.from(csv));

  assert.equal(result.imported, 20);

  assert.ok(maximumActive <= 5);
  assert.ok(maximumActive > 1);
});


test("rejects empty, missing, duplicate, unsupported headers and malformed CSV", async () => {
  for (const csv of ["", "sku,name\nA,A", "sku,name,stock,priceInMinorUnits,sku", "sku,name,stock,priceInMinorUnits,unknown", 'sku,name,stock,priceInMinorUnits\n"unterminated']) {
    const service = new ProductImportService(async () => { assert.fail("must not create"); });
    await assert.rejects(service.importCsv(Readable.from(csv)), { statusCode: 400 });
  }
});

test("defaults status and bounds failure samples and error details", async () => {
  let status: string | undefined;
  const service = new ProductImportService(async input => { status = input.status; });
  await service.importCsv(Readable.from("sku,name,priceInMinorUnits,stock\nA,A,10,0"));
  assert.equal(status, "ACTIVE");
  const csv = "sku,name,priceInMinorUnits,stock\n" + Array.from({length: 105}, () => `${"S".repeat(500)},A,bad,0`).join("\n");
  const result = await service.importCsv(Readable.from(csv));
  assert.equal(result.failed, 105);
  assert.equal(result.failures.length, 100);
  assert.equal(result.failuresTruncated, true);
  assert.ok(result.failures.every(f => (f.sku?.length ?? 0) <= 200 && f.message.length <= 300));
});

test("file bytes, record size and row count are bounded", async () => {
  const service = new ProductImportService(async () => {});
  await assert.rejects(service.importCsv(Readable.from(Buffer.alloc(25 * 1024 * 1024 + 1))), {statusCode: 413});
  await assert.rejects(service.importCsv(Readable.from("sku,name,priceInMinorUnits,stock\n" + "x".repeat(65537))), {statusCode: 400});
  async function* rows() {
    yield "sku,name,priceInMinorUnits,stock\n";
    for (let i = 0; i < 100001; i++) yield "A,A,1,0\n";
  }
  await assert.rejects(service.importCsv(Readable.from(rows())), {statusCode: 400});
});

test("provider internals are hidden and parser errors during work are handled", async () => {
  const service = new ProductImportService(async () => { throw new Error("private SQL detail"); });
  const result = await service.importCsv(Readable.from("sku,name,priceInMinorUnits,stock\nA,A,1,0"));
  assert.equal(result.failures[0]?.message, "Product could not be imported");
  const delayed = new ProductImportService(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  async function* chunks() {
    yield "sku,name,priceInMinorUnits,stock\n" + "A,A,1,0\n".repeat(5);
    await new Promise(resolve => setTimeout(resolve, 5));
    yield '"unterminated';
  }
  await assert.rejects(delayed.importCsv(Readable.from(chunks())), {statusCode: 400});
});

import { verifyImport } from "./helpers/import-contract.js";
import { InMemoryProductRepository } from "../src/modules/products/in-memory-product.repository.js";
import { InMemoryCategoryRepository } from "../src/modules/categories/in-memory-category.repository.js";
test("CSV HTTP contract preserves status, partial success and safe errors", async () => {
  await verifyImport(new InMemoryProductRepository(), new InMemoryCategoryRepository());
});

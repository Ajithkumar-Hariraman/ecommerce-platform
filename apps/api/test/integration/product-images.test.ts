import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { loadEnv } from "../../src/config/env.js";
import { createBusinessResources } from "../../src/database/business.js";
import { createPool } from "../../src/database/pool.js";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { ProductService } from "../../src/modules/products/product.service.js";
import {
  createImageStorage,
  GcsProductImageStore,
} from "../../src/modules/products/gcs-product-image.store.js";
const config = {
  projectId: "ecommerce-platform-510208",
  signerServiceAccount: "ecommerce-runtime@ecommerce-platform-510208.iam.gserviceaccount.com",
};
const bucket = "ecommerce-platform-510208-product-assets";
// Complete 1x1 PNG fixture, never a customer asset.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOZkAAAAASUVORK5CYII=",
  "base64",
);
for (const storage of ["postgres", "mongodb"] as const)
  test(
    `real ${storage} product image reference preserves CRUD`,
    { skip: storage === "mongodb" && !process.env.MONGODB_TEST_URI },
    async () => {
      const saved = { ...process.env };
      loadEnv();
      process.env.NODE_ENV = "test";
      process.env.BUSINESS_STORAGE = storage;
      if (storage === "mongodb") {
        process.env.MONGODB_URI = process.env.MONGODB_TEST_URI;
        process.env.MONGODB_DB_NAME = "ecommerce_test";
      }
      const business = await createBusinessResources();
      const service = new ProductService(business.products, business.categories);
      let id: string | undefined;
      try {
        const p = await service.create({
          sku: randomUUID(),
          name: "Image reference fixture",
          priceInMinorUnits: 100,
          stock: 1,
        });
        id = p.id;
        const image = {
          bucket,
          objectName: `products/${id}/${randomUUID()}.png`,
          generation: "123",
          contentType: "image/png" as const,
          size: png.length,
        };
        await service.setImage(id, image);
        assert.deepEqual((await business.products.findById(id))?.image, image);
        assert.deepEqual((await service.update(id, { name: "Updated" })).image, image);
        assert.deepEqual((await service.list()).products.find((p) => p.id === id)?.image, image);
      } finally {
        if (id) await business.products.deleteById(id);
        await business.close();
        process.env = saved;
      }
    },
  );
test(
  "real GCS signed upload, size binding, immutable generation, validation and signed download",
  { skip: process.env.GCS_RUN_INTEGRATION !== "true", timeout: 60000 },
  async () => {
    const storage = await createImageStorage(config);
    const store = new GcsProductImageStore(storage, bucket);
    const id = randomUUID();
    let name: string | undefined, generation: string | undefined;
    try {
      const upload = await store.createUpload(id, { contentType: "image/png", size: png.length });
      name = upload.objectName;
      const response = await fetch(upload.url, {
        method: "PUT",
        headers: upload.headers,
        body: png,
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(response.status, 200);
      const image = await store.validate(id, name);
      generation = image.generation;
      assert.equal(image.size, png.length);
      const url = await store.readUrl(image);
      assert.deepEqual(
        Buffer.from(
          await (await fetch(url.url, { signal: AbortSignal.timeout(15000) })).arrayBuffer(),
        ),
        png,
      );
      assert.equal(
        (
          await fetch(upload.url, {
            method: "PUT",
            headers: upload.headers,
            body: png,
            signal: AbortSignal.timeout(15000),
          })
        ).status,
        412,
      );
    } finally {
      if (name)
        await storage
          .bucket(bucket)
          .file(name, generation ? { generation } : {})
          .delete({ ignoreNotFound: true });
    }
  },
);

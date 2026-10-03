import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createAccessPolicy } from "../src/auth/middleware.js";
import { InMemoryProductRepository } from "../src/modules/products/in-memory-product.repository.js";
import { InMemoryCategoryRepository } from "../src/modules/categories/in-memory-category.repository.js";
import { GcsProductImageStore } from "../src/modules/products/gcs-product-image.store.js";
import { ProductService } from "../src/modules/products/product.service.js";
import { ProductImageService } from "../src/modules/products/product-image.service.js";
import {
  imageUploadSchema,
  imageObjectBelongsTo,
  matchesImageHeader,
  maximumImageBytes,
} from "../src/modules/products/product-image.js";
import type { Storage } from "@google-cloud/storage";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
function fixture() {
  const requests: any[] = [];
  let metadata: any = { generation: "123", contentType: "image/png", size: png.length };
  let bytes = png;
  let fail = false;
  const storage = {
    bucket() {
      return {
        file(name: string, options?: unknown) {
          requests.push({ name, options });
          return {
            async getSignedUrl(config: unknown) {
              requests.push({ config });
              if (fail) throw new Error("private provider data");
              return ["https://storage.googleapis.com/signed-capability"];
            },
            async getMetadata() {
              if (fail) throw new Error("private provider data");
              return [metadata];
            },
            createReadStream() {
              return Readable.from([bytes]);
            },
          };
        },
      };
    },
  } as unknown as Storage;
  return {
    store: new GcsProductImageStore(storage, "private-assets"),
    requests,
    setMeta(value: unknown) {
      metadata = value;
    },
    setBytes(value: Buffer) {
      bytes = value;
    },
    fail() {
      fail = true;
    },
  };
}
test("image input bounds, namespace and magic-header validation", () => {
  for (const value of [
    { contentType: "image/svg+xml", size: 10 },
    { contentType: "image/png", size: maximumImageBytes + 1 },
    { contentType: "image/png", size: 0 },
    { contentType: "image/png", size: "10" },
    { contentType: "image/png", size: 10, objectName: "forged" },
  ])
    assert.equal(imageUploadSchema.safeParse(value).success, false);
  const id = randomUUID();
  assert.equal(imageObjectBelongsTo(id, `products/${id}/${randomUUID()}.png`), true);
  assert.equal(imageObjectBelongsTo(id, `products/${randomUUID()}/${randomUUID()}.png`), false);
  assert.equal(imageObjectBelongsTo(id, "../../image.png"), false);
  assert.equal(matchesImageHeader("image/png", png), true);
  assert.equal(matchesImageHeader("image/png", Buffer.from("malformed")), false);
  assert.equal(matchesImageHeader("image/jpeg", Buffer.from([255, 216, 255])), true);
  assert.equal(matchesImageHeader("image/webp", Buffer.from("RIFFabcdWEBP")), true);
});
test("signed PUT binds byte length, MIME and create-only generation; reference pins verified generation", async () => {
  const f = fixture(),
    id = randomUUID();
  const upload = await f.store.createUpload(id, { contentType: "image/png", size: png.length });
  assert.equal(imageObjectBelongsTo(id, upload.objectName), true);
  const config = f.requests.find((r) => r.config)?.config;
  assert.equal(config.version, "v4");
  assert.equal(config.action, "write");
  assert.equal(config.contentType, "image/png");
  assert.deepEqual(config.extensionHeaders, {
    "content-length": String(png.length),
    "x-goog-if-generation-match": "0",
  });
  const image = await f.store.validate(id, upload.objectName);
  assert.equal(image.generation, "123");
  assert.equal(image.size, png.length);
  await f.store.readUrl(image);
  assert.ok(f.requests.some((r) => r.options?.generation === "123"));
  await assert.rejects(f.store.validate(randomUUID(), upload.objectName), { statusCode: 400 });
  f.setBytes(Buffer.from("fake image"));
  await assert.rejects(f.store.validate(id, upload.objectName), { statusCode: 400 });
  f.setMeta({ generation: "123", contentType: "image/png", size: maximumImageBytes + 1 });
  await assert.rejects(f.store.validate(id, upload.objectName), { statusCode: 400 });
  f.fail();
  await assert.rejects(f.store.createUpload(id, { contentType: "image/png", size: 10 }), {
    statusCode: 503,
    message: "Product image upload unavailable",
  });
});
test("image attachment persists only validated reference and invalidates cache; HTTP RBAC remains authoritative", async () => {
  const repository = new InMemoryProductRepository(),
    categories = new InMemoryCategoryRepository();
  const invalidated: string[] = [];
  const service = new ProductService(repository, categories, {
    get: async () => null,
    set: async () => {},
    delete: async (id) => {
      invalidated.push(id);
    },
  });
  const f = fixture();
  const product = await service.create({
    sku: randomUUID(),
    name: "Image product",
    priceInMinorUnits: 100,
    stock: 1,
  });
  const images = new ProductImageService(service, f.store);
  const upload = await images.createUpload(product.id, {
    contentType: "image/png",
    size: png.length,
  });
  const saved = await images.complete(product.id, upload.objectName);
  assert.equal(saved.image?.generation, "123");
  saved.image!.generation = "forged";
  assert.equal((await repository.findById(product.id))?.image?.generation, "123");
  assert.deepEqual(invalidated, [product.id]);
  assert.equal(
    (await service.update(product.id, { name: "Still has image" })).image?.generation,
    "123",
  );
  const app = createApp({
    productRepository: repository,
    categoryRepository: categories,
    productImages: f.store,
    checkReady: async () => {},
    accessPolicy: createAccessPolicy(async (token) => ({
      subject: "actor",
      roles: token.startsWith("manager.") ? ["catalog_manager"] : ["catalog_reader"],
      scopes: [],
    })),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1/products/${product.id}`;
  const request = (path: string, role: string, method = "GET", body?: unknown) =>
    fetch(base + path, {
      method,
      headers: {
        Authorization: "Bearer " + role + ".test.signature",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal(
      (await request("/image-upload", "reader", "POST", { contentType: "image/png", size: 10 }))
        .status,
      403,
    );
    assert.equal(
      (await request("/image-upload", "manager", "POST", { contentType: "image/png", size: 10 }))
        .status,
      200,
    );
    assert.equal(
      (await request("/image-upload", "manager", "POST", { contentType: "text/plain", size: 10 }))
        .status,
      400,
    );
    assert.equal(
      (await request("/image", "manager", "PUT", { objectName: "../../forged" })).status,
      400,
    );
    assert.equal((await request("/image-url", "reader")).status, 200);
    await assert.rejects(
      new ProductImageService(service).createUpload(product.id, {
        contentType: "image/png",
        size: 10,
      }),
      { statusCode: 503 },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

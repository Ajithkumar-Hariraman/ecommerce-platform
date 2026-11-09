import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { S3ProductImageStore } from "../src/modules/products/s3-product-image.store.js";
import { S3OrderDocumentStore } from "../src/post-purchase/s3-documents.js";
const credentials = { accessKeyId: "fixture", secretAccessKey: "fixture" };
test("S3 signs create-only uploads and uses VersionId rather than ETag", async () => {
  const client = new S3Client({ region: "ap-south-1", credentials });
  const store = new S3ProductImageStore(client, "test-images");
  const id = randomUUID();
  const upload = await store.createUpload(id, { contentType: "image/png", size: 8 });
  assert.equal(upload.headers["If-None-Match"], "*");
  assert.match(new URL(upload.url).searchParams.get("X-Amz-SignedHeaders")!, /if-none-match/);
  assert.match(new URL(upload.url).searchParams.get("X-Amz-SignedHeaders")!, /content-length/);
  test.mock.method(client, "send", async (command: HeadObjectCommand | GetObjectCommand) => {
    if (command instanceof HeadObjectCommand)
      return {
        VersionId: "opaque_Revision+123/==",
        ETag: "not-a-revision",
        ContentLength: 8,
        ContentType: "image/png",
        Metadata: { "expected-size": "8" },
      };
    assert.equal(command.input.VersionId, "opaque_Revision+123/==");
    assert.equal(command.input.Range, "bytes=0-31");
    return { Body: Readable.from([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])]) };
  });
  const image = await store.validate(id, upload.objectName);
  assert.equal(image.generation, "opaque_Revision+123/==");
  assert.equal(
    new URL((await store.readUrl(image)).url).searchParams.get("versionId"),
    image.generation,
  );
  await assert.rejects(store.validate(randomUUID(), upload.objectName), /Invalid product image/);
  client.destroy();
});
test("S3 documents use create-only private PDF writes and bounded reads", async () => {
  const client = new S3Client({ region: "ap-south-1", credentials });
  const store = new S3OrderDocumentStore(client, "test-documents");
  let mode = "put";
  test.mock.method(client, "send", async (command: PutObjectCommand | GetObjectCommand) => {
    if (command instanceof PutObjectCommand) {
      assert.equal(command.input.IfNoneMatch, "*");
      assert.equal(command.input.ContentType, "application/pdf");
      assert.equal(command.input.CacheControl, "private,no-store");
      if (mode === "duplicate") throw { $metadata: { httpStatusCode: 412 } };
      return {};
    }
    return {
      ContentType: "application/pdf",
      ContentLength: 4,
      Body: Readable.from([Buffer.alloc(mode === "oversize" ? 2 * 1024 * 1024 + 1 : 4)]),
    };
  });
  await store.putIfAbsent("orders/test.pdf", Buffer.from("%PDF"));
  mode = "duplicate";
  await store.putIfAbsent("orders/test.pdf", Buffer.from("%PDF"));
  assert.equal((await store.read("orders/test.pdf")).length, 4);
  mode = "oversize";
  await assert.rejects(store.read("orders/test.pdf"), /Order document unavailable/);
  client.destroy();
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { S3Client, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { S3ProductImageStore } from "../../src/modules/products/s3-product-image.store.js";
import { S3OrderDocumentStore } from "../../src/post-purchase/s3-documents.js";

test(
  "live AWS: signed create-only product upload, exact version read, private idempotent PDF",
  { skip: process.env.AWS_STORAGE_INTEGRATION !== "true" },
  async () => {
    const client = new S3Client({ region: "ap-south-1" });
    const productBucket = "ecommerce-dev-products-201943655840-ap-south-1";
    const documentBucket = "ecommerce-dev-documents-201943655840-ap-south-1";
    const productId = randomUUID();
    const store = new S3ProductImageStore(client, productBucket, 60);
    const documentKey = `orders/${randomUUID()}/invoice-v1.pdf`;
    const owned: { Bucket: string; Key: string; VersionId: string }[] = [];
    try {
      const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      const upload = await store.createUpload(productId, {
        contentType: "image/png",
        size: bytes.length,
      });
      const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes });
      assert.equal(put.status, 200);
      const version = put.headers.get("x-amz-version-id");
      assert(version);
      owned.push({ Bucket: productBucket, Key: upload.objectName, VersionId: version });
      const overwrite = await fetch(upload.url, {
        method: "PUT",
        headers: upload.headers,
        body: bytes,
      });
      assert.equal(overwrite.status, 412);
      const image = await store.validate(productId, upload.objectName);
      assert.equal(image.generation, version);
      const download = await fetch((await store.readUrl(image)).url);
      assert.equal(download.status, 200);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
      const documents = new S3OrderDocumentStore(client, documentBucket);
      await documents.putIfAbsent(documentKey, Buffer.from("%PDF-fixture-original"));
      const metadata = await client.send(
        new HeadObjectCommand({ Bucket: documentBucket, Key: documentKey }),
      );
      assert(metadata.VersionId);
      owned.push({ Bucket: documentBucket, Key: documentKey, VersionId: metadata.VersionId });
      await documents.putIfAbsent(documentKey, Buffer.from("%PDF-fixture-overwrite"));
      assert.equal((await documents.read(documentKey)).toString(), "%PDF-fixture-original");
      assert.equal(metadata.CacheControl, "private,no-store");
    } finally {
      for (const object of owned) await client.send(new DeleteObjectCommand(object));
      client.destroy();
    }
  },
);

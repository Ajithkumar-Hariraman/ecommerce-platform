import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "../../errors/app-error.js";
import {
  imageUploadSchema,
  productImageSchema,
  imageObjectBelongsTo,
  matchesImageHeader,
} from "./product-image.js";
import type { ProductImageStore, ImageUploadInput, ProductImage } from "./product-image.js";

export class S3ProductImageStore implements ProductImageStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly ttlSeconds = 300,
  ) {}
  async createUpload(productId: string, input: ImageUploadInput) {
    const validated = imageUploadSchema.parse(input);
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[
      validated.contentType
    ];
    const objectName = `products/${productId.toLowerCase()}/${randomUUID()}.${extension}`;
    try {
      const url = await getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectName,
          ContentType: validated.contentType,
          ContentLength: validated.size,
          IfNoneMatch: "*",
          Metadata: { "expected-size": String(validated.size) },
        }),
        {
          expiresIn: this.ttlSeconds,
          signableHeaders: new Set(["content-type", "content-length", "if-none-match"]),
        },
      );
      return {
        url,
        objectName,
        headers: { "Content-Type": validated.contentType, "If-None-Match": "*" },
        expiresAt: new Date(Date.now() + this.ttlSeconds * 1000).toISOString(),
      };
    } catch {
      throw new AppError(503, "Product image upload unavailable");
    }
  }
  async validate(productId: string, objectName: string): Promise<ProductImage> {
    if (!imageObjectBelongsTo(productId, objectName))
      throw new AppError(400, "Invalid product image reference");
    try {
      const metadata = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectName }),
      );
      if (
        !metadata.VersionId ||
        metadata.VersionId === "null" ||
        metadata.Metadata?.["expected-size"] !== String(metadata.ContentLength)
      )
        throw new AppError(400, "Invalid uploaded image metadata");
      // Historical field name retained for API compatibility; on AWS this is an opaque S3 VersionId.
      const image = productImageSchema.parse({
        bucket: this.bucket,
        objectName,
        generation: metadata.VersionId,
        contentType: metadata.ContentType,
        size: metadata.ContentLength,
      });
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectName,
          VersionId: image.generation,
          Range: "bytes=0-31",
        }),
      );
      if (!response.Body) throw new Error();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > 32) throw new Error("Range response exceeds bound");
        chunks.push(Buffer.from(chunk));
      }
      if (!matchesImageHeader(image.contentType, Buffer.concat(chunks)))
        throw new AppError(400, "Uploaded image does not match its content type");
      return image;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(503, "Product image verification unavailable");
    }
  }
  async readUrl(image: ProductImage) {
    if (
      image.bucket !== this.bucket ||
      !imageObjectBelongsTo(image.objectName.split("/")[1] ?? "", image.objectName)
    )
      throw new AppError(400, "Invalid product image reference");
    try {
      return {
        url: await getSignedUrl(
          this.client,
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: image.objectName,
            VersionId: image.generation,
          }),
          { expiresIn: this.ttlSeconds },
        ),
        expiresAt: new Date(Date.now() + this.ttlSeconds * 1000).toISOString(),
      };
    } catch {
      throw new AppError(503, "Product image access unavailable");
    }
  }
}

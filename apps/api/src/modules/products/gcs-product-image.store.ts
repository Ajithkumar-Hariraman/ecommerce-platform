import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { GoogleAuth, Impersonated } from "google-auth-library";
import { AppError } from "../../errors/app-error.js";
import {
  imageUploadSchema,
  productImageSchema,
  imageObjectBelongsTo,
  matchesImageHeader,
} from "./product-image.js";
import type { ProductImageStore, ImageUploadInput, ProductImage } from "./product-image.js";

export async function createImageStorage(config: {
  projectId: string;
  signerServiceAccount: string;
}) {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const sourceClient = await auth.getClient();
  const authClient = new Impersonated({
    sourceClient,
    targetPrincipal: config.signerServiceAccount,
    targetScopes: ["https://www.googleapis.com/auth/devstorage.read_write"],
    lifetime: 600,
  });
  return new Storage({
    projectId: config.projectId,
    authClient,
    retryOptions: { totalTimeout: 10, maxRetries: 2 },
  });
}
export class GcsProductImageStore implements ProductImageStore {
  constructor(
    private readonly storage: Storage,
    private readonly bucketName: string,
    private readonly ttlSeconds = 300,
  ) {}
  async createUpload(productId: string, input: ImageUploadInput) {
    const validated = imageUploadSchema.parse(input);
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[
      validated.contentType
    ];
    const objectName = `products/${productId.toLowerCase()}/${randomUUID()}.${ext}`;
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000).toISOString();
    try {
      const [url] = await this.storage
        .bucket(this.bucketName)
        .file(objectName)
        .getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.parse(expiresAt),
          contentType: validated.contentType,
          extensionHeaders: {
            "content-length": String(validated.size),
            "x-goog-if-generation-match": "0",
          },
        });
      return {
        url,
        objectName,
        headers: { "Content-Type": validated.contentType, "x-goog-if-generation-match": "0" },
        expiresAt,
      };
    } catch {
      throw new AppError(503, "Product image upload unavailable");
    }
  }
  async validate(productId: string, objectName: string): Promise<ProductImage> {
    if (!imageObjectBelongsTo(productId, objectName))
      throw new AppError(400, "Invalid product image reference");
    try {
      const [metadata] = await this.storage.bucket(this.bucketName).file(objectName).getMetadata();
      const parsed = productImageSchema.safeParse({
        bucket: this.bucketName,
        objectName,
        generation: String(metadata.generation),
        contentType: metadata.contentType,
        size: Number(metadata.size),
      });
      if (!parsed.success) throw new AppError(400, "Invalid uploaded image metadata");
      const file = this.storage
        .bucket(this.bucketName)
        .file(objectName, { generation: parsed.data.generation });
      const bytes: Buffer[] = [];
      for await (const chunk of file.createReadStream({ start: 0, end: 31, validation: false }))
        bytes.push(Buffer.from(chunk));
      if (!matchesImageHeader(parsed.data.contentType, Buffer.concat(bytes)))
        throw new AppError(400, "Uploaded image does not match its content type");
      return parsed.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (typeof error === "object" && error && "code" in error && error.code === 404)
        throw new AppError(400, "Uploaded image not found");
      throw new AppError(503, "Product image verification unavailable");
    }
  }
  async readUrl(image: ProductImage) {
    if (image.bucket !== this.bucketName) throw new AppError(400, "Invalid product image bucket");
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000).toISOString();
    try {
      const [url] = await this.storage
        .bucket(this.bucketName)
        .file(image.objectName, { generation: image.generation })
        .getSignedUrl({ version: "v4", action: "read", expires: Date.parse(expiresAt) });
      return { url, expiresAt };
    } catch {
      throw new AppError(503, "Product image access unavailable");
    }
  }
}

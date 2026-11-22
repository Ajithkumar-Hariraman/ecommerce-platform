import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { AppError } from "../../errors/app-error.js";
import {
  imageObjectBelongsTo,
  matchesImageHeader,
  maximumImageBytes,
  type ImageUploadInput,
  type ProductImage,
  type ProductImageStore,
} from "./product-image.js";

const bucket = "local-product-images";
const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const ttl = 300_000;

export class LocalProductImageStore implements ProductImageStore {
  constructor(
    private readonly directory: string,
    private readonly secret: string,
  ) {}

  private path(objectName: string) {
    const id = objectName.split("/")[1] ?? "";
    if (!/^[0-9a-f-]{36}$/.test(id) || !imageObjectBelongsTo(id, objectName))
      throw new AppError(404, "Product image not found");
    return join(this.directory, objectName);
  }

  private signature(method: string, objectName: string, expires: string, size: string) {
    return createHmac("sha256", this.secret)
      .update(JSON.stringify([method, objectName, expires, size]))
      .digest("hex");
  }

  private capability(method: string, objectName: string, size: string) {
    const expires = String(Date.now() + ttl);
    const token = this.signature(method, objectName, expires, size);
    const query = new URLSearchParams({ objectName, expires, size, token });
    return {
      url: "/api/v1/local-product-image?" + query,
      expiresAt: new Date(Number(expires)).toISOString(),
    };
  }

  authorize(method: string, query: Record<string, unknown>) {
    const { objectName, expires, size, token } = query;
    if (
      typeof objectName !== "string" ||
      typeof expires !== "string" ||
      typeof size !== "string" ||
      typeof token !== "string" ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !/^\d+$/.test(expires) ||
      Number(expires) < Date.now() ||
      !timingSafeEqual(
        Buffer.from(token),
        Buffer.from(this.signature(method, objectName, expires, size)),
      )
    )
      throw new AppError(403, "Invalid or expired image link");
    return { objectName, size: Number(size) };
  }

  async createUpload(productId: string, input: ImageUploadInput) {
    const objectName = `products/${productId.toLowerCase()}/${randomUUID()}.${extensions[input.contentType]}`;
    return {
      ...this.capability("PUT", objectName, String(input.size)),
      objectName,
      headers: { "Content-Type": input.contentType },
    };
  }

  private contentType(objectName: string): ProductImage["contentType"] {
    const extension = objectName.split(".").at(-1);
    return extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
  }

  async upload(objectName: string, size: number, bytes: unknown, contentType: string | undefined) {
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length !== size ||
      size < 1 ||
      size > maximumImageBytes ||
      contentType !== this.contentType(objectName) ||
      !matchesImageHeader(contentType, bytes)
    )
      throw new AppError(400, "Invalid product image bytes");
    const path = this.path(objectName);
    await mkdir(dirname(path), { recursive: true });
    const pending = path + "." + randomUUID() + ".tmp";
    try {
      await writeFile(pending, bytes, { flag: "wx" });
      await link(pending, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new AppError(409, "Image upload already exists");
      throw error;
    } finally {
      await unlink(pending).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }

  async read(objectName: string) {
    try {
      return {
        bytes: await readFile(this.path(objectName)),
        contentType: this.contentType(objectName),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new AppError(404, "Product image not found");
      throw error;
    }
  }

  async validate(productId: string, objectName: string): Promise<ProductImage> {
    if (!imageObjectBelongsTo(productId, objectName))
      throw new AppError(400, "Invalid image reference");
    const { bytes, contentType } = await this.read(objectName);
    if (!matchesImageHeader(contentType, bytes)) throw new AppError(400, "Invalid image bytes");
    return {
      bucket,
      objectName,
      contentType,
      size: bytes.length,
      generation: basename(objectName),
    };
  }

  async readUrl(image: ProductImage) {
    if (image.bucket !== bucket) throw new AppError(404, "Product image not found");
    return this.capability("GET", image.objectName, "");
  }
}

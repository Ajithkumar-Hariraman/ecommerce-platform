import { z } from "zod";
export const imageContentTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export const maximumImageBytes = 5 * 1024 * 1024;
export const productImageSchema = z.strictObject({
  bucket: z.string().min(3),
  objectName: z.string().max(200),
  generation: z.string().regex(/^[0-9]+$/),
  contentType: z.enum(imageContentTypes),
  size: z.number().int().min(1).max(maximumImageBytes),
});
export type ProductImage = z.infer<typeof productImageSchema>;
export const imageUploadSchema = z.strictObject({
  contentType: z.enum(imageContentTypes),
  size: z.number().int().min(1).max(maximumImageBytes),
});
export type ImageUploadInput = z.infer<typeof imageUploadSchema>;
export interface ProductImageStore {
  createUpload(
    productId: string,
    input: ImageUploadInput,
  ): Promise<{
    url: string;
    objectName: string;
    headers: Record<string, string>;
    expiresAt: string;
  }>;
  validate(productId: string, objectName: string): Promise<ProductImage>;
  readUrl(image: ProductImage): Promise<{ url: string; expiresAt: string }>;
}
export function imageObjectBelongsTo(productId: string, name: string): boolean {
  return new RegExp(
    "^products/" + productId.toLowerCase() + "/[0-9a-f-]{36}\\.(jpg|png|webp)$",
  ).test(name);
}
export function matchesImageHeader(type: string, bytes: Buffer): boolean {
  if (type === "image/png")
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg")
    return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === "image/webp")
    return (
      bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"
    );
  return false;
}

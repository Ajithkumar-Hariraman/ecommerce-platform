import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { ProductImage } from "./product-image.js";
import { AppError } from "../../errors/app-error.js";

export const localCatalogDirectory = fileURLToPath(new URL("../../../assets/local-catalog/", import.meta.url));
export function localCatalogImageUrl(image: ProductImage): string {
  if (process.env.NODE_ENV !== "development" || image.bucket !== "local-catalog" ||
      !/^[0-9a-f-]{36}\.png$/.test(image.objectName) || image.contentType !== "image/png")
    throw new AppError(404, "Local catalog image unavailable");
  let bytes: Buffer;
  try { bytes = readFileSync(localCatalogDirectory + image.objectName); }
  catch { throw new AppError(404, "Local catalog image unavailable"); }
  if (bytes.length !== image.size || createHash("sha256").update(bytes).digest("hex") !== image.generation)
    throw new AppError(404, "Local catalog image unavailable");
  return "/api/local-catalog/" + image.objectName;
}

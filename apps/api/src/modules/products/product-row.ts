import { productImageSchema } from "./product-image.js";
import type { Product, ProductStatus } from "./product.js";

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category_id: string | null;
  image_asset?: unknown;
  // pg returns bigint as strings to avoid silently losing precision.
  price_in_minor_units: string;
  stock: string;
  status: ProductStatus;
  created_at: Date;
  updated_at: Date;
}

export function toProduct(row: ProductRow): Product {
  const price = Number(row.price_in_minor_units);
  const stock = Number(row.stock);
  if (!Number.isSafeInteger(price) || !Number.isSafeInteger(stock)) {
    throw new Error("Stored product integer exceeds domain precision");
  }
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    priceInMinorUnits: price,
    stock,
    status: row.status,
    categoryId: row.category_id,
    ...(row.image_asset == null ? {} : { image: productImageSchema.parse(row.image_asset) }),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

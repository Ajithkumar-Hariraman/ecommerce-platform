import type { ProductImage } from "./product-image.js";
export type ProductStatus = "ACTIVE" | "INACTIVE";

export interface Product {
  image?: ProductImage | undefined;
  id: string;
  sku: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  priceInMinorUnits: number;
  stock: number;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  status?: ProductStatus;
  sku: string;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  priceInMinorUnits: number;
  stock: number;
}

export type UpdateProductInput = Partial<CreateProductInput> & {
  status?: ProductStatus;
};

export type ProductStatus = "ACTIVE" | "INACTIVE";

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  priceInMinorUnits: number;
  stock: number;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  sku: string;
  name: string;
  description?: string | null;
  priceInMinorUnits: number;
  stock: number;
}

export type UpdateProductInput = Partial<CreateProductInput> & {
  status?: ProductStatus;
};

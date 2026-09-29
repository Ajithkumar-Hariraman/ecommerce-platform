export type ProductStatus = "ACTIVE" | "INACTIVE";
export interface Product { id: string; sku: string; name: string; description: string | null; categoryId: string | null; priceInMinorUnits: number; stock: number; status: ProductStatus; createdAt: string; updatedAt: string; }
export type CreateProductInput = Pick<Product, "sku" | "name" | "description" | "categoryId" | "priceInMinorUnits" | "stock">;
export type UpdateProductInput = Partial<CreateProductInput> & { status?: ProductStatus };

export interface ProductListResponse {
  products: Product[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

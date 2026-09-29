import type { Product, ProductStatus } from "./product.js";

export interface ProductListInput {
  status?: ProductStatus;
  page?: number;
  limit?: number;
}

export interface ProductListQuery {
  status?: ProductStatus;
  limit: number;
  offset: number;
}

export interface ProductListResult {
  products: Product[];
  total: number;
}

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

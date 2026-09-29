import { request } from "./http";
import type {
  Product,
  ProductStatus,
  ProductListResponse,
  CreateProductInput,
  UpdateProductInput,
} from "../features/products/product.types";
export const productsApi = {
  list: (status: ProductStatus | "ALL", page: number, signal?: AbortSignal) => {
    const query = new URLSearchParams({ page: String(page), limit: "20" });
    if (status !== "ALL") query.set("status", status);
    return request<ProductListResponse>(`/products?${query}`, { signal });
  },
  get: (id: string) => request<Product>(`/products/${encodeURIComponent(id)}`),
  create: (input: CreateProductInput) =>
    request<Product>("/products", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateProductInput) =>
    request<Product>(`/products/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/products/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

import { request } from "./http";
import type {
  Product,
  ProductStatus,
  CreateProductInput,
  UpdateProductInput,
} from "../features/products/product.types";
export const productsApi = {
  list: (status: ProductStatus | "ALL", signal?: AbortSignal) =>
    request<Product[]>(
      `/products${status === "ALL" ? "" : `?status=${status}`}`,
      { signal },
    ),
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

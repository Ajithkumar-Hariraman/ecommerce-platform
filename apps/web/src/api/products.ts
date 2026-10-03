import { request } from "./http";
import type {
  Product,
  ProductStatus,
  ProductListResponse,
  CreateProductInput,
  UpdateProductInput,
} from "../features/products/product.types";
export const productsApi = {
  uploadImage: async (id: string, file: File) => {
    const upload = await request<{
      url: string;
      objectName: string;
      headers: Record<string, string>;
    }>(`/products/${encodeURIComponent(id)}/image-upload`, {
      method: "POST",
      body: JSON.stringify({ contentType: file.type, size: file.size }),
    });
    // Signed capability goes directly to GCS; never attach the API Bearer token here.
    const response = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: file,
    });
    if (!response.ok) throw new Error("Image upload failed");
    return request<Product>(`/products/${encodeURIComponent(id)}/image`, {
      method: "PUT",
      body: JSON.stringify({ objectName: upload.objectName }),
    });
  },
  imageUrl: (id: string) =>
    request<{ url: string; expiresAt: string }>(`/products/${encodeURIComponent(id)}/image-url`),
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

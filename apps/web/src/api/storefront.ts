import { publicRequest } from "./http";
import type { Product, ProductListResponse } from "../features/products/product.types";
export const storefrontApi = {
  list: (page = 1, signal?: AbortSignal) =>
    publicRequest<ProductListResponse>(`/products?page=${page}&limit=12`, { signal }),
  get: (id: string, signal?: AbortSignal) =>
    publicRequest<Product>(`/products/${encodeURIComponent(id)}`, { signal }),
  imageUrl: (id: string) =>
    publicRequest<{ url: string; expiresAt: string }>(
      `/products/${encodeURIComponent(id)}/image-url`,
    ),
};

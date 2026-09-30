import type { Product } from "./product.js";
export interface ProductCache {
  get(productId: string): Promise<Product | null>;
  set(product: Product): Promise<void>;
  delete(productId: string): Promise<void>;
}

import type { Product, ProductStatus } from "./product.js";

// Adapters must enforce SKU uniqueness atomically on create/update.
// They return copies, never mutable references to stored records.
export interface ProductRepository {
  create(product: Product): Promise<Product>;
  findById(id: string): Promise<Product | null>;
  findBySku(sku: string): Promise<Product | null>;
  findByStatus(status: ProductStatus): Promise<Product[]>;
  findAll(): Promise<Product[]>;
  update(product: Product): Promise<Product | null>;
  deleteById(id: string): Promise<boolean>;
}

// Persistence conflict without an HTTP dependency. Service maps it to AppError.
export class DuplicateSkuError extends Error {
  constructor() {
    super("SKU already exists");
    this.name = "DuplicateSkuError";
  }
}

import type { ProductListQuery, ProductListResult } from "./product-list.types.js";
import type { Product, ProductStatus } from "./product.js";
import { DuplicateSkuError } from "./product.repository.js";
import type { ProductRepository } from "./product.repository.js";

export class InMemoryProductRepository implements ProductRepository {
  private readonly products = new Map<string, Product>();

  private assertUniqueSku(product: Product): void {
    for (const stored of this.products.values()) {
      if (stored.sku === product.sku && stored.id !== product.id) {
        throw new DuplicateSkuError();
      }
    }
  }

  async create(product: Product): Promise<Product> {
    if (this.products.has(product.id)) throw new Error("Product ID collision");
    // No await between the uniqueness check and write: atomic in this process.
    this.assertUniqueSku(product);
    this.products.set(product.id, { ...product });
    return { ...product };
  }

  async findById(id: string): Promise<Product | null> {
    const product = this.products.get(id);
    return product ? { ...product } : null;
  }

  async findByStatus(status: ProductStatus): Promise<Product[]> {
    return Array.from(this.products.values())
      .filter((product) => product.status === status)
      .map((product) => ({ ...product }));
  }

  async findBySku(sku: string): Promise<Product | null> {
    for (const product of this.products.values()) {
      if (product.sku === sku) return { ...product };
    }
    return null;
  }

  async list(query: ProductListQuery): Promise<ProductListResult> {
    const matches = Array.from(this.products.values())
      .filter(product => query.status === undefined || product.status === query.status)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
      total: matches.length,
      products: matches.slice(query.offset, query.offset + query.limit).map(product => ({ ...product })),
    };
  }

  async findAll(): Promise<Product[]> {
    return Array.from(this.products.values(), (product) => ({ ...product }));
  }

  async update(product: Product): Promise<Product | null> {
    if (!this.products.has(product.id)) return null;
    this.assertUniqueSku(product);
    this.products.set(product.id, { ...product });
    return { ...product };
  }

  async deleteById(id: string): Promise<boolean> {
    return this.products.delete(id);
  }
}

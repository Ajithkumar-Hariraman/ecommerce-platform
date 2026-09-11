import { InMemoryCategoryRepository } from "../../src/modules/categories/in-memory-category.repository.js";
import { createApp } from "../../src/app.js";
import { InMemoryProductRepository } from "../../src/modules/products/in-memory-product.repository.js";
export function createTestApp() {
  return createApp({ productRepository: new InMemoryProductRepository(), categoryRepository: new InMemoryCategoryRepository(), checkReady: async () => {} });
}

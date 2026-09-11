import type { CategoryRepository } from "../categories/category.repository.js";
import type { ProductRepository } from "./product.repository.js";
import { ProductService } from "./product.service.js";
import { ProductController } from "./product.controller.js";
import { createProductRouter } from "./product.routes.js";

// Composition root: one repository per application, shared across its requests.
export function createProductModule(repository: ProductRepository, categories: CategoryRepository) {
  const service = new ProductService(repository, categories);
  const controller = new ProductController(service);
  return createProductRouter(controller);
}

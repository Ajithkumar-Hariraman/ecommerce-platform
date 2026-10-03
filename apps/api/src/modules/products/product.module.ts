import type { ProductImageStore } from "./product-image.js";
import { ProductImageService } from "./product-image.service.js";
import { ProductImageController } from "./product-image.controller.js";
import type { ProductCache } from "./product.cache.js";
import type { CategoryRepository } from "../categories/category.repository.js";
import type { ProductRepository } from "./product.repository.js";
import { ProductService } from "./product.service.js";
import { ProductController } from "./product.controller.js";
import { createProductRouter } from "./product.routes.js";

import { ProductImportController } from "./import/product-import.controller.js";
import { ProductImportService } from "./import/product-import.service.js";

// Composition root: one repository per application, shared across its requests.
export function createProductModule(
  repository: ProductRepository,
  categories: CategoryRepository,
  cache?: ProductCache,
  images?: ProductImageStore,
) {
  const service = new ProductService(repository, categories, cache);
  const controller = new ProductController(service);

  const productImportService = new ProductImportService((input) => service.create(input));

  const productImportController = new ProductImportController(productImportService);

  return createProductRouter(
    controller,
    productImportController,
    new ProductImageController(new ProductImageService(service, images)),
  );
}

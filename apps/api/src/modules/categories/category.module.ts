import type { CategoryRepository } from "./category.repository.js";
import { CategoryService } from "./category.service.js";
import { CategoryController } from "./category.controller.js";
import { createCategoryRouter } from "./category.routes.js";

export function createCategoryModule(repository: CategoryRepository) {
  return createCategoryRouter(new CategoryController(new CategoryService(repository)));
}

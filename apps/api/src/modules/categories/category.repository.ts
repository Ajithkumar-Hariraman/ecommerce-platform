import type { Category } from "./category.js";

export interface CategoryRepository {
  create(category: Category): Promise<Category>;
  update(category: Category): Promise<Category | null>;
  deleteById(id: string): Promise<boolean>;
  findById(id: string): Promise<Category | null>;
  findBySlug(slug: string): Promise<Category | null>;
  findAll(): Promise<Category[]>;
}

export class DuplicateCategorySlugError extends Error {
  constructor() {
    super("Category slug already exists");
    this.name = "DuplicateCategorySlugError";
  }
}

import type { Category } from "./category.js";
import type { CategoryRepository } from "./category.repository.js";
import { DuplicateCategorySlugError } from "./category.repository.js";

export class InMemoryCategoryRepository implements CategoryRepository {
  private readonly categories = new Map<string, Category>();

  async create(category: Category): Promise<Category> {
    if (this.categories.has(category.id)) throw new Error("Category ID collision");
    for (const stored of this.categories.values()) {
      if (stored.slug === category.slug) throw new DuplicateCategorySlugError();
    }
    // No await between checking and writing: unique within this process.
    this.categories.set(category.id, { ...category });
    return { ...category };
  }

  async findById(id: string): Promise<Category | null> {
    const category = this.categories.get(id);
    return category ? { ...category } : null;
  }

  async findBySlug(slug: string): Promise<Category | null> {
    for (const category of this.categories.values()) {
      if (category.slug === slug) return { ...category };
    }
    return null;
  }

  async findAll(): Promise<Category[]> {
    return Array.from(this.categories.values(), (category) => ({ ...category }));
  }
}

import { randomUUID } from "node:crypto";
import { AppError } from "../../errors/app-error.js";
import type { CategoryRepository } from "./category.repository.js";
import { DuplicateCategorySlugError } from "./category.repository.js";
import type { Category, CreateCategoryInput } from "./category.js";

export class CategoryService {
  constructor(private readonly repository: CategoryRepository) {}

  async create(input: CreateCategoryInput): Promise<Category> {
    const slug = input.slug.trim();
    const name = input.name.trim();
    const status = input.status ?? "ACTIVE";
    if (!slug || !name) throw new AppError(400, "Category slug and name must not be empty");
    if (status !== "ACTIVE" && status !== "INACTIVE")
      throw new AppError(400, "Invalid category status");
    if (await this.repository.findBySlug(slug))
      throw new AppError(409, "Category slug already exists");
    const now = new Date().toISOString();
    try {
      return await this.repository.create({
        id: randomUUID(),
        slug,
        name,
        status,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error: unknown) {
      if (error instanceof DuplicateCategorySlugError)
        throw new AppError(409, "Category slug already exists");
      throw error;
    }
  }

  async update(id: string, input: CreateCategoryInput): Promise<Category> {
    const existing = await this.findById(id);
    const slug = input.slug.trim();
    const name = input.name.trim();
    if (!slug || !name) throw new AppError(400, "Category slug and name must not be empty");
    if (input.status !== undefined && input.status !== "ACTIVE" && input.status !== "INACTIVE")
      throw new AppError(400, "Invalid category status");
    try {
      const category = await this.repository.update({
        ...existing,
        slug,
        name,
        status: input.status ?? existing.status,
        updatedAt: new Date().toISOString(),
      });
      if (!category) throw new AppError(404, "Category not found");
      return category;
    } catch (error) {
      if (error instanceof DuplicateCategorySlugError)
        throw new AppError(409, "Category slug already exists");
      throw error;
    }
  }

  async deleteById(id: string): Promise<void> {
    if (!(await this.repository.deleteById(id))) throw new AppError(404, "Category not found");
  }

  async findAll(): Promise<Category[]> {
    return await this.repository.findAll();
  }

  async findById(id: string): Promise<Category> {
    const category = await this.repository.findById(id);
    if (!category) throw new AppError(404, "Category not found");
    return category;
  }
}

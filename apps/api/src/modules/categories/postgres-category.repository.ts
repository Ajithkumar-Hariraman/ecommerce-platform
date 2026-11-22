import { DatabaseError } from "pg";
import type { Pool } from "pg";
import { AppError } from "../../errors/app-error.js";
import type { Category } from "./category.js";
import type { CategoryRepository } from "./category.repository.js";
import { DuplicateCategorySlugError } from "./category.repository.js";
import { toCategory } from "./category-row.js";
import type { CategoryRow } from "./category-row.js";

const columns = "id, slug, name, status, created_at, updated_at";

export class PostgresCategoryRepository implements CategoryRepository {
  constructor(private readonly pool: Pool) {}

  private async rows(sql: string, values: unknown[] = []): Promise<CategoryRow[]> {
    try {
      return (await this.pool.query<CategoryRow>(sql, values)).rows;
    } catch (error: unknown) {
      if (error instanceof DatabaseError) {
        if (error.code === "23505" && error.constraint === "categories_slug_key") {
          throw new DuplicateCategorySlugError();
        }
        if (error.code === "23503")
          throw new AppError(409, "Remove this category from its products before deleting it");
        if (error.code === "23514" || error.code === "23502") {
          throw new AppError(400, "Category violates storage constraints");
        }
        console.error("Category database operation failed", {
          code: error.code,
          constraint: error.constraint,
        });
      }
      throw new Error("Category storage operation failed");
    }
  }

  async create(category: Category): Promise<Category> {
    const rows = await this.rows(
      `INSERT INTO public.categories (${columns})
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${columns}`,
      [
        category.id,
        category.slug,
        category.name,
        category.status,
        category.createdAt,
        category.updatedAt,
      ],
    );
    if (!rows[0]) throw new Error("Insert did not return a category");
    return toCategory(rows[0]);
  }

  async update(category: Category): Promise<Category | null> {
    const rows = await this.rows(
      `UPDATE public.categories SET slug=$2, name=$3, status=$4, updated_at=$5
       WHERE id=$1 RETURNING ${columns}`,
      [category.id, category.slug, category.name, category.status, category.updatedAt],
    );
    return rows[0] ? toCategory(rows[0]) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    return (
      (await this.rows(`DELETE FROM public.categories WHERE id=$1 RETURNING ${columns}`, [id]))
        .length > 0
    );
  }

  async findById(id: string): Promise<Category | null> {
    const rows = await this.rows(`SELECT ${columns} FROM public.categories WHERE id=$1`, [id]);
    return rows[0] ? toCategory(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<Category | null> {
    const rows = await this.rows(`SELECT ${columns} FROM public.categories WHERE slug=$1`, [slug]);
    return rows[0] ? toCategory(rows[0]) : null;
  }

  async findAll(): Promise<Category[]> {
    return (
      await this.rows(`SELECT ${columns} FROM public.categories ORDER BY created_at, id`)
    ).map(toCategory);
  }
}

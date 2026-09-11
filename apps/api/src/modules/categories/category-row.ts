import type { Category, CategoryStatus } from "./category.js";

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  status: CategoryStatus;
  created_at: Date;
  updated_at: Date;
}

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id, slug: row.slug, name: row.name, status: row.status,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

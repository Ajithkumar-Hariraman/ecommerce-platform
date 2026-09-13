export interface Category {
  id: string;
  slug: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  updatedAt: string;
}
export type CreateCategoryInput = Pick<Category, "slug" | "name" | "status">;

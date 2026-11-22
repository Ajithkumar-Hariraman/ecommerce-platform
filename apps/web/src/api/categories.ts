import { request } from "./http";
import type { Category, CreateCategoryInput } from "../features/categories/category.types";
export const categoriesApi = {
  list: (signal?: AbortSignal) => request<Category[]>("/categories", { signal }),
  get: (id: string) => request<Category>(`/categories/${encodeURIComponent(id)}`),
  update: (id: string, input: CreateCategoryInput) =>
    request<Category>(`/categories/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/categories/${encodeURIComponent(id)}`, { method: "DELETE" }),
  create: (input: CreateCategoryInput) =>
    request<Category>("/categories", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

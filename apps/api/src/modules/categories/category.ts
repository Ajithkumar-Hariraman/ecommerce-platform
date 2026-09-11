export type CategoryStatus = "ACTIVE" | "INACTIVE";

export interface Category {
  id: string;
  slug: string;
  name: string;
  status: CategoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryInput {
  slug: string;
  name: string;
  status?: CategoryStatus;
}

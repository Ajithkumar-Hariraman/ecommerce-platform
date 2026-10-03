import { MongoServerError, type Db } from "mongodb";
import type { Category } from "./category.js";
import {
  DuplicateCategorySlugError,
  type CategoryRepository,
} from "./category.repository.js";
type Document = Omit<Category, "id" | "createdAt" | "updatedAt"> & {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
};
function domain(value: Document): Category {
  const { _id, createdAt, updatedAt, ...fields } = value;
  return {
    ...fields,
    id: _id,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}
export class MongoCategoryRepository implements CategoryRepository {
  private readonly collection;
  constructor(db: Db) {
    this.collection = db.collection<Document>("categories");
  }
  async create(category: Category): Promise<Category> {
    const { id, createdAt, updatedAt, ...fields } = category;
    try {
      await this.collection.insertOne({
        ...fields,
        _id: id,
        createdAt: new Date(createdAt),
        updatedAt: new Date(updatedAt),
      });
    } catch (error) {
      if (
        error instanceof MongoServerError &&
        error.code === 11000 &&
        error.keyPattern?.slug
      )
        throw new DuplicateCategorySlugError();
      throw new Error("Category storage operation failed");
    }
    return { ...category };
  }
  async findById(id: string): Promise<Category | null> {
    const row = await this.collection.findOne({ _id: id });
    return row ? domain(row) : null;
  }
  async findBySlug(slug: string): Promise<Category | null> {
    const row = await this.collection.findOne({ slug });
    return row ? domain(row) : null;
  }
  async findAll(): Promise<Category[]> {
    return (
      await this.collection.find().sort({ createdAt: 1, _id: 1 }).toArray()
    ).map(domain);
  }
}
export async function ensureCategoryIndexes(db: Db): Promise<void> {
  await db
    .collection("categories")
    .createIndex({ slug: 1 }, { unique: true, name: "categories_slug_key" });
}

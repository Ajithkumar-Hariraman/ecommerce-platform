import { MongoServerError, type Db } from "mongodb";
import { withMongoCategoryWrite } from "../../database/mongo-category-writes.js";
import { AppError } from "../../errors/app-error.js";
import type { Category } from "./category.js";
import { DuplicateCategorySlugError, type CategoryRepository } from "./category.repository.js";
type Document = Omit<Category, "id" | "slug" | "createdAt" | "updatedAt"> & {
  slug: string | { deletedId: string };
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  deleted?: true;
};
function domain(value: Document): Category {
  const { _id, createdAt, updatedAt, slug, name, status } = value;
  if (typeof slug !== "string") throw new Error("Category storage returned an invalid slug");
  return {
    slug,
    name,
    status,
    id: _id,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}
export class MongoCategoryRepository implements CategoryRepository {
  private readonly collection;
  constructor(private readonly db: Db) {
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
      if (error instanceof MongoServerError && error.code === 11000 && error.keyPattern?.slug)
        throw new DuplicateCategorySlugError();
      throw new Error("Category storage operation failed");
    }
    return { ...category };
  }
  async update(category: Category): Promise<Category | null> {
    const { id, createdAt: _createdAt, updatedAt, ...fields } = category;
    try {
      const row = await this.collection.findOneAndUpdate(
        { _id: id, deleted: { $ne: true } },
        { $set: { ...fields, updatedAt: new Date(updatedAt) } },
        { returnDocument: "after" },
      );
      return row ? domain(row) : null;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000 && error.keyPattern?.slug)
        throw new DuplicateCategorySlugError();
      throw new Error("Category storage operation failed");
    }
  }

  async deleteById(id: string): Promise<boolean> {
    return withMongoCategoryWrite(this.db, id, async () => {
      if (
        await this.db.collection("products").findOne({ categoryId: id }, { projection: { _id: 1 } })
      )
        throw new AppError(409, "Remove this category from its products before deleting it");
      // Keep the ID resolvable in storage if a concurrent product write already passed its lookup.
      const result = await this.collection.updateOne(
        { _id: id, deleted: { $ne: true } },
        { $set: { deleted: true, slug: { deletedId: id } } },
      );
      return result.modifiedCount === 1;
    });
  }

  async findById(id: string): Promise<Category | null> {
    const row = await this.collection.findOne({ _id: id, deleted: { $ne: true } });
    return row ? domain(row) : null;
  }
  async findBySlug(slug: string): Promise<Category | null> {
    const row = await this.collection.findOne({ slug });
    return row ? domain(row) : null;
  }
  async findAll(): Promise<Category[]> {
    return (
      await this.collection
        .find({ deleted: { $ne: true } })
        .sort({ createdAt: 1, _id: 1 })
        .toArray()
    ).map(domain);
  }
}
export async function ensureCategoryIndexes(db: Db): Promise<void> {
  await db
    .collection("categories")
    .createIndex({ slug: 1 }, { unique: true, name: "categories_slug_key" });
}

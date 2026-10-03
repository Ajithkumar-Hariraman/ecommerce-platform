import { MongoServerError, type Db } from "mongodb";
import { AppError } from "../../errors/app-error.js";
import type { Product, ProductStatus } from "./product.js";
import type {
  ProductListQuery,
  ProductListResult,
} from "./product-list.types.js";
import {
  DuplicateSkuError,
  type ProductRepository,
} from "./product.repository.js";
type Document = Omit<Product, "id" | "createdAt" | "updatedAt"> & {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
};
function domain(value: Document): Product {
  const { _id, createdAt, updatedAt, ...fields } = value;
  return {
    ...fields,
    id: _id,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}
function document(product: Product): Document {
  const { id, createdAt, updatedAt, ...fields } = product;
  return {
    ...fields,
    _id: id,
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
  };
}
export class MongoProductRepository implements ProductRepository {
  private readonly collection;
  constructor(private readonly db: Db) {
    this.collection = db.collection<Document>("products");
  }
  private async categoryExists(product: Product): Promise<void> {
    if (
      product.categoryId !== null &&
      !(await this.db
        .collection<{ _id: string }>("categories")
        .findOne({ _id: product.categoryId }, { projection: { _id: 1 } }))
    )
      throw new AppError(400, "Referenced category does not exist");
  }
  private conflict(error: unknown): never {
    if (
      error instanceof MongoServerError &&
      error.code === 11000 &&
      error.keyPattern?.sku
    )
      throw new DuplicateSkuError();
    throw new Error("Product storage operation failed");
  }
  async create(product: Product): Promise<Product> {
    await this.categoryExists(product);
    try {
      await this.collection.insertOne(document(product));
    } catch (error) {
      this.conflict(error);
    }
    return { ...product };
  }
  async findById(id: string): Promise<Product | null> {
    const row = await this.collection.findOne({ _id: id });
    return row ? domain(row) : null;
  }
  async findBySku(sku: string): Promise<Product | null> {
    const row = await this.collection.findOne({ sku });
    return row ? domain(row) : null;
  }
  async findByStatus(status: ProductStatus): Promise<Product[]> {
    return (
      await this.collection
        .find({ status })
        .sort({ createdAt: 1, _id: 1 })
        .toArray()
    ).map(domain);
  }
  async findAll(): Promise<Product[]> {
    return (
      await this.collection.find().sort({ createdAt: 1, _id: 1 }).toArray()
    ).map(domain);
  }
  async list(query: ProductListQuery): Promise<ProductListResult> {
    const filter = query.status === undefined ? {} : { status: query.status };
    const total = await this.collection.countDocuments(filter);
    const rows = await this.collection
      .find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .skip(query.offset)
      .limit(query.limit)
      .toArray();
    return { products: rows.map(domain), total };
  }
  async update(product: Product): Promise<Product | null> {
    await this.categoryExists(product);
    const { _id, createdAt: _createdAt, ...fields } = document(product);
    try {
      const row = await this.collection.findOneAndUpdate(
        { _id },
        { $set: fields },
        { returnDocument: "after" },
      );
      return row ? domain(row) : null;
    } catch (error) {
      return this.conflict(error);
    }
  }
  async deleteById(id: string): Promise<boolean> {
    return (await this.collection.deleteOne({ _id: id })).deletedCount === 1;
  }
}
export async function ensureProductIndexes(db: Db): Promise<void> {
  await db
    .collection("products")
    .createIndex({ sku: 1 }, { unique: true, name: "products_sku_key" });
}

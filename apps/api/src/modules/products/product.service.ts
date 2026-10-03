import { productImageSchema } from "./product-image.js";
import type { ProductImage } from "./product-image.js";
import type { ProductCache } from "./product.cache.js";
import type {
  ProductListInput,
  ProductListQuery,
  ProductListResponse,
} from "./product-list.types.js";
import type { CategoryRepository } from "../categories/category.repository.js";
import { randomUUID } from "node:crypto";
import { AppError } from "../../errors/app-error.js";
import { DuplicateSkuError } from "./product.repository.js";
import type { ProductRepository } from "./product.repository.js";
import type { CreateProductInput, Product, ProductStatus, UpdateProductInput } from "./product.js";

export class ProductService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly categories: CategoryRepository,
    private readonly cache?: ProductCache,
  ) {}

  private validateFields(input: UpdateProductInput): UpdateProductInput {
    const fields: UpdateProductInput = {};
    if (input.categoryId !== undefined) fields.categoryId = input.categoryId;
    if (input.sku !== undefined) {
      fields.sku = input.sku.trim();
      if (!fields.sku) throw new AppError(400, "SKU must not be empty");
    }
    if (input.name !== undefined) {
      fields.name = input.name.trim();
      if (!fields.name) throw new AppError(400, "Name must not be empty");
    }
    if (input.description !== undefined) fields.description = input.description;
    if (input.priceInMinorUnits !== undefined) {
      if (!Number.isSafeInteger(input.priceInMinorUnits) || input.priceInMinorUnits <= 0) {
        throw new AppError(400, "Price must be a positive safe integer in minor units");
      }
      fields.priceInMinorUnits = input.priceInMinorUnits;
    }
    if (input.stock !== undefined) {
      if (!Number.isSafeInteger(input.stock) || input.stock < 0) {
        throw new AppError(400, "Stock must be a non-negative safe integer");
      }
      fields.stock = input.stock;
    }
    if (input.status !== undefined) {
      if (input.status !== "ACTIVE" && input.status !== "INACTIVE") {
        throw new AppError(400, "Status must be ACTIVE or INACTIVE");
      }
      fields.status = input.status;
    }
    return fields;
  }

  private async assertCategoryExists(categoryId: string | null | undefined): Promise<void> {
    if (categoryId != null && !(await this.categories.findById(categoryId))) {
      throw new AppError(400, "Referenced category does not exist");
    }
  }

  private async assertUniqueSku(sku: string, excludingId?: string): Promise<void> {
    const existing = await this.repository.findBySku(sku);
    if (existing && existing.id !== excludingId) {
      throw new AppError(409, "SKU already exists");
    }
  }

  // The read check gives a clear business flow; this catch handles write races.
  private async save(product: Product, creating: boolean): Promise<Product> {
    try {
      const saved = creating
        ? await this.repository.create(product)
        : await this.repository.update(product);
      if (!saved) throw new AppError(404, "Product not found");
      return saved;
    } catch (error: unknown) {
      if (error instanceof DuplicateSkuError) throw new AppError(409, "SKU already exists");
      throw error;
    }
  }

  async create(input: CreateProductInput): Promise<Product> {
    const fields = this.validateFields(input);
    if (
      fields.sku === undefined ||
      fields.name === undefined ||
      fields.priceInMinorUnits === undefined ||
      fields.stock === undefined
    ) {
      throw new AppError(400, "SKU, name, priceInMinorUnits, and stock are required");
    }
    await this.assertCategoryExists(fields.categoryId);
    await this.assertUniqueSku(fields.sku);
    const now = new Date().toISOString();
    return await this.save(
      {
        id: randomUUID(),
        sku: fields.sku,
        name: fields.name,
        description: fields.description ?? null,
        categoryId: fields.categoryId ?? null,
        priceInMinorUnits: fields.priceInMinorUnits,
        stock: fields.stock,
        status: fields.status ?? "ACTIVE",
        createdAt: now,
        updatedAt: now,
      },
      true,
    );
  }

  async list(input: ProductListInput = {}): Promise<ProductListResponse> {
    const page = input.page ?? 1;
    const limit = input.limit ?? 20;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new AppError(
        400,
        "Page must be a positive safe integer and limit must be between 1 and 100",
      );
    }
    if (input.status !== undefined && input.status !== "ACTIVE" && input.status !== "INACTIVE") {
      throw new AppError(400, "Status must be ACTIVE or INACTIVE");
    }
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(offset + limit)) {
      throw new AppError(400, "Requested page exceeds safe pagination bounds");
    }
    const query: ProductListQuery = { limit, offset };
    if (input.status !== undefined) query.status = input.status;
    const { products, total } = await this.repository.list(query);
    const totalPages = Math.ceil(total / limit);
    return {
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1 && total > 0,
      },
    };
  }

  async findAll(): Promise<Product[]> {
    return await this.repository.findAll();
  }

  async findById(id: string): Promise<Product> {
    const cached = await this.cache?.get(id);
    if (cached) return cached;
    const product = await this.repository.findById(id);
    if (!product) throw new AppError(404, "Product not found");
    await this.cache?.set(product);
    return product;
  }

  async findByStatus(status: ProductStatus): Promise<Product[]> {
    return await this.repository.findByStatus(status);
  }

  async update(id: string, input: UpdateProductInput): Promise<Product> {
    const fields = this.validateFields(input);
    if (Object.keys(fields).length === 0)
      throw new AppError(400, "Update must contain at least one field");
    const existing = await this.repository.findById(id);
    if (!existing) throw new AppError(404, "Product not found");
    await this.assertCategoryExists(fields.categoryId);
    if (fields.sku !== undefined) await this.assertUniqueSku(fields.sku, id);
    const saved = await this.save(
      {
        ...existing,
        ...fields,
        updatedAt: new Date().toISOString(),
      },
      false,
    );
    await this.cache?.delete(id);
    return saved;
  }

  async setImage(id: string, image: ProductImage): Promise<Product> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new AppError(404, "Product not found");
    const saved = await this.save(
      { ...existing, image: productImageSchema.parse(image), updatedAt: new Date().toISOString() },
      false,
    );
    await this.cache?.delete(id);
    return saved;
  }

  async deleteById(id: string): Promise<void> {
    if (!(await this.repository.deleteById(id))) throw new AppError(404, "Product not found");
    await this.cache?.delete(id);
  }
}

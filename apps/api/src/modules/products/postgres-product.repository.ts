import { DatabaseError } from "pg";
import type { Pool } from "pg";
import { AppError } from "../../errors/app-error.js";
import type { ProductRepository } from "./product.repository.js";
import { DuplicateSkuError } from "./product.repository.js";
import type { Product, ProductStatus } from "./product.js";
import { toProduct } from "./product-row.js";
import type { ProductRow } from "./product-row.js";

const columns =
  "id, sku, name, description, price_in_minor_units, stock, status, created_at, updated_at";

export class PostgresProductRepository implements ProductRepository {
  constructor(private readonly pool: Pool) {}

  private async rows(
    sql: string,
    values: unknown[] = [],
  ): Promise<ProductRow[]> {
    try {
      return (await this.pool.query<ProductRow>(sql, values)).rows;
    } catch (error: unknown) {
      if (error instanceof DatabaseError) {
        if (error.code === "23505" && error.constraint === "products_sku_key") {
          throw new DuplicateSkuError();
        }
        if (
          error.code === "23514" ||
          error.code === "23502" ||
          error.code === "22003"
        ) {
          throw new AppError(400, "Product violates storage constraints");
        }
        // Only metadata: never detail (which can contain submitted values).
        console.error("Product database operation failed", {
          code: error.code,
          constraint: error.constraint,
        });
      }
      throw new Error("Product storage operation failed");
    }
  }

  async create(product: Product): Promise<Product> {
    const rows = await this.rows(
      `INSERT INTO public.products (${columns})
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${columns}`,
      [
        product.id,
        product.sku,
        product.name,
        product.description,
        product.priceInMinorUnits,
        product.stock,
        product.status,
        product.createdAt,
        product.updatedAt,
      ],
    );
    if (!rows[0]) throw new Error("Insert did not return a product");
    return toProduct(rows[0]);
  }

  async findById(id: string): Promise<Product | null> {
    const rows = await this.rows(
      `SELECT ${columns} FROM public.products WHERE id = $1`,
      [id],
    );
    return rows[0] ? toProduct(rows[0]) : null;
  }

  async findByStatus(status: ProductStatus): Promise<Product[]> {
    const rows = await this.rows(
      `SELECT ${columns}
     FROM public.products
     WHERE status = $1
     ORDER BY created_at, id`,
      [status],
    );

    return rows.map(toProduct);
  }

  async findBySku(sku: string): Promise<Product | null> {
    const rows = await this.rows(
      `SELECT ${columns} FROM public.products WHERE sku = $1`,
      [sku],
    );
    return rows[0] ? toProduct(rows[0]) : null;
  }

  async findAll(): Promise<Product[]> {
    return (
      await this.rows(
        `SELECT ${columns} FROM public.products ORDER BY created_at, id`,
      )
    ).map(toProduct);
  }

  async update(product: Product): Promise<Product | null> {
    const rows = await this.rows(
      `UPDATE public.products SET sku=$2, name=$3, description=$4,
      price_in_minor_units=$5, stock=$6, status=$7, updated_at=$8
      WHERE id=$1 RETURNING ${columns}`,
      [
        product.id,
        product.sku,
        product.name,
        product.description,
        product.priceInMinorUnits,
        product.stock,
        product.status,
        product.updatedAt,
      ],
    );
    return rows[0] ? toProduct(rows[0]) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    return (
      (
        await this.rows(
          "DELETE FROM public.products WHERE id=$1 RETURNING id",
          [id],
        )
      ).length > 0
    );
  }
}

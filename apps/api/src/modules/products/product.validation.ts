import type { ProductListInput } from "./product-list.types.js";
import type { RequestHandler } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import type { CreateProductInput, UpdateProductInput } from "./product.js";

// Boundary schemas validate shape/types; service owns normalization and rules.
const createSchema = z.strictObject({
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  priceInMinorUnits: z.number(),
  stock: z.number(),
});
const updateSchema = createSchema.partial().extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

const positiveIntegerQuery = z.string().regex(/^[0-9]+$/).transform(Number)
  .refine(value => Number.isSafeInteger(value) && value >= 1);
const listQuerySchema = z.strictObject({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  page: positiveIntegerQuery.optional(),
  limit: positiveIntegerQuery.refine(value => value <= 100).optional(),
});

const idSchema = z.uuid();

function parse<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError(400, message);
  return result.data;
}

// Explicit projection drops absent optional keys, matching exactOptionalPropertyTypes.
export const validateCreate: RequestHandler = (req, res, next) => {
  const data = parse(createSchema, req.body, "Invalid product body");
  const input: CreateProductInput = {
    sku: data.sku,
    name: data.name,
    priceInMinorUnits: data.priceInMinorUnits,
    stock: data.stock,
  };
  if (data.description !== undefined) input.description = data.description;
  if (data.categoryId !== undefined) input.categoryId = data.categoryId;
  res.locals.productInput = input;
  next();
};

export const validateUpdate: RequestHandler = (req, res, next) => {
  const data = parse(updateSchema, req.body, "Invalid product update body");
  const input: UpdateProductInput = {};
  if (data.sku !== undefined) input.sku = data.sku;
  if (data.name !== undefined) input.name = data.name;
  if (data.description !== undefined) input.description = data.description;
  if (data.categoryId !== undefined) input.categoryId = data.categoryId;
  if (data.priceInMinorUnits !== undefined)
    input.priceInMinorUnits = data.priceInMinorUnits;
  if (data.stock !== undefined) input.stock = data.stock;
  if (data.status !== undefined) input.status = data.status;
  if (Object.keys(input).length === 0)
    throw new AppError(400, "Update must contain at least one field");
  res.locals.productInput = input;
  next();
};

export const validateId: RequestHandler = (req, res, next) => {
  res.locals.productId = parse(idSchema, req.params.id, "Invalid product ID");
  next();
};

export const validateListQuery: RequestHandler = (req, res, next) => {
  const query = parse(
    listQuerySchema,
    req.query,
    "Invalid product listing query",
  );

  const input: ProductListInput = {};
  if (query.status !== undefined) input.status = query.status;
  if (query.page !== undefined) input.page = query.page;
  if (query.limit !== undefined) input.limit = query.limit;
  res.locals.productListInput = input;
  next();
};

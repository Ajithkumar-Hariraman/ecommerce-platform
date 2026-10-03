import type { RequestHandler } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import type { CreateCategoryInput } from "./category.js";

export const createSchema = z.strictObject({
  slug: z.string(),
  name: z.string(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});
const idSchema = z.uuid();

export const validateCategoryCreate: RequestHandler = (req, res, next) => {
  const result = createSchema.safeParse(req.body);
  if (!result.success) throw new AppError(400, "Invalid category body");
  const input: CreateCategoryInput = { slug: result.data.slug, name: result.data.name };
  if (result.data.status !== undefined) input.status = result.data.status;
  res.locals.categoryInput = input;
  next();
};

export const validateCategoryId: RequestHandler = (req, res, next) => {
  const result = idSchema.safeParse(req.params.id);
  if (!result.success) throw new AppError(400, "Invalid category ID");
  res.locals.categoryId = result.data;
  next();
};

import { z } from "zod";

import type { ProductImportInput } from "./product-import.types.js";

const positiveSafeIntegerString = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value > 0, "must be a positive safe integer");

const nonNegativeSafeIntegerString = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .refine(
    (value) => Number.isSafeInteger(value) && value >= 0,
    "must be a non-negative safe integer",
  );

const nullableText = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}, z.string().nullable());

const nullableUuid = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}, z.string().uuid().nullable());

const statusSchema = z.preprocess(
  (value) => {
    if (
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "")
    ) {
      return "ACTIVE";
    }

    if (typeof value === "string") {
      return value.trim().toUpperCase();
    }

    return value;
  },
  z.enum(["ACTIVE", "INACTIVE"]),
);

const productImportRowSchema = z
  .object({
    sku: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: nullableText,
    priceInMinorUnits: positiveSafeIntegerString,
    stock: nonNegativeSafeIntegerString,
    status: statusSchema,
    categoryId: nullableUuid,
  })
  .strict();

export function parseProductImportRow(value: unknown): ProductImportInput {
  return productImportRowSchema.parse(value);
}

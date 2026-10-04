import { z } from "zod";
import type { Order } from "./order.types.js";
const positive = z
  .string()
  .regex(/^[0-9]+$/)
  .transform(Number)
  .refine((n) => Number.isSafeInteger(n) && n > 0);
export const orderListSchema = z.strictObject({
  page: positive.optional(),
  limit: positive.refine((n) => n <= 100).optional(),
  scope: z.enum(["mine", "all"]).optional(),
});
export type OrderListInput = { page?: number; limit?: number; scope?: "mine" | "all" };
export type OrderListQuery = { ownerSubject: string | null; offset: number; limit: number };
export type OrderListResult = { orders: Order[]; total: number };
export type OrderListResponse = {
  orders: Order[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};

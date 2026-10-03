import { z } from "zod";

export const createOrderSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        productId: z.uuid(),
        quantity: z.number().int().positive().max(2_147_483_647),
        unitPriceInMinorUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .min(1),
});

import type { RequestHandler } from "express";
import { AppError } from "../../errors/app-error.js";

export const validateCreateOrder: RequestHandler = (req, res, next) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, "Invalid order body");
  res.locals.orderInput = parsed.data;
  next();
};

export const validateOrderId: RequestHandler = (req, res, next) => {
  const parsed = z.uuid().safeParse(req.params.id);
  if (!parsed.success) throw new AppError(400, "Invalid order ID");
  res.locals.orderId = parsed.data;
  next();
};

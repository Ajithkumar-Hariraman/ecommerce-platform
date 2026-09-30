import { z } from "zod";

export const createOrderSchema = z.strictObject({
  customerId: z.uuid(),
  items: z.array(z.strictObject({
    productId: z.uuid(),
    quantity: z.number().int().positive().max(2_147_483_647),
    unitPriceInMinorUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })).min(1),
});

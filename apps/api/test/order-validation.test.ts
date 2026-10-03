import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createOrderSchema } from "../src/modules/orders/order.validation.js";

test("Order input is strict and accepts only bounded integer quantities and prices", () => {
  const input = {
    customerId: randomUUID(),
    items: [{ productId: randomUUID(), quantity: 1, unitPriceInMinorUnits: 0 }],
  };
  assert.deepEqual(createOrderSchema.parse(input), input);
  for (const bad of [
    { ...input, extra: true },
    { ...input, items: [] },
    { ...input, customerId: "bad" },
    ...[0, -1, 1.5, 2147483648].map((quantity) => ({
      ...input,
      items: [{ ...input.items[0], quantity }],
    })),
    ...[-1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((unitPriceInMinorUnits) => ({
      ...input,
      items: [{ ...input.items[0], unitPriceInMinorUnits }],
    })),
    { ...input, items: [{ ...input.items[0], extra: true }] },
  ])
    assert.equal(createOrderSchema.safeParse(bad).success, false);
});

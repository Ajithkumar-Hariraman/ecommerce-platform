import type { Db } from "mongodb";

export async function ensureOrderIndexes(db: Db): Promise<void> {
  const orders = db.collection("orders");

  await orders.createIndex(
    {
      customerId: 1,
      createdAt: -1,
    },
    {
      name: "orders_customer_created_idx",
    },
  );

  await orders.createIndex(
    {
      status: 1,
      createdAt: -1,
    },
    {
      name: "orders_status_created_idx",
    },
  );
}

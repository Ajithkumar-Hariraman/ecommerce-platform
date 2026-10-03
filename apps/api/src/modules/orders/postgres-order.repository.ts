import { AppError } from "../../errors/app-error.js";
import type { Pool, PoolClient } from "pg";

import type { OrderRepository } from "./order.repository.js";

import type { Order, OrderItem } from "./order.types.js";

interface OrderRow {
  id: string;
  customer_id: string | null;
  owner_subject: string | null;
  status: Order["status"];
  total_in_minor_units: string;
  payment_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface OrderItemRow {
  product_id: string;
  quantity: number;
  unit_price_in_minor_units: string;
  line_total_in_minor_units: string;
}

export class PostgresOrderRepository implements OrderRepository {
  constructor(private readonly pool: Pool) {}

  async save(order: Order): Promise<void> {
    const client = await this.pool.connect();

    let discard = false;
    try {
      await client.query("BEGIN");

      await client.query(
        `
          INSERT INTO orders (
            id,
            customer_id,
            owner_subject,
            status,
            total_in_minor_units,
            payment_id,
            version,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8, $9
          )
        `,
        [
          order.id,
          order.customerId,
          order.ownerSubject ?? null,
          order.status,
          order.totalInMinorUnits,
          order.paymentId,
          order.version,
          order.createdAt,
          order.updatedAt,
        ],
      );

      for (const item of order.items) {
        await this.insertItem(client, order.id, item);
      }

      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
        throw new Error("Order transaction rollback failed");
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }

  async findById(id: string): Promise<Order | null> {
    const orderResult = await this.pool.query<OrderRow>(
      `
          SELECT
            id,
            customer_id,
            owner_subject,
            status,
            total_in_minor_units,
            payment_id,
            version,
            created_at,
            updated_at
          FROM orders
          WHERE id = $1
        `,
      [id],
    );

    const row = orderResult.rows[0];

    if (!row) {
      return null;
    }

    const itemResult = await this.pool.query<OrderItemRow>(
      `
          SELECT
            product_id,
            quantity,
            unit_price_in_minor_units,
            line_total_in_minor_units
          FROM order_items
          WHERE order_id = $1
          ORDER BY id ASC
        `,
      [id],
    );

    return {
      id: row.id,

      customerId: row.customer_id,
      ...(row.owner_subject !== null ? { ownerSubject: row.owner_subject } : {}),

      items: itemResult.rows.map((item) => ({
        productId: item.product_id,

        quantity: item.quantity,

        unitPriceInMinorUnits: safeMoney(item.unit_price_in_minor_units),

        lineTotalInMinorUnits: safeMoney(item.line_total_in_minor_units),
      })),

      status: row.status,

      totalInMinorUnits: safeMoney(row.total_in_minor_units),

      paymentId: row.payment_id,

      version: row.version,

      createdAt: row.created_at.toISOString(),

      updatedAt: row.updated_at.toISOString(),
    };
  }

  async update(order: Order): Promise<void> {
    const result = await this.pool.query(
      `
          UPDATE orders
          SET
            status = $1,
            payment_id = $2,
            version = $3,
            updated_at = $4
          WHERE id = $5
            AND version = $6
        `,
      [order.status, order.paymentId, order.version, order.updatedAt, order.id, order.version - 1],
    );

    if (result.rowCount !== 1) {
      throw new AppError(409, "Order update conflict");
    }
  }

  private async insertItem(client: PoolClient, orderId: string, item: OrderItem): Promise<void> {
    await client.query(
      `
        INSERT INTO order_items (
          id,
          order_id,
          product_id,
          quantity,
          unit_price_in_minor_units,
          line_total_in_minor_units
        )
        VALUES (
          gen_random_uuid(),
          $1, $2, $3, $4, $5
        )
      `,
      [
        orderId,
        item.productId,
        item.quantity,
        item.unitPriceInMinorUnits,
        item.lineTotalInMinorUnits,
      ],
    );
  }
}

function safeMoney(value: string): number {
  if (!/^\d+$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Stored order money exceeds safe integer bounds");
  }
  return Number(value);
}

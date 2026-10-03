import type { Pool } from "pg";
import type { OrderPaid } from "./order-paid.js";
export class TransientProcessingError extends Error {}
export class PermanentProcessingError extends Error {}
export interface OrderNotificationRepository {
  process(event: OrderPaid): Promise<"processed" | "duplicate">;
}
export class PostgresOrderNotificationRepository implements OrderNotificationRepository {
  constructor(private readonly pool: Pool) {}
  async process(event: OrderPaid): Promise<"processed" | "duplicate"> {
    try {
      const inserted = await this.pool.query(
        `INSERT INTO order_notifications(event_id,order_id,payment_id,occurred_at)
        VALUES($1,$2,$3,$4) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,
        [event.eventId, event.aggregateId, event.payload.paymentId, event.occurredAt],
      );
      if (inserted.rowCount === 1) return "processed";
      const row = (
        await this.pool.query(
          "SELECT order_id,payment_id,occurred_at FROM order_notifications WHERE event_id=$1",
          [event.eventId],
        )
      ).rows[0];
      if (
        !row ||
        row.order_id !== event.aggregateId ||
        row.payment_id !== event.payload.paymentId ||
        new Date(row.occurred_at).getTime() !== Date.parse(event.occurredAt)
      )
        throw new PermanentProcessingError("Event identity conflict");
      return "duplicate";
    } catch (error) {
      if (error instanceof PermanentProcessingError) throw error;
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (
        /^(08|53|57P|40001|40P01|55P03|57014|ECONN|ETIMEDOUT|EPIPE|ENET)/.test(code) ||
        (error instanceof Error && /connection|timeout|terminated/i.test(error.message))
      )
        throw new TransientProcessingError("Notification storage unavailable");
      throw new PermanentProcessingError("Notification storage rejected event");
    }
  }
}

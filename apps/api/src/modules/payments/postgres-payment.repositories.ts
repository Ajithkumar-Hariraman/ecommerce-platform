import { orderPaid } from "../../events/order-paid.js";
import { insertPostgresOutbox } from "../../outbox/postgres-outbox.repository.js";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../errors/app-error.js";
import { webhookAudit } from "./payment-workflow.js";
import type {
  OrderAudit,
  OrderAuditRepository,
  PaymentEvent,
  PaymentWorkflowRepository,
  WebhookEventRepository,
} from "./payment-workflow.js";
import type { OrderStatus } from "../orders/order.types.js";

export class PostgresOrderAuditRepository implements OrderAuditRepository {
  constructor(private readonly client: PoolClient) {}
  async append(audit: OrderAudit): Promise<void> {
    await this.client.query(
      `INSERT INTO order_status_history(id,order_id,from_status,to_status,reason,changed_at)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [audit.id, audit.orderId, audit.fromStatus, audit.toStatus, audit.reason, audit.changedAt],
    );
  }
}
export class PostgresWebhookEventRepository implements WebhookEventRepository {
  constructor(private readonly client: PoolClient) {}
  async isProcessed(eventId: string): Promise<boolean> {
    return (
      (
        await this.client.query("SELECT event_id FROM processed_webhook_events WHERE event_id=$1", [
          eventId,
        ])
      ).rowCount === 1
    );
  }
  async record(eventId: string): Promise<void> {
    await this.client.query(
      "INSERT INTO processed_webhook_events(event_id,processed_at) VALUES($1,now())",
      [eventId],
    );
  }
}
export class PostgresPaymentWorkflowRepository implements PaymentWorkflowRepository {
  constructor(private readonly pool: Pool) {}
  async applyEvent(event: PaymentEvent): Promise<boolean> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN");
      // Serialize the same event even when delivered concurrently for different orders.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [event.eventId]);
      const events = new PostgresWebhookEventRepository(client);
      const applied = !(await events.isProcessed(event.eventId));
      if (applied) {
        const row = (
          await client.query<{
            status: OrderStatus;
            payment_id: string | null;
            version: number;
          }>("SELECT status,payment_id,version FROM orders WHERE id=$1 FOR UPDATE", [event.orderId])
        ).rows[0];
        if (!row) throw new AppError(404, "Order not found");
        const audit = webhookAudit(event, {
          status: row.status,
          paymentId: row.payment_id,
        });
        if (audit) {
          const updated = await client.query(
            "UPDATE orders SET status=$1,version=version+1,updated_at=$2 WHERE id=$3 AND version=$4",
            [audit.toStatus, audit.changedAt, event.orderId, row.version],
          );
          if (updated.rowCount !== 1) throw new AppError(409, "Order update conflict");
          await new PostgresOrderAuditRepository(client).append(audit);

          if (event.type === "payment.succeeded")
            await insertPostgresOutbox(client, orderPaid(event));
        }
        await events.record(event.eventId);
      }
      await client.query("COMMIT");
      return applied;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }
}

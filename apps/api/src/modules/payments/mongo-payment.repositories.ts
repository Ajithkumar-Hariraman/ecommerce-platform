import { orderPaid } from "../../events/order-paid.js";
import { pendingOutbox } from "../../outbox/outbox.js";
import type { OutboxEvent } from "../../outbox/outbox.js";
import { ensureOutboxIndex } from "../../outbox/mongo-outbox.repository.js";
import type { Db } from "mongodb";
import { AppError } from "../../errors/app-error.js";
import type { MongoOrderDocument } from "../orders/mongo-order.document.js";
import { webhookAudit } from "./payment-workflow.js";
import type {
  OrderAudit,
  OrderAuditRepository,
  PaymentEvent,
  PaymentWorkflowRepository,
  WebhookEventRepository,
} from "./payment-workflow.js";

type EventDocument = {
  _id: string;
  identity: string;
  processedAt: Date | null;
};
type Receipt = OrderAudit & { identity: string };
type OrderDocument = MongoOrderDocument & {
  paymentReceipt?: Receipt;
  outbox?: OutboxEvent;
};
export class MongoOrderAuditRepository implements OrderAuditRepository {
  constructor(private readonly db: Db) {}
  async append(audit: OrderAudit): Promise<void> {
    const { id, ...fields } = audit;
    await this.db
      .collection<Omit<OrderAudit, "id"> & { _id: string }>("order_status_history")
      .updateOne({ _id: id }, { $setOnInsert: fields }, { upsert: true });
  }
}
export class MongoWebhookEventRepository implements WebhookEventRepository {
  constructor(private readonly db: Db) {}
  async claim(event: PaymentEvent): Promise<void> {
    const identity = JSON.stringify(event);
    const collection = this.db.collection<EventDocument>("processed_webhook_events");
    try {
      await collection.updateOne(
        { _id: event.eventId },
        { $setOnInsert: { identity, processedAt: null } },
        { upsert: true },
      );
    } catch (error) {
      if (!(typeof error === "object" && error && "code" in error && error.code === 11000))
        throw error;
    }
    const record = await collection.findOne({ _id: event.eventId });
    if (record?.identity !== identity) throw new AppError(409, "Webhook event identity conflict");
  }
  async isProcessed(eventId: string): Promise<boolean> {
    return (
      (
        await this.db
          .collection<EventDocument>("processed_webhook_events")
          .findOne({ _id: eventId })
      )?.processedAt != null
    );
  }
  async record(eventId: string): Promise<void> {
    await this.db
      .collection<EventDocument>("processed_webhook_events")
      .updateOne({ _id: eventId }, { $set: { processedAt: new Date() } });
  }
}
export class MongoPaymentWorkflowRepository implements PaymentWorkflowRepository {
  constructor(private readonly db: Db) {}
  async applyEvent(event: PaymentEvent): Promise<boolean> {
    const events = new MongoWebhookEventRepository(this.db);
    await events.claim(event);
    if (await events.isProcessed(event.eventId)) return false;
    const collection = this.db.collection<OrderDocument>("orders");
    let order = await collection.findOne({ _id: event.orderId });
    if (!order) throw new AppError(404, "Order not found");
    let receipt = order.paymentReceipt;
    if (receipt?.id !== event.eventId) {
      if (receipt) {
        // Repair the previous attempt's projections before replacing its canonical receipt.
        const { identity: _previousIdentity, ...previousAudit } = receipt;
        await new MongoOrderAuditRepository(this.db).append(previousAudit);
        await events.record(receipt.id);
      }
      const audit = webhookAudit(event, order);
      if (!audit) {
        await events.record(event.eventId);
        return false;
      }
      const proposed: Receipt = { ...audit, identity: JSON.stringify(event) };
      const result = await collection.updateOne(
        {
          _id: event.orderId,
          version: order.version,
          status: order.status,
          paymentId: event.paymentId,
        },
        {
          $set: {
            status: audit.toStatus,
            updatedAt: audit.changedAt,
            paymentReceipt: proposed,
            ...(event.type === "payment.succeeded"
              ? { outbox: pendingOutbox(orderPaid(event), audit.changedAt) }
              : {}),
          },
          $inc: { version: 1 },
        },
      );
      if (result.matchedCount === 1) receipt = proposed;
      else {
        order = await collection.findOne({ _id: event.orderId });
        receipt = order?.paymentReceipt;
        if (receipt?.id !== event.eventId) throw new AppError(409, "Order update conflict");
      }
    }
    if (!receipt || receipt.identity !== JSON.stringify(event))
      throw new AppError(409, "Webhook event identity conflict");
    // Standalone Mongo: status + receipt are atomic. These idempotent projections
    // may lag after a crash; redelivery resumes here instead of transitioning again.
    const { identity: _identity, ...audit } = receipt;
    await new MongoOrderAuditRepository(this.db).append(audit);
    await events.record(event.eventId);
    return true;
  }
}
export async function ensurePaymentIndexes(db: Db): Promise<void> {
  await ensureOutboxIndex(db);
  await db
    .collection("order_status_history")
    .createIndex({ orderId: 1, changedAt: 1 }, { name: "order_history_order_changed_idx" });
  // createCollection preserves the built-in unique _id index without speculative indexes.
  if (!(await db.listCollections({ name: "processed_webhook_events" }).hasNext())) {
    try {
      await db.createCollection("processed_webhook_events");
    } catch (error) {
      if (!(typeof error === "object" && error && "code" in error && error.code === 48))
        throw error;
    }
  }
}

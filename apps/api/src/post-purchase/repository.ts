import type { Pool } from "pg";
import type { Db } from "mongodb";
export type CustomerNotification = {
  id: string;
  orderId: string;
  message: string;
  occurredAt: string;
};
export type DeliveryState = "SENDING" | "SENT" | "PENDING" | "UNCERTAIN" | "SKIPPED";
export interface PostPurchaseRepository {
  list(
    owner: string,
    offset: number,
    limit: number,
  ): Promise<{ notifications: CustomerNotification[]; total: number }>;
  claim(orderId: string, messageId: string): Promise<boolean>;
  state(orderId: string): Promise<DeliveryState | null>;
  finish(orderId: string, state: DeliveryState): Promise<void>;
  paidInfo(orderId: string): Promise<{ paidAt: string; providerPaymentId?: string } | null>;
}
export class PostgresPostPurchaseRepository implements PostPurchaseRepository {
  constructor(private readonly pool: Pool) {}
  async list(owner: string, offset: number, limit: number) {
    const total = Number(
      (
        await this.pool.query(
          "SELECT COUNT(*) AS total FROM order_notifications n JOIN orders o ON o.id=n.order_id WHERE o.owner_subject=$1",
          [owner],
        )
      ).rows[0].total,
    );
    const rows = (
      await this.pool.query(
        "SELECT n.event_id,n.order_id,n.occurred_at FROM order_notifications n JOIN orders o ON o.id=n.order_id WHERE o.owner_subject=$1 ORDER BY n.occurred_at DESC,n.event_id DESC LIMIT $2 OFFSET $3",
        [owner, limit, offset],
      )
    ).rows;
    return {
      total,
      notifications: rows.map((row) => ({
        id: row.event_id,
        orderId: row.order_id,
        message: "Payment received. Your order is confirmed.",
        occurredAt: row.occurred_at.toISOString(),
      })),
    };
  }
  async claim(id: string, messageId: string) {
    return (
      (
        await this.pool.query(
          "INSERT INTO order_email_deliveries(order_id,state,message_id) VALUES($1,'SENDING',$2) ON CONFLICT(order_id) DO UPDATE SET state='SENDING',claimed_at=now() WHERE order_email_deliveries.state='PENDING' RETURNING order_id",
          [id, messageId],
        )
      ).rowCount === 1
    );
  }
  async state(id: string) {
    return (
      (await this.pool.query("SELECT state FROM order_email_deliveries WHERE order_id=$1", [id]))
        .rows[0]?.state ?? null
    );
  }
  async finish(id: string, state: DeliveryState) {
    await this.pool.query(
      "UPDATE order_email_deliveries SET state=$2::varchar,sent_at=CASE WHEN $2::varchar='SENT' THEN now() ELSE sent_at END WHERE order_id=$1",
      [id, state],
    );
  }
  async paidInfo(id: string) {
    const row = (
      await this.pool.query(
        "SELECT changed_at FROM order_status_history WHERE order_id=$1 AND to_status='PAID' ORDER BY changed_at LIMIT 1",
        [id],
      )
    ).rows[0];
    if (!row) return null;
    const p = (
      await this.pool.query(
        "SELECT provider_payment_id FROM razorpay_payment_attempts WHERE order_id=$1 AND status='captured' ORDER BY updated_at,provider_payment_id LIMIT 1",
        [id],
      )
    ).rows[0];
    return {
      paidAt: row.changed_at.toISOString(),
      ...(p ? { providerPaymentId: p.provider_payment_id } : {}),
    };
  }
}
export class MongoPostPurchaseRepository implements PostPurchaseRepository {
  constructor(private readonly db: Db) {}
  async list(owner: string, offset: number, limit: number) {
    const result = await this.db
      .collection("order_notifications")
      .aggregate([
        { $lookup: { from: "orders", localField: "orderId", foreignField: "_id", as: "order" } },
        { $match: { "order.ownerSubject": owner } },
        { $sort: { occurredAt: -1, _id: -1 } },
        {
          $facet: {
            items: [
              { $skip: offset },
              { $limit: limit },
              { $project: { _id: 1, orderId: 1, occurredAt: 1 } },
            ],
            count: [{ $count: "total" }],
          },
        },
      ])
      .next();
    return {
      total: result?.count[0]?.total ?? 0,
      notifications: (result?.items ?? []).map((n: any) => ({
        id: n._id,
        orderId: n.orderId,
        message: "Payment received. Your order is confirmed.",
        occurredAt: n.occurredAt.toISOString(),
      })),
    };
  }
  async claim(id: string, messageId: string) {
    const c = this.db.collection<{
      _id: string;
      state: DeliveryState;
      messageId: string;
      claimedAt: Date;
      sentAt?: Date;
    }>("order_email_deliveries");
    try {
      await c.insertOne({ _id: id, state: "SENDING", messageId, claimedAt: new Date() });
      return true;
    } catch (e) {
      if (!(e && typeof e === "object" && "code" in e && e.code === 11000)) throw e;
    }
    return (
      (
        await c.updateOne(
          { _id: id, state: "PENDING" },
          { $set: { state: "SENDING", claimedAt: new Date() } },
        )
      ).modifiedCount === 1
    );
  }
  async state(id: string) {
    return (
      (
        await this.db
          .collection<{ _id: string; state: DeliveryState }>("order_email_deliveries")
          .findOne({ _id: id })
      )?.state ?? null
    );
  }
  async finish(id: string, state: DeliveryState) {
    await this.db
      .collection<{ _id: string; state: DeliveryState; sentAt?: Date }>("order_email_deliveries")
      .updateOne(
        { _id: id },
        { $set: { state, ...(state === "SENT" ? { sentAt: new Date() } : {}) } },
      );
  }
  async paidInfo(id: string) {
    const row = await this.db
      .collection("order_status_history")
      .findOne({ orderId: id, toStatus: "PAID" }, { sort: { changedAt: 1 } });
    if (!row) return null;
    const p = await this.db
      .collection("razorpay_payment_attempts")
      .findOne({ orderId: id, status: "captured" }, { sort: { updatedAt: 1, _id: 1 } });
    return {
      paidAt: row.changedAt.toISOString(),
      ...(p ? { providerPaymentId: p._id as unknown as string } : {}),
    };
  }
}

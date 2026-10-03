import {
  MongoServerError,
  MongoNetworkError,
  MongoServerSelectionError,
  type Db,
} from "mongodb";
import type { OrderPaid } from "./order-paid.js";
import {
  PermanentProcessingError,
  TransientProcessingError,
  type OrderNotificationRepository,
} from "./order-notification.repository.js";
type Notification = {
  _id: string;
  orderId: string;
  paymentId: string;
  occurredAt: Date;
  processedAt: Date;
};
export class MongoOrderNotificationRepository implements OrderNotificationRepository {
  constructor(private readonly db: Db) {}
  async process(event: OrderPaid): Promise<"processed" | "duplicate"> {
    const collection = this.db.collection<Notification>("order_notifications");
    try {
      try {
        await collection.insertOne({
          _id: event.eventId,
          orderId: event.aggregateId,
          paymentId: event.payload.paymentId,
          occurredAt: new Date(event.occurredAt),
          processedAt: new Date(),
        });
        return "processed";
      } catch (error) {
        if (!(error instanceof MongoServerError && error.code === 11000))
          throw error;
      }
      const row = await collection.findOne({ _id: event.eventId });
      if (
        !row ||
        row.orderId !== event.aggregateId ||
        row.paymentId !== event.payload.paymentId ||
        row.occurredAt.getTime() !== Date.parse(event.occurredAt)
      )
        throw new PermanentProcessingError("Event identity conflict");
      return "duplicate";
    } catch (error) {
      if (error instanceof PermanentProcessingError) throw error;
      if (
        error instanceof MongoNetworkError ||
        error instanceof MongoServerSelectionError ||
        (error instanceof MongoServerError &&
          ([6, 7, 89, 91, 189, 262, 9001, 10107, 11600, 11602, 13435].includes(
            Number(error.code),
          ) ||
            error.hasErrorLabel("RetryableWriteError")))
      )
        throw new TransientProcessingError("Notification storage unavailable");
      throw new PermanentProcessingError("Notification storage rejected event");
    }
  }
}
export async function ensureNotificationIndexes(db: Db): Promise<void> {
  await db
    .collection("order_notifications")
    .createIndex({ orderId: 1 }, { name: "order_notifications_order_idx" });
}

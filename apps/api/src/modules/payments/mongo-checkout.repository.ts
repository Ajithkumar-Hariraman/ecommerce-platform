import { randomUUID } from "node:crypto";
import { MongoServerError, type Db } from "mongodb";
import { AppError } from "../../errors/app-error.js";
import type {
  CheckoutMapping,
  CheckoutRepository,
  CheckoutSession,
} from "./checkout.repository.js";
type Mapping = Omit<CheckoutMapping, "order_id"> & {
  _id: string;
  createdAt: Date;
};
type Event = {
  _id: string;
  body_hash: string;
  processed: boolean;
  createdAt: Date;
};
type Attempt = {
  _id: string;
  orderId: string;
  status: string;
  updatedAt: Date;
};
type Lock = { _id: string; token: string; expiresAt: Date };
export class MongoCheckoutRepository implements CheckoutRepository {
  constructor(private readonly db: Db) {}
  async initialize(input: {
    orderId: string;
    paymentId: string;
    idempotencyKey: string;
    amount: number;
  }): Promise<void> {
    await this.db.collection<Mapping>("razorpay_checkouts").updateOne(
      { _id: input.orderId },
      {
        $setOnInsert: {
          payment_id: input.paymentId,
          idempotency_key: input.idempotencyKey,
          amount: String(input.amount),
          currency: "INR",
          provider_order_id: null,
          creation_started: false,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
  private domain(row: Mapping | null): CheckoutMapping | null {
    if (!row) return null;
    const { _id, createdAt: _created, ...fields } = row;
    return { ...fields, order_id: _id };
  }
  async findOrder(id: string): Promise<CheckoutMapping | null> {
    return this.domain(
      await this.db.collection<Mapping>("razorpay_checkouts").findOne({ _id: id }),
    );
  }
  async findProviderOrder(id: string): Promise<CheckoutMapping | null> {
    return this.domain(
      await this.db.collection<Mapping>("razorpay_checkouts").findOne({ provider_order_id: id }),
    );
  }
  async startCreation(id: string): Promise<boolean> {
    return (
      (
        await this.db
          .collection<Mapping>("razorpay_checkouts")
          .updateOne({ _id: id, creation_started: false }, { $set: { creation_started: true } })
      ).modifiedCount === 1
    );
  }
  async setProviderOrder(id: string, providerId: string): Promise<void> {
    const result = await this.db.collection<Mapping>("razorpay_checkouts").updateOne(
      {
        _id: id,
        $or: [{ provider_order_id: null }, { provider_order_id: providerId }],
      },
      { $set: { provider_order_id: providerId } },
    );
    if (result.matchedCount !== 1) throw new AppError(409, "Payment idempotency conflict");
  }
  async recordAttempt(
    paymentId: string,
    id: string,
    status: string,
    update: boolean,
  ): Promise<void> {
    const fields = { orderId: id, status, updatedAt: new Date() };
    await this.db
      .collection<Attempt>("razorpay_payment_attempts")
      .updateOne({ _id: paymentId }, update ? { $set: fields } : { $setOnInsert: fields }, {
        upsert: true,
      });
  }
  async claimEvent(id: string, hash: string): Promise<{ body_hash: string; processed: boolean }> {
    const c = this.db.collection<Event>("razorpay_webhook_events");
    try {
      await c.updateOne(
        { _id: id },
        {
          $setOnInsert: {
            body_hash: hash,
            processed: false,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
    }
    const row = await c.findOne({ _id: id });
    if (!row) throw new Error("Webhook storage operation failed");
    return row;
  }
  async completeEvent(id: string): Promise<void> {
    await this.db
      .collection<Event>("razorpay_webhook_events")
      .updateOne({ _id: id }, { $set: { processed: true } });
  }
  async locked<T>(id: string, action: (session: CheckoutSession) => Promise<T>): Promise<T> {
    const locks = this.db.collection<Lock>("razorpay_operation_locks");
    const token = randomUUID();
    try {
      await locks.updateOne(
        { _id: id, expiresAt: { $lte: new Date() } },
        { $set: { token, expiresAt: new Date(Date.now() + 60000) } },
        { upsert: true },
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000)
        throw new AppError(409, "Payment operation in progress; retry shortly");
      throw error;
    }
    // Check ownership and renew before each persistence operation. Creation intent is
    // additionally compare-and-set, so an expired/crashed holder never repeats HTTPS POST.
    const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
      const result = await locks.updateOne(
        { _id: id, token, expiresAt: { $gt: new Date() } },
        { $set: { expiresAt: new Date(Date.now() + 60000) } },
      );
      if (result.matchedCount !== 1)
        throw new AppError(409, "Payment operation lease expired; retry shortly");
      return operation();
    };
    const session: CheckoutSession = {
      initialize: (input) => guarded(() => this.initialize(input)),
      findOrder: (orderId) => guarded(() => this.findOrder(orderId)),
      startCreation: (orderId) => guarded(() => this.startCreation(orderId)),
      setProviderOrder: (orderId, providerId) =>
        guarded(() => this.setProviderOrder(orderId, providerId)),
      recordAttempt: (paymentId, orderId, status, update) =>
        guarded(() => this.recordAttempt(paymentId, orderId, status, update)),
      claimEvent: (eventId, hash) => guarded(() => this.claimEvent(eventId, hash)),
      completeEvent: (eventId) => guarded(() => this.completeEvent(eventId)),
    };
    try {
      return await action(session);
    } finally {
      await locks.deleteOne({ _id: id, token });
    }
  }
}
export async function ensureCheckoutIndexes(db: Db): Promise<void> {
  const c = db.collection("razorpay_checkouts");
  await c.createIndex({ payment_id: 1 }, { unique: true, name: "checkout_payment_key" });
  await c.createIndex({ idempotency_key: 1 }, { unique: true, name: "checkout_idempotency_key" });
  await c.createIndex(
    { provider_order_id: 1 },
    {
      unique: true,
      partialFilterExpression: { provider_order_id: { $type: "string" } },
      name: "checkout_provider_key",
    },
  );
  await db
    .collection("razorpay_payment_attempts")
    .createIndex({ orderId: 1 }, { name: "checkout_attempts_order_idx" });
}

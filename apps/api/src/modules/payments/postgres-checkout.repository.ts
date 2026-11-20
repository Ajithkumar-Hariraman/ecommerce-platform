import type { Pool, PoolClient } from "pg";
import { AppError } from "../../errors/app-error.js";
import type {
  CheckoutMapping,
  CheckoutRepository,
  CheckoutSession,
} from "./checkout.repository.js";
class Session implements CheckoutSession {
  constructor(protected readonly db: Pick<Pool, "query">) {}
  async initialize(input: {
    orderId: string;
    paymentId: string;
    idempotencyKey: string;
    amount: number;
  }): Promise<void> {
    await this.db.query(
      "INSERT INTO razorpay_checkouts(order_id,payment_id,idempotency_key,amount,currency) VALUES($1,$2,$3,$4,'INR') ON CONFLICT(order_id) DO NOTHING",
      [input.orderId, input.paymentId, input.idempotencyKey, input.amount],
    );
  }
  async findOrder(id: string): Promise<CheckoutMapping | null> {
    return (
      (
        await this.db.query<CheckoutMapping>("SELECT * FROM razorpay_checkouts WHERE order_id=$1", [
          id,
        ])
      ).rows[0] ?? null
    );
  }
  async startCreation(id: string): Promise<boolean> {
    return (
      (
        await this.db.query(
          "UPDATE razorpay_checkouts SET creation_started=true WHERE order_id=$1 AND creation_started=false",
          [id],
        )
      ).rowCount === 1
    );
  }
  async setProviderOrder(id: string, providerId: string): Promise<void> {
    await this.db.query("UPDATE razorpay_checkouts SET provider_order_id=$2 WHERE order_id=$1", [
      id,
      providerId,
    ]);
  }
  async recordAttempt(
    paymentId: string,
    id: string,
    status: string,
    update: boolean,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO razorpay_payment_attempts(provider_payment_id,order_id,status) VALUES($1,$2,$3) ON CONFLICT(provider_payment_id) ${update ? "DO UPDATE SET status=EXCLUDED.status,updated_at=now() WHERE razorpay_payment_attempts.status<>'captured'" : "DO NOTHING"}`,
      [paymentId, id, status],
    );
  }
  async claimEvent(id: string, hash: string): Promise<{ body_hash: string; processed: boolean }> {
    await this.db.query(
      "INSERT INTO razorpay_webhook_events(provider_event_id,body_hash) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [id, hash],
    );
    return (
      await this.db.query(
        "SELECT body_hash,processed FROM razorpay_webhook_events WHERE provider_event_id=$1",
        [id],
      )
    ).rows[0];
  }
  async completeEvent(id: string): Promise<void> {
    await this.db.query(
      "UPDATE razorpay_webhook_events SET processed=true WHERE provider_event_id=$1",
      [id],
    );
  }
}
export class PostgresCheckoutRepository extends Session implements CheckoutRepository {
  constructor(private readonly pool: Pool) {
    super(pool);
  }
  async findProviderOrder(id: string): Promise<CheckoutMapping | null> {
    return (
      (
        await this.pool.query<CheckoutMapping>(
          "SELECT * FROM razorpay_checkouts WHERE provider_order_id=$1",
          [id],
        )
      ).rows[0] ?? null
    );
  }
  async locked<T>(id: string, action: (session: CheckoutSession) => Promise<T>): Promise<T> {
    const db: PoolClient = await this.pool.connect();
    let locked = false;
    let discard = false;
    try {
      locked = (
        await db.query("SELECT pg_try_advisory_lock(hashtextextended($1,7)) AS locked", [id])
      ).rows[0].locked;
      if (!locked) throw new AppError(409, "Payment operation in progress; retry shortly");
      return await action(new Session(db));
    } finally {
      if (locked)
        try {
          await db.query("SELECT pg_advisory_unlock(hashtextextended($1,7))", [id]);
        } catch {
          discard = true;
        }
      db.release(discard);
    }
  }
}

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { OrderPaid } from "../events/order-paid.js";
import type { ClaimOptions, OutboxClaim, OutboxRepository } from "./outbox.js";
export async function insertPostgresOutbox(client: PoolClient, event: OrderPaid): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events(id,event_id,event_type,event_version,aggregate_type,aggregate_id,occurred_at,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      randomUUID(),
      event.eventId,
      event.eventType,
      event.eventVersion,
      event.aggregateType,
      event.aggregateId,
      event.occurredAt,
      JSON.stringify(event.payload),
    ],
  );
}
export class PostgresOutboxRepository implements OutboxRepository {
  readonly storageBackend = "postgres" as const;
  constructor(private readonly pool: Pool) {}
  async claimBatch(options: ClaimOptions): Promise<OutboxClaim[]> {
    await this.pool.query(
      `UPDATE outbox_events SET status='FAILED',lease_token=NULL,last_error_category='LEASE_EXHAUSTED'
      WHERE status IN ('PENDING','PROCESSING') AND available_at<=now() AND attempts >= $1`,
      [options.maxAttempts],
    );
    // A single statement is a short implicit transaction; locks end before network publication.
    const rows = (
      await this.pool.query(
        `WITH candidates AS (
      SELECT id FROM outbox_events WHERE status IN ('PENDING','PROCESSING') AND available_at<=now() AND attempts<$3
      ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT $1
    ) UPDATE outbox_events o SET status='PROCESSING',attempts=o.attempts+1,lease_token=$4,
      available_at=clock_timestamp()+$2 * interval '1 millisecond'
      FROM candidates c WHERE o.id=c.id RETURNING o.*`,
        [options.batchSize, options.leaseMs, options.maxAttempts, randomUUID()],
      )
    ).rows;
    return rows.map((row) => ({
      id: row.id,
      event: {
        eventId: row.event_id,
        eventType: row.event_type,
        eventVersion: row.event_version,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        occurredAt: row.occurred_at.toISOString(),
        payload: row.payload,
      },
      status: row.status,
      attempts: row.attempts,
      availableAt: row.available_at,
      createdAt: row.created_at,
      publishedAt: row.published_at,
      lastErrorCategory: row.last_error_category,
      leaseToken: row.lease_token,
    }));
  }
  async markPublished(claim: OutboxClaim): Promise<boolean> {
    return (
      (
        await this.pool.query(
          `UPDATE outbox_events SET status='PUBLISHED',published_at=now(),lease_token=NULL,last_error_category=NULL
      WHERE id=$1 AND status='PROCESSING' AND lease_token=$2`,
          [claim.id, claim.leaseToken],
        )
      ).rowCount === 1
    );
  }
  async markFailed(
    claim: OutboxClaim,
    category: "KAFKA_UNAVAILABLE" | "PUBSUB_UNAVAILABLE" | "SNS_UNAVAILABLE" | "INVALID_EVENT",
    retryMs: number,
    maxAttempts: number,
  ): Promise<boolean> {
    return (
      (
        await this.pool.query(
          `UPDATE outbox_events SET status=CASE WHEN attempts >= $4 OR $3='INVALID_EVENT' THEN 'FAILED' ELSE 'PENDING' END,
      available_at=clock_timestamp()+$5 * interval '1 millisecond',lease_token=NULL,last_error_category=$3
      WHERE id=$1 AND status='PROCESSING' AND lease_token=$2`,
          [claim.id, claim.leaseToken, category, maxAttempts, retryMs],
        )
      ).rowCount === 1
    );
  }
}

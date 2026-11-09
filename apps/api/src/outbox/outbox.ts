import { randomUUID } from "node:crypto";
import type { OrderPaid } from "../events/order-paid.js";
export type OutboxStatus = "PENDING" | "PROCESSING" | "PUBLISHED" | "FAILED";
export interface OutboxEvent {
  id: string;
  event: OrderPaid;
  status: OutboxStatus;
  attempts: number;
  availableAt: Date;
  createdAt: Date;
  publishedAt: Date | null;
  lastErrorCategory: string | null;
  leaseToken: string | null;
}
export interface OutboxClaim extends OutboxEvent {
  leaseToken: string;
}
export interface ClaimOptions {
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
}
export interface OutboxRepository {
  readonly storageBackend: "postgres" | "mongodb";
  claimBatch(options: ClaimOptions): Promise<OutboxClaim[]>;
  markPublished(claim: OutboxClaim): Promise<boolean>;
  markFailed(
    claim: OutboxClaim,
    category: "KAFKA_UNAVAILABLE" | "PUBSUB_UNAVAILABLE" | "SNS_UNAVAILABLE" | "INVALID_EVENT",
    retryMs: number,
    maxAttempts: number,
  ): Promise<boolean>;
}
export function pendingOutbox(event: OrderPaid, now = new Date()): OutboxEvent {
  return {
    id: randomUUID(),
    event,
    status: "PENDING",
    attempts: 0,
    availableAt: now,
    createdAt: now,
    publishedAt: null,
    lastErrorCategory: null,
    leaseToken: null,
  };
}
export function retryDelay(attempt: number): number {
  return Math.min(60000, 1000 * 2 ** Math.min(16, Math.max(0, attempt - 1)));
}

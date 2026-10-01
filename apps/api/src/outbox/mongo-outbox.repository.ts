import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { MongoOrderDocument } from "../modules/orders/mongo-order.document.js";
import type { ClaimOptions, OutboxClaim, OutboxEvent, OutboxRepository } from "./outbox.js";
export type OutboxOrderDocument = MongoOrderDocument & {outbox?: OutboxEvent};
export async function ensureOutboxIndex(db: Db): Promise<void> {
  await db.collection("orders").createIndex({"outbox.status":1,"outbox.availableAt":1,"outbox.createdAt":1},
    {name:"order_outbox_dispatch_idx",partialFilterExpression:{"outbox.id":{$exists:true}}});
}
export class MongoOutboxRepository implements OutboxRepository {
  readonly storageBackend = "mongodb" as const;
  constructor(private readonly db: Db) {}
  async claimBatch(options: ClaimOptions): Promise<OutboxClaim[]> {
    const collection = this.db.collection<OutboxOrderDocument>("orders");
    await collection.updateMany({"outbox.status":{$in:["PENDING","PROCESSING"]},"outbox.attempts":{$gte:options.maxAttempts},
      $expr:{$lte:["$outbox.availableAt","$$NOW"]}}, {$set:{"outbox.status":"FAILED","outbox.leaseToken":null,"outbox.lastErrorCategory":"LEASE_EXHAUSTED"}});
    const claims: OutboxClaim[] = [];
    for (let i=0;i<options.batchSize;i++) {
      const token = randomUUID();
      const document = await collection.findOneAndUpdate({"outbox.status":{$in:["PENDING","PROCESSING"]},"outbox.attempts":{$lt:options.maxAttempts},
        $expr:{$lte:["$outbox.availableAt","$$NOW"]}}, [{$set:{"outbox.status":"PROCESSING","outbox.leaseToken":token,
          "outbox.attempts":{$add:["$outbox.attempts",1]},"outbox.availableAt":{$dateAdd:{startDate:"$$NOW",unit:"millisecond",amount:options.leaseMs}}}}],
        {returnDocument:"after",sort:{"outbox.availableAt":1,"outbox.createdAt":1},projection:{outbox:1}});
      if (!document?.outbox) break;
      claims.push({...document.outbox,leaseToken:token});
    }
    return claims;
  }
  async markPublished(claim: OutboxClaim): Promise<boolean> {
    const result = await this.db.collection<OutboxOrderDocument>("orders").updateOne({"outbox.id":claim.id,"outbox.status":"PROCESSING","outbox.leaseToken":claim.leaseToken},
      {$set:{"outbox.status":"PUBLISHED","outbox.leaseToken":null,"outbox.lastErrorCategory":null},$currentDate:{"outbox.publishedAt":true}});
    return result.matchedCount === 1;
  }
  async markFailed(claim: OutboxClaim, category: "KAFKA_UNAVAILABLE" | "INVALID_EVENT", retryMs: number, maxAttempts: number): Promise<boolean> {
    const result = await this.db.collection<OutboxOrderDocument>("orders").updateOne({"outbox.id":claim.id,"outbox.status":"PROCESSING","outbox.leaseToken":claim.leaseToken},
      [{$set:{"outbox.status":claim.attempts>=maxAttempts || category==="INVALID_EVENT"?"FAILED":"PENDING",
        "outbox.leaseToken":null,"outbox.lastErrorCategory":category,"outbox.availableAt":{$dateAdd:{startDate:"$$NOW",unit:"millisecond",amount:retryMs}}}}]);
    return result.matchedCount === 1;
  }
}

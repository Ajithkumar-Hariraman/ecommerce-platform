import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pendingOutbox, retryDelay } from "../src/outbox/outbox.js";
import type { OutboxClaim, OutboxRepository } from "../src/outbox/outbox.js";
import { OutboxRelay } from "../src/outbox/outbox-relay.js";
import { orderPaid } from "../src/events/order-paid.js";
import { loadEnv, loadOutboxConfig } from "../src/config/env.js";
const event = () => orderPaid({eventId:randomUUID(),orderId:randomUUID(),paymentId:randomUUID(),type:"payment.succeeded",occurredAt:new Date().toISOString()});
test("outbox contract retains stable event identity and bounded backoff", () => {
 const e=event();const row=pendingOutbox(e);assert.equal(row.event.eventId,e.eventId);assert.equal(row.status,"PENDING");assert.equal(row.attempts,0);assert.equal(row.publishedAt,null);
 assert.deepEqual([1,2,3,4,100].map(retryDelay),[1000,2000,4000,8000,60000]);
});
test("relay success, retry, poison and acknowledgement failure preserve durable semantics", async t => {
 let row:OutboxClaim={...pendingOutbox(event()),status:"PROCESSING",attempts:1,leaseToken:randomUUID()};let offered=false;let fail=false;let ackError=false;
 const sent:string[]=[];const outcomes:unknown[]=[];
 const repository:OutboxRepository={storageBackend:"postgres",async claimBatch(){if(offered)return [];offered=true;return [row];},async markPublished(){if(ackError)throw new Error("DB down");outcomes.push("PUBLISHED");return true;},async markFailed(claim,category,delay,max){outcomes.push({category,delay,failed:claim.attempts>=max});return true;}};
 const relay=new OutboxRelay(repository,{async publish(e){sent.push(e.eventId);if(fail)throw new Error("private-secret");}},{batchSize:2,leaseMs:30000,maxAttempts:2});
 await t.test("success marks published",async()=>{await relay.runOnce();assert.deepEqual(outcomes,["PUBLISHED"]);});
 await t.test("failed send retries same ID and uses attempt backoff",async()=>{offered=false;fail=true;row={...row,attempts:2};await relay.runOnce();assert.deepEqual(outcomes.at(-1),{category:"KAFKA_UNAVAILABLE",delay:2000,failed:true});assert.equal(new Set(sent).size,1);assert.ok(!JSON.stringify(outcomes).includes("private-secret"));});
 await t.test("invalid stored contract is retained as poison, never published",async()=>{offered=false;const previous=sent.length;row={...row,event:{...row.event,eventVersion:2 as 1}};await relay.runOnce();assert.equal(sent.length,previous);assert.equal((outcomes.at(-1) as any).category,"INVALID_EVENT");});
 await t.test("send followed by DB acknowledgement failure leaves claim for recovery",async()=>{offered=false;fail=false;ackError=true;row={...row,event:event()};const previous=outcomes.length;await assert.rejects(relay.runOnce());assert.equal(outcomes.length,previous);});
});
test("outbox configuration rejects unsafe bounds",()=>{
 loadEnv();const names=["OUTBOX_POLL_INTERVAL_MS","OUTBOX_BATCH_SIZE","OUTBOX_LEASE_MS","OUTBOX_MAX_ATTEMPTS"];const saved=names.map(n=>process.env[n]);
 try{names.forEach(n=>delete process.env[n]);assert.deepEqual(loadOutboxConfig(),{pollIntervalMs:1000,batchSize:20,leaseMs:30000,maxAttempts:10});for(const n of names){for(const value of ["0","-1","1.5","999999999"]){process.env[n]=value;assert.throws(loadOutboxConfig);}delete process.env[n];}}
 finally{names.forEach((n,i)=>{if(saved[i]===undefined)delete process.env[n];else process.env[n]=saved[i];});}
});

import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { createMongoResources } from "../../src/database/mongo.js";
import { startProvider } from "../helpers/payment-provider.js";

for(const mode of ["postgres","mongodb"] as const) {
 test(`${mode} real API/provider signed webhook, recovery and audit workflow`,{skip:mode==="mongodb"&&!process.env.MONGODB_TEST_URI,timeout:30000},async()=>{
  const pool=createPool(loadDatabaseConfig("test"));
  const mongo=process.env.MONGODB_TEST_URI?await createMongoResources(process.env.MONGODB_TEST_URI,"ecommerce_test"):undefined;
  const probe=createServer().listen(0,"127.0.0.1");await once(probe,"listening");const address=probe.address();assert.ok(address&&typeof address!=="string");await new Promise<void>(resolve=>probe.close(()=>resolve()));
  const base=`http://127.0.0.1:${address.port}`;const secret=randomUUID()+randomUUID();
  const provider=await startProvider(base+"/api/v1/webhooks/payments",secret);
  let resumed: Awaited<ReturnType<typeof startProvider>> | undefined;
  const child=spawn(process.execPath,["dist/server.js"],{env:{...process.env,NODE_ENV:"test",HOST:"127.0.0.1",PORT:String(address.port),ORDER_STORAGE:mode,
    MONGODB_URI:process.env.MONGODB_TEST_URI??"",MONGODB_DB_NAME:"ecommerce_test",PAYMENT_PROVIDER_BASE_URL:provider.baseUrl,PAYMENT_WEBHOOK_SECRET:secret},stdio:["ignore","pipe","pipe"]});
  const exited=once(child,"exit");let output="";child.stdout!.on("data",data=>output+=data);child.stderr!.on("data",()=>{});
  const ids:string[]=[];const events:string[]=[];
  const input=()=>({customerId:randomUUID(),items:[{productId:randomUUID(),quantity:2,unitPriceInMinorUnits:50000},{productId:randomUUID(),quantity:1,unitPriceInMinorUnits:20000}]});
  const post=(url:string,body:unknown)=>fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const sendEvent=async(event:Record<string,unknown>,signature?:string)=>{
    if(typeof event.eventId==="string")events.push(event.eventId);
    const body=JSON.stringify(event);
    return fetch(base+"/api/v1/webhooks/payments",{method:"POST",headers:{"Content-Type":"application/json","X-Payment-Signature":signature??createHmac("sha256",secret).update(body).digest("hex")},body});
  };
  const history=async(id:string)=>mode==="postgres"?(await pool.query("SELECT * FROM order_status_history WHERE order_id=$1",[id])).rows:await mongo!.db.collection("order_status_history").find({orderId:id}).toArray();
  try {
    for(let i=0;i<150&&!output.includes("API listening");i++){if(child.exitCode!==null)throw new Error("API startup failed");await delay(30);}
    assert.match(output,/API listening/);
    const created=await post(base+"/api/v1/orders",input());assert.equal(created.status,201);
    const order=await created.json();ids.push(order.id);
    assert.equal(order.status,"PAYMENT_PENDING");assert.equal(order.version,2);assert.equal(order.totalInMinorUnits,120000);assert.equal(typeof order.paymentId,"string");
    const retry=await post(base+`/api/v1/orders/${order.id}/payment`,{});assert.equal((await retry.json()).paymentId,order.paymentId);
    const event={eventId:randomUUID(),type:"payment.succeeded",paymentId:order.paymentId,orderId:order.id,occurredAt:new Date().toISOString()};
    assert.equal((await sendEvent(event,"bad")).status,401);
    assert.equal((await sendEvent(event,"0".repeat(64))).status,401);
    const alteredSignature=createHmac("sha256",secret).update(JSON.stringify({...event,orderId:randomUUID()})).digest("hex");
    assert.equal((await sendEvent(event,alteredSignature)).status,401);
    assert.equal((await sendEvent({...event,eventId:randomUUID(),paymentId:randomUUID()})).status,409);
    assert.equal((await sendEvent({...event,eventId:randomUUID(),orderId:randomUUID()})).status,404);
    assert.equal((await sendEvent({...event,eventId:randomUUID(),type:"other"})).status,400);
    assert.equal((await fetch(base+`/api/v1/orders/${order.id}`).then(r=>r.json())).status,"PAYMENT_PENDING");
    const delivered=await post(provider.baseUrl+`/payments/${order.paymentId}/succeed`,{});assert.equal(delivered.status,200);
    const delivery=await delivered.json();events.push(delivery.eventId);
    const paid=await fetch(base+`/api/v1/orders/${order.id}`).then(r=>r.json());assert.equal(paid.status,"PAID");assert.equal(paid.version,3);
    const duplicates=await Promise.all([post(provider.baseUrl+`/payments/${order.paymentId}/succeed`,{}),post(provider.baseUrl+`/payments/${order.paymentId}/succeed`,{})]);
    for(const response of duplicates)assert.equal(response.status,200);
    assert.equal((await history(order.id)).length,1);
    assert.equal((await fetch(base+`/api/v1/orders/${order.id}`).then(r=>r.json())).version,3);
    assert.equal((await sendEvent({...event,eventId:randomUUID()})).status,409);
    if(mode==="mongodb") {
      // Simulate a crash after the atomic receipt but before audit/event projection.
      await mongo!.db.collection("order_status_history").deleteOne({_id:delivery.eventId});
      await mongo!.db.collection("processed_webhook_events").updateOne({_id:delivery.eventId},{$set:{processedAt:null}});
      assert.equal((await post(provider.baseUrl+`/payments/${order.paymentId}/succeed`,{})).status,200);
      assert.equal((await history(order.id)).length,1);
      assert.equal((await fetch(base+`/api/v1/orders/${order.id}`).then(r=>r.json())).version,3);
      assert.equal((await pool.query("SELECT id FROM orders WHERE id=$1",[order.id])).rowCount,0);
    } else if(mongo)assert.equal(await mongo.db.collection("orders").countDocuments({_id:order.id}),0);
    const failedCreate=await post(base+"/api/v1/orders",input());const failedOrder=await failedCreate.json();ids.push(failedOrder.id);
    const firstFailures=await Promise.all([post(provider.baseUrl+`/payments/${failedOrder.paymentId}/fail`,{}),post(provider.baseUrl+`/payments/${failedOrder.paymentId}/fail`,{})]);
    for(const failedDelivery of firstFailures){assert.equal(failedDelivery.status,200);events.push((await failedDelivery.json()).eventId);}
    assert.equal((await fetch(base+`/api/v1/orders/${failedOrder.id}`).then(r=>r.json())).status,"PAYMENT_FAILED");
    assert.equal((await history(failedOrder.id)).length,1);
    await provider.stop();
    const unavailable=await post(base+"/api/v1/orders",input());assert.equal(unavailable.status,502);
    const message=(await unavailable.json()).error.message;const retainedId=/order ([0-9a-f-]{36})/.exec(message)?.[1];assert.ok(retainedId);ids.push(retainedId);
    const retained=await fetch(base+`/api/v1/orders/${retainedId}`).then(r=>r.json());assert.equal(retained.status,"CREATED");assert.equal(retained.paymentId,null);
    resumed=await startProvider(base+"/api/v1/webhooks/payments",secret,{port:provider.port,databasePath:provider.databasePath});
    const recovered=await post(base+`/api/v1/orders/${retainedId}/payment`,{});assert.equal(recovered.status,200);assert.equal((await recovered.json()).status,"PAYMENT_PENDING");
    assert.equal((await fetch(base+"/ready")).status,200);
    child.kill("SIGTERM");assert.equal((await exited)[0],0);
  } finally {
    if(child.exitCode===null){child.kill("SIGKILL");await exited;}
    await resumed?.cleanup();await provider.cleanup();
    try {
      await pool.query("DELETE FROM processed_webhook_events WHERE event_id=ANY($1::uuid[])",[events]);
      await pool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])",[ids]);
      if(mongo){await mongo.db.collection("order_status_history").deleteMany({orderId:{$in:ids}});await mongo.db.collection<{_id:string}>("processed_webhook_events").deleteMany({_id:{$in:events}});await mongo.db.collection<{_id:string}>("orders").deleteMany({_id:{$in:ids}});}
    } finally {await pool.end();await mongo?.client.close();}
  }
 });
}

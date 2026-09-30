import { startProvider } from "../helpers/payment-provider.js";
import { HttpPaymentClient } from "../../src/modules/payments/payment.client.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { loadDatabaseConfig } from "../../src/config/env.js";
import { createPool } from "../../src/database/pool.js";
import { createMongoResources } from "../../src/database/mongo.js";
import { PostgresOrderRepository } from "../../src/modules/orders/postgres-order.repository.js";
import { MongoOrderRepository } from "../../src/modules/orders/mongo-order.repository.js";
import { OrderService } from "../../src/modules/orders/order.service.js";
import type { Order } from "../../src/modules/orders/order.types.js";

const input = () => ({customerId: randomUUID(), items: [
  {productId: randomUUID(), quantity: 2, unitPriceInMinorUnits: 50000},
  {productId: randomUUID(), quantity: 1, unitPriceInMinorUnits: 20000},
]});
const normalized = (order: Order) => ({...order, items: [...order.items].sort((a,b)=>a.productId.localeCompare(b.productId))});

for (const mode of ["postgres", "mongodb"] as const) {
  test(`real ${mode} OrderService and runtime HTTP selection`, {skip: mode === "mongodb" && !process.env.MONGODB_TEST_URI, timeout: 30000}, async () => {
    const pool = createPool(loadDatabaseConfig("test"));
    const mongo = process.env.MONGODB_TEST_URI ? await createMongoResources(process.env.MONGODB_TEST_URI, "ecommerce_test") : undefined;
    const ids: string[] = [];
    const repository = mode === "postgres" ? new PostgresOrderRepository(pool) : new MongoOrderRepository(mongo!.db);
    const secret = randomUUID() + randomUUID();
    const provider = await startProvider("http://127.0.0.1:1/api/v1/webhooks/payments",secret);
    const service = new OrderService(repository,new HttpPaymentClient(provider.baseUrl));
    let child: ReturnType<typeof spawn> | undefined;
    try {
      // Exercise the real service directly; no fake Order persistence.
      for (const items of [input().items.slice(0,1), input().items]) {
        const created = await service.create({customerId: randomUUID(), items});
        ids.push(created.id);
        assert.equal(created.totalInMinorUnits, items.length === 1 ? 100000 : 120000);
        for (const item of items) {
          assert.equal(created.items.find(saved => saved.productId === item.productId)?.lineTotalInMinorUnits, item.quantity * item.unitPriceInMinorUnits);
        }
        assert.equal(created.status, "PAYMENT_PENDING"); assert.equal(created.version,2); assert.equal(typeof created.paymentId,"string");
        assert.deepEqual(normalized(await service.findById(created.id)),normalized(created));
      }
      await assert.rejects(service.findById(randomUUID()), {statusCode:404, message:"Order not found"});
      for (const items of [
        [{productId:randomUUID(), quantity:2, unitPriceInMinorUnits:Number.MAX_SAFE_INTEGER}],
        [{productId:randomUUID(), quantity:1, unitPriceInMinorUnits:Number.MAX_SAFE_INTEGER}, {productId:randomUUID(), quantity:1, unitPriceInMinorUnits:1}],
      ]) await assert.rejects(service.create({customerId:randomUUID(), items}), {statusCode:400});

      // The process executes the actual production composition root.
      const probe = createServer().listen(0,"127.0.0.1");
      await once(probe,"listening");
      const address = probe.address(); assert.ok(address && typeof address !== "string");
      await new Promise<void>(resolve=>probe.close(()=>resolve()));
      child = spawn(process.execPath, ["dist/server.js"], {
        env: {...process.env, AUTH_ENABLED:"false", NODE_ENV:"test", HOST:"127.0.0.1", PORT:String(address.port), ORDER_STORAGE:mode, PAYMENT_PROVIDER_BASE_URL:provider.baseUrl, PAYMENT_WEBHOOK_SECRET:secret,
          MONGODB_URI: mode === "mongodb" ? process.env.MONGODB_TEST_URI! : "",
          MONGODB_DB_NAME: mode === "mongodb" ? "ecommerce_test" : ""},
        stdio:["ignore","pipe","pipe"],
      });
      let output = "";
      child.stdout!.on("data", data => {output += data.toString();});
      child.stderr!.on("data", data => {output += data.toString();});
      const exited = once(child,"exit");
      for(let i=0;i<150 && !output.includes("API listening");i++) {
        if(child.exitCode!==null) throw new Error("Order runtime failed to start");
        await delay(50);
      }
      const port = /API listening on 127\.0\.0\.1:(\d+)/.exec(output)?.[1];
      assert.ok(port, "runtime must listen");
      const base = `http://127.0.0.1:${port}`;
      assert.equal((await fetch(base+"/health")).status,200);
      assert.equal((await fetch(base+"/ready")).status,200);
      assert.equal((await fetch(base+"/api/v1/products?limit=1")).status,200);
      const response = await fetch(base+"/api/v1/orders", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input())});
      assert.equal(response.status,201);
      const created = await response.json() as Order; ids.push(created.id);
      assert.equal(created.totalInMinorUnits,120000);
      assert.equal(created.status,"PAYMENT_PENDING"); assert.equal(created.version,2); assert.equal(typeof created.paymentId,"string");
      assert.equal(response.headers.get("location"),`/api/v1/orders/${created.id}`);
      const fetched = await fetch(base+`/api/v1/orders/${created.id}`);
      assert.equal(fetched.status,200);
      assert.deepEqual(normalized(await fetched.json()),normalized(created));
      assert.deepEqual(Object.keys(created).sort(),["id","customerId","items","status","totalInMinorUnits","paymentId","version","createdAt","updatedAt"].sort());
      const sql = (await pool.query("SELECT id FROM orders WHERE id=$1",[created.id])).rows;
      const sqlItems = (await pool.query("SELECT order_id FROM order_items WHERE order_id=$1",[created.id])).rows;
      const document = mongo ? await mongo.db.collection<{_id:string;items:unknown[]}>("orders").findOne({_id:created.id}) : null;
      if(mode==="postgres") {assert.equal(sql.length,1);assert.equal(sqlItems.length,2);assert.equal(document,null);}
      else {assert.equal(sql.length,0);assert.equal(sqlItems.length,0);assert.equal(document?.items.length,2);}
      for (const body of [{}, {...input(),extra:true}, {...input(),items:[]}, {...input(),items:[{productId:randomUUID(),quantity:2,unitPriceInMinorUnits:Number.MAX_SAFE_INTEGER}]}]) {
        const bad=await fetch(base+"/api/v1/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
        assert.equal(bad.status,400);assert.equal(typeof (await bad.json()).error.message,"string");
      }
      assert.equal((await fetch(base+"/api/v1/orders/invalid")).status,400);
      const absent=await fetch(base+`/api/v1/orders/${randomUUID()}`);
      assert.equal(absent.status,404);assert.deepEqual(await absent.json(),{error:{message:"Order not found"}});
      child.kill("SIGTERM"); assert.equal((await exited)[0],0);
      assert.match(output,/HTTP server closed\.[\s\S]*PostgreSQL pool closed\./);
      if(mode==="mongodb") assert.match(output,/HTTP server closed\.[\s\S]*MongoDB client closed\./);
      else assert.doesNotMatch(output,/MongoDB client closed/);
    } finally {
      if(child && child.exitCode===null) { const exited=once(child,"exit"); child.kill("SIGKILL"); await exited; }
      try {
        await pool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])",[ids]);
        if(mongo) await mongo.db.collection<{_id:string}>("orders").deleteMany({_id:{$in:ids}});
      } finally { await pool.end(); await mongo?.client.close(); await provider.cleanup(); }
    }
  });
}

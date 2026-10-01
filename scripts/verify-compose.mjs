import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { createClient } from "redis";
import { MongoClient } from "mongodb";
assert.equal(process.env.DB_NAME,"ecommerce_test","Smoke verification must use ecommerce_test");
assert.equal(process.env.ORDER_STORAGE,"postgres");
const pool=new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
const redis=createClient({url:process.env.REDIS_URL});redis.on("error",()=>{});
const mongo=new MongoClient(process.env.MONGODB_URI);
let product,order,eventId;
const base="http://api:3000";
const tokens={};
try{
 await redis.connect();assert.equal(await redis.ping(),"PONG");
 await mongo.connect();assert.equal((await mongo.db("ecommerce_test").command({ping:1})).ok,1);
 for(const role of ["reader","manager","unprivileged"]){
  const token=await fetch(process.env.OIDC_ISSUER+"/protocol/openid-connect/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:"ecommerce-cli-"+role,client_secret:process.env[`ECOMMERCE_${role.toUpperCase()}_CLIENT_SECRET`]})});
  assert.equal(token.status,200);tokens[role]=(await token.json()).access_token;
 }
 const request=(path,method="GET",body,token=tokens.manager)=>fetch(base+path,{method,headers:{...(token?{Authorization:"Bearer "+token}:{}),...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
 for(const path of ["/health","/ready","/docs/","/openapi.json"]){assert.equal((await fetch(base+path)).status,200);}
 assert.equal((await fetch("http://web:8080/")).status,200);
 assert.equal((await fetch("http://web:8080/api/v1/products",{headers:{Authorization:"Bearer "+tokens.reader}})).status,200);
 assert.equal((await request("/api/v1/products","GET",undefined,"")).status,401);
 assert.equal((await request("/api/v1/products","GET",undefined,"invalid")).status,401);
 assert.equal((await request("/api/v1/products","GET",undefined,tokens.unprivileged)).status,403);
 const created=await request("/api/v1/products","POST",{sku:"COMPOSE-"+randomUUID(),name:"Container verification",priceInMinorUnits:100,stock:3});assert.equal(created.status,201);product=await created.json();
 const key="product:v1:"+product.id;assert.equal(await redis.get(key),null);
 assert.equal((await request("/api/v1/products/"+product.id)).status,200);assert(await redis.get(key));assert((await redis.ttl(key))>0);
 assert.equal((await request("/api/v1/products/"+product.id)).status,200);
 assert.equal((await request("/api/v1/products/"+product.id,"PUT",{stock:4})).status,200);assert.equal(await redis.get(key),null);
 const placed=await request("/api/v1/orders","POST",{customerId:randomUUID(),items:[{productId:product.id,quantity:1,unitPriceInMinorUnits:100}]});assert.equal(placed.status,201);order=await placed.json();assert.equal(order.status,"PAYMENT_PENDING");console.log("OWNED_PAYMENT "+order.paymentId);
 assert.equal((await request("/api/v1/webhooks/payments","POST",{})).status,401);
 const trigger=()=>fetch(`http://payment-provider:4100/payments/${order.paymentId}/succeed`,{method:"POST"});
 const delivered=await trigger();assert.equal(delivered.status,200);eventId=(await delivered.json()).eventId;
 assert.equal((await request("/api/v1/orders/"+order.id).then(r=>r.json())).status,"PAID");
 assert.equal((await pool.query("SELECT status FROM outbox_events WHERE event_id=$1",[eventId])).rows[0].status,"PENDING");
 console.log("OUTBOX_PENDING_VERIFIED");
 for(let i=0;i<180;i++){
  const count=await pool.query("SELECT count(*)::int AS n FROM order_notifications WHERE event_id=$1",[eventId]);
  if(count.rows[0].n===1)break;
  await delay(500);
 }
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM order_notifications WHERE event_id=$1",[eventId])).rows[0].n,1);
 assert.equal((await pool.query("SELECT status FROM outbox_events WHERE event_id=$1",[eventId])).rows[0].status,"PUBLISHED");
 assert.equal((await trigger()).status,200);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM order_status_history WHERE order_id=$1 AND to_status='PAID'",[order.id])).rows[0].n,1);
 console.log("Container HTTP/OIDC/HMAC/cache/Postgres/Mongo/Kafka/outbox/consumer/duplicate: PASS");
}finally{
 if(eventId){await pool.query("DELETE FROM order_notifications WHERE event_id=$1",[eventId]);await pool.query("DELETE FROM outbox_events WHERE event_id=$1",[eventId]);await pool.query("DELETE FROM processed_webhook_events WHERE event_id=$1",[eventId]);}
 if(order)await pool.query("DELETE FROM orders WHERE id=$1",[order.id]);
 if(product){await pool.query("DELETE FROM products WHERE id=$1",[product.id]);await redis.del("product:v1:"+product.id);}
 await Promise.allSettled([pool.end(),redis.close(),mongo.close()]);
}

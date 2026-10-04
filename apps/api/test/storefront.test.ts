import assert from "node:assert/strict";
import test from "node:test";
import {once} from "node:events";
import {randomUUID} from "node:crypto";
import {generateKeyPair} from "jose";
import {createApp} from "../src/app.js";
import {createAccessPolicy} from "../src/auth/middleware.js";
import {createJwtVerifier} from "../src/auth/oidc.js";
import {InMemoryProductRepository} from "../src/modules/products/in-memory-product.repository.js";
import {InMemoryCategoryRepository} from "../src/modules/categories/in-memory-category.repository.js";
test("public catalog exposes only ACTIVE products while management stays protected",async(t)=>{
 const repo=new InMemoryProductRepository(), ids=[randomUUID(),randomUUID(),randomUUID()];
 for(let i=0;i<3;i++) await repo.create({id:ids[i]!,sku:randomUUID(),name:"Product "+i,description:null,categoryId:null,priceInMinorUnits:100,stock:1,status:i===1?"INACTIVE":"ACTIVE",createdAt:new Date(i+1).toISOString(),updatedAt:new Date().toISOString()});
 const keys=await generateKeyPair("RS256");
 const app=createApp({productRepository:repo,categoryRepository:new InMemoryCategoryRepository(),checkReady:async()=>{},accessPolicy:createAccessPolicy(createJwtVerifier({enabled:true,issuer:"https://storefront.test",audience:"api"},async()=>keys.publicKey))});
 const server=app.listen(0,"127.0.0.1"); await once(server,"listening"); const address=server.address();assert(address&&typeof address!=="string");const base=`http://127.0.0.1:${address.port}`;
 try{
 await t.test("anonymous pagination combines with enforced ACTIVE status",async()=>{
 const res=await fetch(base+"/api/v1/storefront/products?status=INACTIVE&page=2&limit=1"); assert.equal(res.status,200);const data=await res.json();assert.equal(data.pagination.total,2);assert.deepEqual(data.products.map((p:any)=>p.id),[ids[2]]);assert.equal(data.products[0].status,"ACTIVE");
 });
 await t.test("details and images never expose INACTIVE products",async()=>{
 assert.equal((await fetch(base+"/api/v1/storefront/products/"+ids[0])).status,200);
 for(const suffix of ["","/image-url"])assert.equal((await fetch(base+"/api/v1/storefront/products/"+ids[1]+suffix)).status,404);
 assert.equal((await fetch(base+"/api/v1/storefront/products/not-uuid")).status,400);
 });
 await t.test("unknown query and invalid pagination are safe errors",async()=>{
 for(const q of ["page=0","limit=101","ownerSubject=forged","status=INVALID"])assert.equal((await fetch(base+"/api/v1/storefront/products?"+q)).status,400);
 });
 await t.test("public routes add no mutation access; protected catalog still needs JWT",async()=>{
 for(const path of ["products","categories"])assert.equal((await fetch(base+"/api/v1/"+path)).status,401);
 assert.equal((await fetch(base+"/api/v1/storefront/products",{method:"POST"})).status,404);
 });
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

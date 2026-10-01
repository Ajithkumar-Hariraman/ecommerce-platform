import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import SwaggerParser from "@apidevtools/swagger-parser";
import { openApiDocument } from "../src/openapi.js";
import { createApp } from "../src/app.js";
import { InMemoryProductRepository } from "../src/modules/products/in-memory-product.repository.js";
import { InMemoryCategoryRepository } from "../src/modules/categories/in-memory-category.repository.js";

test("OpenAPI 3.1 validates and covers actual router methods and independent HMAC", async()=>{
  await SwaggerParser.validate(JSON.parse(JSON.stringify(openApiDocument)));
  assert.equal(openApiDocument.components.securitySchemes.BearerAuth.scheme,"bearer");
  assert(openApiDocument.components.schemas.Product);assert(openApiDocument.components.schemas.Order);
  assert.deepEqual(openApiDocument.paths["/api/v1/webhooks/payments"].post.security,[{PaymentHmac:[]}]);
  for(const [module,prefix] of [["products/product","products"],["categories/category","categories"],["orders/order","orders"]]){
    const source=await readFile(new URL(`../src/modules/${module}.routes.ts`,import.meta.url),"utf8");
    for(const match of source.matchAll(/router\.(get|post|put|delete)\("([^"\n]+)"/g)){
      const path=`/api/v1/${prefix}${match[2]==="/"?"":match[2]?.replace(":id","{id}")}`;
      const paths=openApiDocument.paths as Record<string,Record<string,unknown>>;
      assert(paths[path]?.[match[1]!],`${match[1]} ${path} missing`);
    }
  }
});
test("Swagger UI/spec are available only when explicitly enabled",async()=>{
  for(const enabled of [true,false]){
    const server=createApp({docsEnabled:enabled,productRepository:new InMemoryProductRepository(),categoryRepository:new InMemoryCategoryRepository(),checkReady:async()=>{}}).listen(0,"127.0.0.1");
    await once(server,"listening");const address=server.address();assert(address&&typeof address!=="string");
    try{
      for(const path of ["/docs/","/openapi.json"]){const response=await fetch(`http://127.0.0.1:${address.port}${path}`);assert.equal(response.status,enabled?200:404);if(enabled&&path.endsWith("json"))assert.equal((await response.json()).openapi,"3.1.0");}
    }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  }
});

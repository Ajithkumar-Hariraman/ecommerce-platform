import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { productImageSchema, matchesImageHeader } from '../src/modules/products/product-image.js';
import { localCatalogImageUrl } from '../src/modules/products/local-catalog-image.js';
// @ts-expect-error Local tooling is plain ESM, outside the application build.
import { catalog, assertDevelopment, seedPostgres, seedMongo } from '../../../scripts/local/seed-catalog.mjs';
test('catalog contains 6 categories, 30 complete products and authentic bundled PNG references', () => {
  assert.equal(catalog.categories.length,6); assert.equal(catalog.products.length,30);
  assert.equal(new Set(catalog.products.map((p: any)=>p.sku)).size,30);
  for (const c of catalog.categories) assert.equal(catalog.products.filter((p: any)=>p.categoryId===c.id).length,5);
  for (const p of catalog.products) {
    assert.equal(p.status,'ACTIVE'); assert.ok(p.description.length>40);
    assert.ok(Number.isInteger(p.priceInMinorUnits) && p.priceInMinorUnits>0); assert.ok(p.stock>0);
    productImageSchema.parse(p.image);
    const bytes=readFileSync(new URL('../assets/local-catalog/'+p.image.objectName,import.meta.url));
    assert.ok(matchesImageHeader('image/png',bytes)); assert.equal(bytes.length,p.image.size);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),p.image.generation);
  }
});
test('seed refuses test, production, remote targets; image resolver is development only', () => {
  for (const args of [['ecommerce_test','localhost','development'],['ecommerce_dev','remote','development'],['ecommerce_dev','localhost','production']]) assert.throws(()=>assertDevelopment(...args));
  const previous=process.env.NODE_ENV;
  try {
    process.env.NODE_ENV='development'; assert.match(localCatalogImageUrl(catalog.products[0].image),/^\/api\/local-catalog\//);
    assert.throws(()=>localCatalogImageUrl({...catalog.products[0].image,objectName:'../catalog.json'}));
    assert.throws(()=>localCatalogImageUrl({...catalog.products[0].image,generation:'wrong'}));
    process.env.NODE_ENV='production'; assert.throws(()=>localCatalogImageUrl(catalog.products[0].image));
  } finally { if(previous===undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=previous; }
});
test('Postgres rolls back wrong database before catalog writes; Mongo refuses test', async()=>{
  const sql: string[]=[];
  await assert.rejects(seedPostgres({query:async(s:string)=>{sql.push(s);return {rows:[{name:'ecommerce_test'}]};}}));
  assert.ok(sql.includes('ROLLBACK')); assert.ok(!sql.some(s=>s.startsWith('INSERT')));
  await assert.rejects(seedMongo({databaseName:'ecommerce_test'}));
});
test('Mongo reruns insert only missing SKUs and preserve user edits',async()=>{
  const stores=new Map<string,Map<string,any>>();
  const db={databaseName:'ecommerce_dev',collection(name:string){
    let rows=stores.get(name); if(!rows){rows=new Map();stores.set(name,rows);}
    return {createIndex:async()=>{},findOne:async(q:any)=>rows.get(q.slug),updateOne:async(q:any,u:any)=>{const key=q.slug??q.sku;if(!rows.has(key)) rows.set(key,structuredClone(u.$setOnInsert));}};
  }};
  await seedMongo(db);
  const product=stores.get('products')!.get(catalog.products[0].sku); product.name='User edited'; product.stock=3;
  stores.get('products')!.set('USER-SKU',{name:'User product'});
  await seedMongo(db);
  assert.equal(stores.get('categories')!.size,6);assert.equal(stores.get('products')!.size,31);
  assert.equal(product.name,'User edited');assert.equal(product.stock,3);
});
test('Postgres seed uses only conflict-safe inserts and parameterized values',async()=>{
  const calls:{sql:string;values:any[]}[]=[];
  await seedPostgres({query:async(sql:string,values:any[]=[])=>{
    calls.push({sql,values});
    return {rows:sql.includes('current_database')?[{name:'ecommerce_dev'}]:sql.startsWith('SELECT id')?[{id:catalog.categories.find((c:any)=>c.slug===values[0]).id}]:[]};
  }});
  const inserts=calls.filter(c=>c.sql.startsWith('INSERT'));
  assert.equal(inserts.length,36);
  assert.ok(inserts.every(c=>c.sql.includes('ON CONFLICT DO NOTHING') && c.sql.includes('$1')));
  assert.ok(!calls.some(c=>/^(UPDATE|DELETE|TRUNCATE)/.test(c.sql)));
  assert.equal(calls.at(-1)!.sql,'COMMIT');
});

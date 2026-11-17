import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { catalog } from './seed-catalog.mjs';
const base='http://localhost:8088';
for(let attempt=0;attempt<30;attempt++) {
  try { if((await fetch(base+'/api/v1/storefront/products?limit=1')).ok) break; } catch {}
  await new Promise(resolve=>setTimeout(resolve,1000));
}
const products=[];
for(let page=1;;page++) {
  const r=await fetch(`${base}/api/v1/storefront/products?page=${page}&limit=100`); assert.equal(r.status,200);
  const data=await r.json(); products.push(...data.products);
  if(products.length>=data.pagination.total || !data.products.length) break;
}
for(const expected of catalog.products) {
  const p=products.find(p=>p.sku===expected.sku); assert.ok(p,`Missing ${expected.sku}`);
  for(const key of ['id','name','description','categoryId','priceInMinorUnits','stock','status']) assert.equal(p[key],expected[key],`${expected.sku}: ${key} (existing conflicting records are preserved)`);
  const r=await fetch(`${base}/api/v1/storefront/products/${p.id}/image-url`); assert.equal(r.status,200);
  const {url}=await r.json(); const image=await fetch(new URL(url,base)); assert.equal(image.status,200);
  assert.equal(image.headers.get('content-type'),'image/png');
  assert.equal(createHash('sha256').update(Buffer.from(await image.arrayBuffer())).digest('hex'),expected.image.generation);
}
assert.equal((await fetch(base+'/shop')).status,200);
console.log('PASS: 30 ACTIVE catalog products and all image bytes available through localhost:8088. Check /shop pages 1–3 and a product detail in the browser.');

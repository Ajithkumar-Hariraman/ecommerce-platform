// Explicit local Compose seed. Does not load application/cloud environment files.
import { loadEnvFile } from 'node:process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
export const catalog = JSON.parse(readFileSync(new URL('../../apps/api/assets/local-catalog/catalog.json', import.meta.url)));
export function assertDevelopment(database, host, environment) {
  if (database !== 'ecommerce_dev' || !['127.0.0.1', 'localhost'].includes(host) || environment !== 'development')
    throw new Error('Seed requires development, loopback and ecommerce_dev');
}
export async function seedPostgres(client) {
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(772930114)");
    if ((await client.query('SELECT current_database() AS name')).rows[0].name !== 'ecommerce_dev') throw new Error('Wrong database');
    for (const c of catalog.categories) {
      await client.query('INSERT INTO categories(id,slug,name,status,created_at,updated_at) VALUES($1,$2,$3,$4,now(),now()) ON CONFLICT DO NOTHING', [c.id,c.slug,c.name,c.status]);
      const row = (await client.query('SELECT id FROM categories WHERE slug=$1', [c.slug])).rows[0];
      if (row?.id !== c.id) throw new Error('Category identity conflict; existing data preserved');
    }
    for (const p of catalog.products) await client.query('INSERT INTO products(id,sku,name,description,category_id,price_in_minor_units,stock,status,image_asset,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now()) ON CONFLICT DO NOTHING', [p.id,p.sku,p.name,p.description,p.categoryId,p.priceInMinorUnits,p.stock,p.status,p.image]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); throw e; }
}
export async function seedMongo(db) {
  if (db.databaseName !== 'ecommerce_dev') throw new Error('Wrong database');
  await db.collection('categories').createIndex({slug:1},{unique:true,name:'categories_slug_key'});
  await db.collection('products').createIndex({sku:1},{unique:true,name:'products_sku_key'});
  for (const c of catalog.categories) {
    const {id,...fields}=c;
    await db.collection('categories').updateOne({slug:c.slug},{$setOnInsert:{_id:id,...fields,createdAt:new Date(),updatedAt:new Date()}},{upsert:true});
    if ((await db.collection('categories').findOne({slug:c.slug}))._id !== id) throw new Error('Category identity conflict; existing data preserved');
  }
  for (const p of catalog.products) {
    const {id,...fields}=p;
    await db.collection('products').updateOne({sku:p.sku},{$setOnInsert:{_id:id,...fields,createdAt:new Date(),updatedAt:new Date()}},{upsert:true});
  }
}
async function main() {
  const backend=process.argv[2];
  if (!['postgres','mongodb'].includes(backend)) throw new Error('Usage: node scripts/local/seed-catalog.mjs postgres|mongodb');
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') throw new Error('Development only');
  loadEnvFile(new URL('../../infra/.env',import.meta.url));
  assertDevelopment('ecommerce_dev','127.0.0.1',process.env.NODE_ENV ?? 'development');
  if (backend === 'postgres') {
    const {Client}=require('pg');
    const client=new Client({host:'127.0.0.1',port:5433,database:'ecommerce_dev',user:'ecommerce_app',password:process.env.DB_PASSWORD,ssl:false});
    try { await client.connect(); await seedPostgres(client); } finally { await client.end(); }
  } else {
    const {MongoClient}=require('mongodb');
    const client=new MongoClient('mongodb://127.0.0.1:27018',{auth:{username:process.env.MONGO_INITDB_ROOT_USERNAME,password:process.env.MONGO_INITDB_ROOT_PASSWORD},authSource:'admin'});
    try { await client.connect(); await seedMongo(client.db('ecommerce_dev')); } finally { await client.close(); }
  }
  console.log(`${backend}: catalog insert complete; existing records retained. Run visible catalog verification.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Catalog seed failed; check local Compose availability and identity conflicts. Existing records were not overwritten.'); process.exitCode=1; });

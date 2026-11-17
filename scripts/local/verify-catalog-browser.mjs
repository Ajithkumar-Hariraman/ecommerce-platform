import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { catalog } from './seed-catalog.mjs';
const require=createRequire(new URL('../../apps/web/package.json',import.meta.url));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
try {
  const page=await browser.newPage(); const seen=new Set();
  for(let n=1;;n++) {
    await page.goto(`http://localhost:8088/shop?page=${n}`);
    await page.locator('.product-card').first().waitFor();
    const cards=page.locator('.product-card');
    for(let i=0;i<await cards.count();i++) {
      const card=cards.nth(i); const text=await card.innerText();
      const expected=catalog.products.find(p=>text.includes(p.name));
      if(!expected) continue;
      const img=card.locator('img'); await img.scrollIntoViewIfNeeded();
      await img.evaluate(img=>img.decode());
      assert.ok(await img.evaluate(img=>img.naturalWidth>0)); seen.add(expected.sku);
    }
    if(seen.size===30) break;
    const next=page.getByRole('button',{name:'Next',exact:true});
    if(!await next.count() || await next.isDisabled()) break;
  }
  assert.equal(seen.size,30); await page.screenshot({path:'/tmp/local-catalog-shop.png',fullPage:true});
  const sample=catalog.products[0];
  await page.goto('http://localhost:8088/products/'+sample.id);
  await page.getByRole('heading',{name:sample.name,exact:true}).waitFor();
  const detail=page.locator('.product-detail');
  await detail.locator('img').evaluate(img=>img.decode());
  assert.ok((await detail.innerText()).includes(sample.description));
  assert.ok((await detail.innerText()).includes('Available to order'));
  console.log('PASS: browser rendered 30 catalog cards with decoded images across shop pages, plus product detail.');
} finally { await browser.close(); }

// Scanning a receipt: a photo is read on the phone and fills in the shop, total and date.
// Receipts are drawn as HTML and photographed by the browser itself.
const { chromium } = require('playwright');
const path = require('path');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
const SHOTS = path.join(__dirname, 'shots');
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };

const receiptHtml = (lines) => `<html><body style="margin:0;background:#ddd"><div style="width:360px;margin:20px auto;padding:24px;background:#fff;font:20px/1.6 'Noto Sans CJK JP','Noto Sans JP',sans-serif;color:#222">${lines
  .map((l) => `<div style="display:flex;justify-content:space-between"><span>${l[0]}</span><span>${l[1] ?? ''}</span></div>`)
  .join('')}</div></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { try { localStorage.setItem('waroo-onboarded', '1') } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Tesseract's own notes about its settings aren't errors.
  page.on('console', (m) => { if (m.type() === 'error' && !/^Warning: Parameter not found/.test(m.text())) errors.push(m.text()); });

  // Draw two receipts.
  const draw = await ctx.newPage();
  const photo = async (file, lines) => {
    await draw.setContent(receiptHtml(lines));
    await draw.waitForTimeout(300);
    await draw.locator('div').first().screenshot({ path: file });
    return file;
  };
  const today = new Date();
  const ymd = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;
  const iso = ymd.replace(/\//g, '-');
  const ja = await photo(SHOTS + '/receipt-ja.png', [
    ['ファミリーマート'], ['渋谷道玄坂店'], [`${ymd} 18:42`], ['おにぎり', '¥160'], ['お茶', '¥140'], ['小計', '¥300'], ['合計', '¥324'], ['お預り', '¥1,000'], ['お釣り', '¥676'],
  ]);
  const en = await photo(SHOTS + '/receipt-en.png', [
    ['Blue Bottle Coffee'], [`${ymd.slice(5)}/${ymd.slice(0, 4)}`.replace(/^(\d\d)\/(\d\d)\/(\d{4})$/, '$1/$2/$3')], ['Latte', '5.50'], ['Croissant', '4.25'], ['Subtotal', '9.75'], ['Tax', '0.86'], ['TOTAL', '$10.61'], ['Cash', '$20.00'], ['Change', '$9.39'],
  ]);

  await page.goto(B + '#/new');
  await page.fill('input[placeholder="Okinawa trip"]', 'Trip');
  await page.fill('input[placeholder="Ana"]', 'Ana');
  await page.fill('input[aria-label="Person 2"]', 'Bob');
  await page.click('text=Create group'); await page.waitForTimeout(400);
  await page.click('a.fab');
  check(await page.waitForSelector('.receipt-scan:has-text("Scan a receipt")', { timeout: 5000 }).then(() => true, () => false), 'a new expense offers to scan a receipt');

  const t0 = Date.now();
  await page.setInputFiles('.receipt-scan input[type=file]', ja);
  await page.waitForSelector('.receipt-scan .hint:has-text("receipt")', { timeout: 120000 });
  console.log(`     read in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  check((await page.inputValue('input.amount-input')) === '324', `the Japanese total is filled in (${await page.inputValue('input.amount-input')})`);
  check((await page.inputValue('input[placeholder="Izakaya dinner"]')).includes('ファミリーマート'), `and the shop (${await page.inputValue('input[placeholder="Izakaya dinner"]')})`);
  check((await page.inputValue('select >> nth=0')) === 'JPY', 'in yen');
  check(await page.evaluate((d) => document.body.innerHTML.includes(d), iso), 'and the date');
  await page.screenshot({ path: SHOTS + '/receipt-1-filled.png' });

  await page.goto(B + '#/'); await page.click('a.card-row:has-text("Trip")'); await page.click('a.fab');
  await page.setInputFiles('.receipt-scan input[type=file]', en);
  await page.waitForSelector('.receipt-scan .hint:has-text("receipt")', { timeout: 120000 });
  check((await page.inputValue('input.amount-input')) === '10.61', `an English receipt’s total, in dollars (${await page.inputValue('input.amount-input')})`);
  check((await page.inputValue('select >> nth=0')) === 'USD', 'switches the currency to dollars');
  check((await page.inputValue('input[placeholder="Izakaya dinner"]')).includes('Blue Bottle'), 'and the shop');

  // Nothing readable: says so, fills nothing.
  await page.goto(B + '#/'); await page.click('a.card-row:has-text("Trip")'); await page.click('a.fab');
  await draw.setContent('<html><body style="margin:0;width:300px;height:300px;background:linear-gradient(45deg,#888,#eee)"></body></html>');
  await draw.screenshot({ path: SHOTS + '/receipt-blank.png' });
  await page.setInputFiles('.receipt-scan input[type=file]', SHOTS + '/receipt-blank.png');
  await page.waitForSelector('.receipt-scan .hint:has-text("Couldn’t")', { timeout: 120000 });
  check((await page.inputValue('input.amount-input')) === '', 'a photo with no receipt fills nothing in, and says so');

  check(errors.length === 0, `no console errors ${errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

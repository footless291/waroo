// Adjust and Items splits, and expenses paid by several people.
const { chromium } = require('playwright');
const B = process.env.FOOTLESS_URL || 'http://127.0.0.1:8787/';
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const ana = await ctx.newPage();
  const errors = [];
  ana.on('pageerror', (e) => errors.push(String(e)));
  ana.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const text = (sel) => ana.textContent(sel).catch(() => '');
  const shareOf = (name) => ana.$$eval('.split-list li', (lis, n) => lis.find((li) => li.textContent.includes(n))?.querySelector('.share')?.textContent, name);
  const waitText = async (sel, needle, ms = 5000) => { try { await ana.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };

  await ana.goto(B);
  await ana.click('a.button:has-text("Start a group")');
  await ana.fill('input[placeholder="Okinawa trip"]', 'Okinawa trip');
  await ana.fill('input[placeholder="Ana"]', 'Ana');
  await ana.fill('input[aria-label="Person 2"]', 'Bob');
  await ana.fill('input[aria-label="Person 3"]', 'Cai');
  await ana.click('text=Create group'); await ana.waitForTimeout(400);

  // Adjust: Ana had ¥3,000 of wine; the rest is split three ways
  await ana.click('a.fab');
  await ana.fill('input[placeholder="Izakaya dinner"]', 'Izakaya');
  await ana.fill('input.amount-input', '9000');
  await ana.click('.segmented label:has-text("Adjust")');
  check(await waitText('main', 'split the rest equally'), 'Adjust says what it does');
  await ana.fill('input[aria-label="Extra for Ana"]', '3000');
  check((await shareOf('Ana')) === '¥5,000' && (await shareOf('Bob')) === '¥2,000' && (await shareOf('Cai')) === '¥2,000', 'Adjust: Ana ¥5,000, Bob and Cai ¥2,000');
  await ana.uncheck('input[aria-label="Split the rest with Cai"]');
  check((await shareOf('Bob')) === '¥3,000' && (await shareOf('Cai')) === '—', 'unticking Cai splits the rest between Ana and Bob');
  await ana.check('input[aria-label="Split the rest with Cai"]');
  await ana.screenshot({ path: SHOTS + '/split-1-adjust.png', fullPage: true });
  await ana.click('button:has-text("Add expense")'); await ana.waitForTimeout(400);
  await ana.click('a:has-text("Izakaya")');
  check(await ana.isChecked('.segmented input[value="adjustment"]') && (await ana.inputValue('input[aria-label="Extra for Ana"]')) === '3000', 'editing reopens Adjust with Ana’s extra');
  await ana.click('a[aria-label="Back"]');

  // Items, with a 10% service charge, and the amount left blank
  await ana.click('a.fab');
  await ana.fill('input[placeholder="Izakaya dinner"]', 'Pizza night');
  await ana.click('.segmented label:has-text("Items")');
  await ana.fill('input[aria-label="What item 1 was"]', 'Pizza');
  await ana.fill('input[aria-label="Price of item 1"]', '3000');
  await ana.click('button:has-text("Add item")');
  await ana.fill('input[aria-label="What item 2 was"]', 'Beer');
  await ana.fill('input[aria-label="Price of item 2"]', '1200');
  await ana.click('[aria-label="Who had item 2"] button:has-text("Cai")');
  await ana.click('button:has-text("Add item")');
  await ana.fill('input[aria-label="Price of item 3"]', '300');
  for (const who of ['Ana', 'Bob']) await ana.click(`[aria-label="Who had item 3"] button:has-text("${who}")`);
  check(await ana.getAttribute('[aria-label="Who had item 3"] button:has-text("Cai")', 'aria-pressed') === 'true', 'item 3 is just Cai’s');
  await ana.click('button:has-text("Add tax, tip or discount")');
  await ana.fill('input[aria-label="What extra 1 is"]', 'Service');
  await ana.fill('input[aria-label="Amount of extra 1"]', '450');
  check((await ana.getAttribute('input.amount-input', 'placeholder')) === '4950', 'a blank amount shows what the items come to');
  check((await shareOf('Ana')) === '¥1,760' && (await shareOf('Bob')) === '¥1,760' && (await shareOf('Cai')) === '¥1,430', 'Items: Ana and Bob ¥1,760, Cai ¥1,430 with service shared by what they had');
  await ana.fill('input.amount-input', '5000');
  check(await waitText('main', '¥50 not on any item yet'), 'a typed amount that doesn’t match says by how much');
  check(await ana.isDisabled('button:has-text("Add expense")'), 'and can’t be saved');
  await ana.fill('input.amount-input', '');
  await ana.screenshot({ path: SHOTS + '/split-2-items.png', fullPage: true });
  await ana.click('button:has-text("Add expense")'); await ana.waitForTimeout(400);
  check(await waitText('main', 'Pizza night'), 'the itemized expense is saved');
  await ana.click('a:has-text("Pizza night")');
  check((await ana.inputValue('input[aria-label="What item 2 was"]')) === 'Beer' && (await ana.inputValue('input[aria-label="Amount of extra 1"]')) === '450', 'editing reopens the items and extras');
  await ana.click('a[aria-label="Back"]');

  // Paid by several people
  await ana.click('a.fab');
  await ana.fill('input[placeholder="Izakaya dinner"]', 'Rental car');
  await ana.fill('input.amount-input', '6000');
  await ana.selectOption('select >> nth=1', '__several');
  await ana.fill('input[aria-label="Paid by Ana"]', '4000');
  check(await waitText('main', '¥2,000 still to account for'), 'says how much of the payment isn’t accounted for');
  check(await ana.isDisabled('button:has-text("Add expense")'), 'and can’t be saved yet');
  await ana.fill('input[aria-label="Paid by Bob"]', '2000');
  await ana.screenshot({ path: SHOTS + '/split-3-payers.png', fullPage: true });
  await ana.click('button:has-text("Add expense")'); await ana.waitForTimeout(400);
  check(await waitText('main', '2 people paid'), 'the list says two people paid');
  await ana.click('a:has-text("Rental car")');
  check((await ana.inputValue('select >> nth=1')) === '__several' && (await ana.inputValue('input[aria-label="Paid by Bob"]')) === '2000', 'editing reopens who paid what');
  await ana.click('a[aria-label="Back"]');

  // Balances: Izakaya (Ana paid 9000, share 5000) + Pizza (4950, share 1760) + Car (paid 4000, share 2000)
  await ana.click('nav a:has-text("Balances")');
  const people = await text('.people');
  check(people.includes('¥9,190'), `Ana gets back ¥9,190 (${people.replace(/\s+/g, ' ').slice(0, 160)})`);

  check(errors.length === 0, `no console errors ${errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

// Importing a Splitwise export into a friendship: balances match Splitwise, dates kept, nobody notified.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
const SHOTS = path.join(__dirname, 'shots');
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };

const CSV = `Note: does not include group expenses

Date,Description,Category,Cost,Currency,Ana,Bob

2024-06-01,Movie,Movies,6000.00,JPY,0.00,0.00
2024-06-02,Shinkansen,Bus/train,10000.00,JPY,-10000.00,10000.00
2024-06-03,Hotel,Hotel,8000.00,JPY,8000.00,-8000.00
2024-06-04,Groceries,Groceries,5645.00,JPY,-2822.50,2822.50
2024-06-05,Ana paid Bob,Payment,4822.50,JPY,4822.50,-4822.50
2024-06-06,"Gas, for the car",Gas/fuel,7500.00,JPY,-3750.00,3750.00
2024-06-07,Flights,Plane,1856.00,USD,1856.00,-1856.00
2024-06-08,Bob paid Ana,Payment,1856.00,USD,-1856.00,1856.00

2024-06-09,Total balance, , ,JPY,-3750.00,3750.00
2024-06-09,Total balance, , ,USD,0.00,0.00
`;

(async () => {
  const file = path.join(SHOTS, 'splitwise-sample.csv');
  fs.writeFileSync(file, CSV);
  const browser = await chromium.launch();
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => { try { localStorage.setItem('waroo-onboarded', '1') } catch {} });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
    page.name = name;
    return page;
  };
  const waitText = async (p, sel, needle, ms = 8000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };

  const ana = await mk('ana');
  await ana.goto(B + '#/friends/add');
  await ana.fill('input[autocomplete="given-name"]', 'Ana');
  await ana.click('button:has-text("Make a friend code")');
  await ana.waitForSelector('.friend-code[data-invite-link]');
  const link = await ana.getAttribute('.friend-code', 'data-invite-link');
  const bob = await mk('bob');
  await bob.goto(link);
  await bob.fill('input[autocomplete="given-name"]', 'Bob');
  await bob.click('button:has-text("Add Ana as a friend")');
  await waitText(ana, 'header h1', 'Bob', 10000);

  await ana.goto(B + '#/settings?open=import');
  await ana.click('a:has-text("Import from Splitwise")');
  await ana.setInputFiles('input[type=file]', file);
  check(await waitText(ana, 'main', '8 entries'), 'the file is read');
  await ana.selectOption('select', { label: 'Friend: Bob' });
  check((await ana.inputValue('.who-row select >> nth=0')) !== '' && (await ana.inputValue('.who-row select >> nth=1')) !== '', 'Ana and Bob are matched by name');
  check(await waitText(ana, '.import-preview', '6 expenses and 2 payments to import'), 'the preview counts what comes in');
  check(await waitText(ana, '.import-preview', 'you owe ¥3,750'), 'and gives the balance Splitwise had');
  await ana.screenshot({ path: SHOTS + '/import-1-preview.png', fullPage: true });
  await ana.click('.import-preview button:has-text("Import")');
  check(await waitText(ana, 'main', 'Groceries', 10000), 'the expenses are in');
  check(await waitText(ana, 'main', 'Jun'), 'with their own dates');
  await ana.goto(B + '#/settings?open=import');
  await ana.click('a:has-text("Import from Splitwise")');
  await ana.setInputFiles('input[type=file]', file);
  await ana.selectOption('select', { label: 'Friend: Bob' });
  check(await waitText(ana, '.import-preview', 'Everything in this file is here already'), 'importing again adds nothing');

  await bob.goto(B + '#/friends');
  check(await waitText(bob, '.cards', 'Owes you ¥3,750', 10000), 'Bob sees the same balance');
  check(!(await bob.isVisible('.banners .banner-body')), 'and no banners about old expenses');
  await bob.goto(B + '#/activity');
  check(!(await waitText(bob, 'main', 'Today', 1500)), 'Activity files them under their own dates');

  for (const p of [ana, bob]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

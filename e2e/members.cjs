// Renaming yourself, leaving (only when square), the Payments tab, Add payment,
// and newest-first lists.
const { chromium } = require('playwright');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
(async () => {
  const browser = await chromium.launch();
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    // These tests start past the first-run guide (e2e/onboarding.cjs covers it).
    await ctx.addInitScript(() => { try { localStorage.setItem("waroo-onboarded", "1") } catch {} });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B.slice(0, -1) });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
    page.name = name;
    return page;
  };
  const text = (p, sel) => p.textContent(sel).catch(() => '');
  const waitText = async (p, sel, needle, ms = 8000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };
  const addExpense = async (p, title, amount, date) => {
    await p.click('a.fab:has-text("Add expense")');
    await p.fill('input[placeholder="Izakaya dinner"]', title);
    await p.fill('input.amount-input', amount);
    if (date) await p.fill('input[type=date]', date);
    await p.click('button:has-text("Add expense")'); await p.waitForTimeout(300);
  };

  const ana = await mk('ana');
  await ana.goto(B);
  await ana.click('a.button:has-text("Start a group")');
  await ana.fill('input[placeholder="Okinawa trip"]', 'Okinawa trip');
  await ana.fill('input[placeholder="Ana"]', 'Ana');
  await ana.fill('input[aria-label="Person 2"]', 'Bob');
  await ana.click('text=Create group'); await ana.waitForTimeout(400);
  check(await waitText(ana, '.people', 'Bob'), 'members are listed on Balances even before any expense');
  check(!(await ana.isVisible('nav a:has-text("People")')) && await ana.isVisible('nav a:has-text("Payments")'), 'tabs are Balances, Expenses and Payments');

  // Newest first
  await addExpense(ana, 'Ferry', '3000', '2026-11-18');
  await addExpense(ana, 'Dinner', '4000', '2026-11-20');
  await addExpense(ana, 'Snacks', '1000', '2026-11-20');
  await ana.click('nav a:has-text("Expenses")');
  const order = await ana.$$eval('.pager-page:not([inert]) .cards .row-main strong', (els) => els.map((e) => e.textContent));
  check(JSON.stringify(order) === JSON.stringify(['Snacks', 'Dinner', 'Ferry']), `expenses newest first (${order})`);

  // Bob joins
  await ana.click('header a:has-text("Invite")');
  await ana.click('button:has-text("Create invite link")');
  await ana.click('button:has-text("Copy link")');
  const link = await ana.evaluate(() => navigator.clipboard.readText());
  await ana.click('a[aria-label="Back"]');
  const bob = await mk('bob');
  await bob.goto(link);
  await waitText(bob, 'main', 'Which one are you');
  await bob.click('label.choice:has-text("Bob")');
  await bob.click('button:has-text("Join as Bob")');
  check(await waitText(bob, '.hero', 'You owe Ana'), 'Bob joined and owes Ana ¥4,000');

  // Bob renames himself
  await bob.click('.people a[aria-label="Change your name"]');
  check(await bob.waitForSelector('h1:has-text("Your name")', { timeout: 4000 }).then(() => true, () => false), 'the pencil by Bob’s name lets him change it');
  await bob.fill('input[autocomplete="given-name"]', 'Bobby');
  await bob.click('button:has-text("Save")');
  check(await waitText(bob, 'main', 'Saved'), 'Bob saves his new name');
  check(await waitText(ana, '.people', 'Bobby'), 'Ana sees Bob’s new name');

  // Leaving is in the group's settings, and blocked while he owes money
  await bob.click('a[aria-label="Back"]');
  await bob.click('header a.title-link');
  check(await waitText(bob, 'main', 'Right now you owe ¥4,000'), 'leaving says what’s still owed');
  check(await bob.isDisabled('button:has-text("Leave group")'), 'and can’t be done yet');
  await bob.screenshot({ path: SHOTS + '/mem-1-blocked.png' });

  // Add payment from the Payments tab: two payments, newest first
  await bob.click('a[aria-label="Back"]');
  await bob.click('nav a:has-text("Payments")');
  check(await waitText(bob, 'main', 'No payments yet'), 'empty Payments tab');
  await bob.click('a.fab:has-text("Add payment")');
  check(await bob.waitForSelector('h1:has-text("Add payment")', { timeout: 4000 }).then(() => true, () => false), 'Add payment opens');
  check((await bob.$eval('select >> nth=0', (s) => s.selectedOptions[0].textContent)).includes('(you)'), 'it starts with you as the payer');
  await bob.fill('input.amount-input', '1000');
  await bob.click('button:has-text("Mark as paid")'); await bob.waitForTimeout(400);
  check(bob.url().endsWith('/payments'), 'back on the Payments tab');
  await bob.click('a.fab:has-text("Add payment")');
  await bob.fill('input.amount-input', '3000');
  await bob.click('label:has-text("Bank transfer")');
  await bob.click('button:has-text("Mark as paid")'); await bob.waitForTimeout(400);
  const pays = await bob.$$eval('.pager-page:not([inert]) .cards .amount', (els) => els.map((e) => e.textContent));
  check(JSON.stringify(pays) === JSON.stringify(['¥3,000', '¥1,000']), `payments newest first (${pays})`);
  await bob.screenshot({ path: SHOTS + '/mem-2-payments.png' });

  // Square now: Bob leaves
  await bob.click('nav a:has-text("Balances")');
  await bob.click('header a.title-link');
  await bob.click('button:has-text("Leave group")');
  check(await waitText(bob, 'button.danger', 'Tap again to leave'), 'leaving asks for a second tap');
  await bob.click('button:has-text("Tap again to leave")');
  check(await waitText(bob, 'main', 'Split anything with anyone'), 'the group leaves Bob’s phone');
  check(await waitText(ana, '.banners', 'Bobby left Okinawa trip'), 'Ana gets a banner that Bobby left');
  await ana.click('nav a:has-text("Balances")');
  await ana.waitForTimeout(300);
  check(!(await text(ana, '.people')).includes('Bobby'), 'Bobby is no longer listed');
  await ana.click('nav a:has-text("Expenses")');
  await ana.click('a:has-text("Ferry")');
  check(await waitText(ana, '.split-list', 'Bobby'), 'old expenses still show Bobby');
  await ana.click('a[aria-label="Back"]');
  await ana.click('a.fab:has-text("Add expense")');
  check(!(await text(ana, '.split-list')).includes('Bobby'), 'new expenses don’t offer Bobby');
  await ana.screenshot({ path: SHOTS + '/mem-3-after.png' });

  for (const p of [ana, bob]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

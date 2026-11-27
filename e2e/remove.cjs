// Removing someone: their phone is cut off, everyone else moves to a new key
// by themselves (including a phone that was closed at the time), old invite
// links stop working, and new invites lead to the new room with all history.
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
    page.on('console', (m) => { if (m.type() === 'error' && !/410|404/.test(m.text())) page.errors.push(m.text()); });
    page.name = name;
    page.ctx = ctx;
    return page;
  };
  const text = (p, sel) => p.textContent(sel).catch(() => '');
  const waitText = async (p, sel, needle, ms = 10000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };
  const join = async (p, link, who) => {
    await p.goto(link);
    await waitText(p, 'main', 'Which one are you');
    await p.click(`label.choice:has-text("${who}")`);
    await p.click(`button:has-text("Join as ${who}")`);
    return waitText(p, '.sync-line', 'Up to date');
  };
  const addExpense = async (p, title, amount) => {
    await p.click('nav a:has-text("Expenses")');
    await p.click('a.fab:has-text("Add expense")');
    await p.fill('input[placeholder="Izakaya dinner"]', title);
    await p.fill('input.amount-input', amount);
    await p.click('button:has-text("Add expense")'); await p.waitForTimeout(400);
  };
  const groupKey = (p) => p.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('waroo');
    open.onsuccess = () => { const req = open.result.transaction('groups').objectStore('groups').getAll(); req.onsuccess = () => resolve(req.result[0]?.key); };
  }));
  const expensesText = async (p) => { await p.click('nav a:has-text("Expenses")'); await p.waitForTimeout(300); return text(p, '.pager-page:not([inert])'); };

  const ana = await mk('ana');
  await ana.goto(B);
  await ana.click('a.button:has-text("Start a group")');
  await ana.fill('input[placeholder="Okinawa trip"]', 'Okinawa trip');
  await ana.fill('input[placeholder="Ana"]', 'Ana');
  await ana.fill('input[aria-label="Person 2"]', 'Bob');
  await ana.fill('input[aria-label="Person 3"]', 'Cai');
  await ana.fill('input[aria-label="Person 4"]', 'Eve').catch(async () => {
    await ana.click('button:has-text("Add someone")'); await ana.fill('input[aria-label="Person 4"]', 'Eve');
  });
  await ana.click('text=Create group'); await ana.waitForTimeout(400);
  await addExpense(ana, 'Dinner', '4000');

  await ana.click('header a:has-text("Invite")');
  await ana.click('.segmented label:has-text("Several people")');
  await ana.click('button:has-text("Create invite link")');
  await ana.click('button:has-text("Copy link")');
  const link = await ana.evaluate(() => navigator.clipboard.readText());
  await ana.click('a[aria-label="Back"]');

  const bob = await mk('bob');
  const cai = await mk('cai');
  const eve = await mk('eve');
  check(await join(bob, link, 'Bob'), 'Bob joins');
  check(await join(cai, link, 'Cai'), 'Cai joins');
  check(await join(eve, link, 'Eve'), 'Eve joins');
  await ana.waitForTimeout(1500);
  const before = await groupKey(ana);

  // Eve closes the app before the change
  const eveGroup = eve.url();
  await eve.goto('about:blank');

  // Ana removes Cai
  await ana.click('nav a:has-text("Balances")');
  await ana.click('.people a[aria-label="More about Cai"]');
  check(await waitText(ana, 'main', 'Remove from the group'), 'Cai’s page offers removing him');
  await ana.screenshot({ path: SHOTS + '/rm-1-person.png' });
  await ana.click('button:has-text("Remove Cai")');
  check(await waitText(ana, 'button.danger', 'Tap again to remove Cai'), 'removing asks for a second tap');
  await ana.click('button:has-text("Tap again to remove Cai")');
  check(await waitText(ana, '.sync-line', 'Up to date', 20000) && /#\/g\/[^/]+$/.test(ana.url()), 'Ana is back in the group');
  const after = await groupKey(ana);
  check(after && after !== before, 'the group has a new key on Ana’s phone');

  check(await waitText(cai, '.removed-notice', 'Ana removed you from Okinawa trip'), 'Cai’s phone says he was removed');
  await cai.screenshot({ path: SHOTS + '/rm-2-removed.png' });
  check(await waitText(bob, '.banners', 'Ana removed Cai from Okinawa trip'), 'Bob gets a banner about it');
  let bobKey;
  for (let i = 0; i < 30 && bobKey !== after; i++) { await bob.waitForTimeout(300); bobKey = await groupKey(bob); }
  check(bobKey === after, 'Bob’s phone moved to the new key by itself');

  // Cai isn't offered on new expenses or payments, but stays on old ones
  await ana.click('nav a:has-text("Expenses")');
  await ana.click('a.fab:has-text("Add expense")');
  check(!(await text(ana, '.split-list')).includes('Cai') && !(await text(ana, 'select >> nth=0')).includes('Cai'), 'new expenses don’t offer Cai');
  await ana.click('a[aria-label="Back"]');
  await ana.click('a:has-text("Dinner")');
  check((await text(ana, '.split-list')).includes('Cai'), 'Dinner still shows Cai');
  await ana.click('a[aria-label="Back"]');
  await ana.click('nav a:has-text("Payments")');
  await ana.click('a.fab:has-text("Add payment")');
  await ana.waitForSelector('select');
  const payNames = await ana.$$eval('select option', (os) => os.map((o) => o.textContent).join(' '));
  check(!payNames.includes('Cai') && payNames.includes('Bob'), `new payments don’t offer Cai (${payNames.slice(0, 120)}) ${ana.url()}`);
  await ana.click('a[aria-label="Back"]');

  // New things reach the group, not Cai
  await addExpense(bob, 'Ramen', '3000');
  check(await waitText(ana, '.pager-page:not([inert])', 'Ramen').catch(() => false) || (await expensesText(ana)).includes('Ramen'), 'Ana sees Bob’s new expense');
  await cai.waitForTimeout(2000);
  check(!(await expensesText(cai)).includes('Ramen'), 'Cai doesn’t see it');
  check(!(await cai.isVisible('a.fab')), 'Cai’s phone no longer offers adding');
  // Even if he gets to the screen
  const caiGroup = cai.url().replace(/\/expenses$/, '');
  await cai.goto(caiGroup + '/add');
  await cai.fill('input[placeholder="Izakaya dinner"]', 'Sneaky');
  await cai.fill('input.amount-input', '9000');
  check(await cai.isDisabled('button:has-text("Add expense")'), 'and if he reaches the screen, it won’t save');
  await cai.click('a[aria-label="Back"]');

  // Eve opens the app again and catches up
  await eve.goto(eveGroup);
  let eveKey;
  for (let i = 0; i < 40 && eveKey !== after; i++) { await eve.waitForTimeout(300); eveKey = await groupKey(eve); }
  check(eveKey === after, 'Eve, closed during the change, moves over when she opens the app');
  check(await waitText(eve, 'body', 'Ramen') || (await expensesText(eve)).includes('Ramen'), 'and sees Bob’s new expense');

  // The invite from before no longer works; a new one does, with all history
  const dee = await mk('dee');
  await dee.goto(link);
  check(await waitText(dee, 'main', 'turned off') || await waitText(dee, 'main', 'out of date', 1000), 'the invite from before the change no longer works');
  await ana.click('header a:has-text("Invite")');
  await ana.click('.segmented label:has-text("Several people")');
  await ana.click('button:has-text("Create invite link")');
  await ana.click('button:has-text("Copy link")');
  const fresh = await ana.evaluate(() => navigator.clipboard.readText());
  await dee.goto(fresh);
  check(await waitText(dee, 'main', 'Which one are you'), 'a new invite opens');
  check((await text(dee, 'fieldset')).includes('Cai'), 'Cai can be claimed again with a new invite');
  await dee.click('label.choice:has-text("Someone else")');
  await dee.fill('input[autocomplete="given-name"]', 'Dee');
  await dee.click('button:has-text("Join the group")');
  check(await waitText(dee, '.sync-line', 'Up to date'), 'Dee joins in the new room');
  const deeList = await expensesText(dee);
  check(deeList.includes('Dinner') && deeList.includes('Ramen') && true, 'Dee sees all the history');

  // Cai clears it from his phone
  await cai.click('nav a:has-text("Balances")');
  await cai.click('.removed-notice button:has-text("Remove from this phone")');
  check(await waitText(cai, 'main', 'Split anything with anyone'), 'Cai removes the group from his phone');

  for (const p of [ana, bob, cai, eve, dee]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

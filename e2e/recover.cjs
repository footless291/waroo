// Recovering a lost phone: another member vouches for the new one. The new
// phone is back in as the same person; the lost phone is cut off and told.
const { chromium } = require('playwright');
const B = process.env.FOOTLESS_URL || 'http://127.0.0.1:8787/';
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
(async () => {
  const browser = await chromium.launch();
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B.slice(0, -1) });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/410|404/.test(m.text())) page.errors.push(m.text()); });
    page.name = name;
    return page;
  };
  const text = (p, sel) => p.textContent(sel).catch(() => '');
  const waitText = async (p, sel, needle, ms = 10000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };
  const addExpense = async (p, title, amount) => {
    await p.click('nav a:has-text("Expenses")');
    await p.click('a.fab:has-text("Add expense")');
    await p.fill('input[placeholder="Izakaya dinner"]', title);
    await p.fill('input.amount-input', amount);
    await p.click('button:has-text("Add expense")'); await p.waitForTimeout(400);
  };
  const expensesText = async (p) => { await p.click('nav a:has-text("Expenses")'); await p.waitForTimeout(300); return text(p, '.pager-page:not([inert])'); };

  const ana = await mk('ana');
  await ana.goto(B);
  await ana.click('a.button:has-text("Start a group")');
  await ana.fill('input[placeholder="Okinawa trip"]', 'Okinawa trip');
  await ana.fill('input[placeholder="Ana"]', 'Ana');
  await ana.fill('input[aria-label="Person 2"]', 'Bob');
  await ana.fill('input[aria-label="Person 3"]', 'Cai');
  await ana.click('text=Create group'); await ana.waitForTimeout(400);
  await addExpense(ana, 'Dinner', '3000');
  await ana.click('header a:has-text("Invite")');
  await ana.click('.segmented label:has-text("Several people")');
  await ana.click('button:has-text("Create invite link")');
  await ana.click('button:has-text("Copy link")');
  const link = await ana.evaluate(() => navigator.clipboard.readText());
  await ana.click('a[aria-label="Back"]');

  const join = async (p, who) => {
    await p.goto(link);
    await waitText(p, 'main', 'Which one are you');
    await p.click(`label.choice:has-text("${who}")`);
    await p.click(`button:has-text("Join as ${who}")`);
    return waitText(p, '.sync-line', 'Up to date');
  };
  const lost = await mk('lost');
  const cai = await mk('cai');
  check(await join(lost, 'Bob'), 'Bob joins on his first phone');
  check(await join(cai, 'Cai'), 'Cai joins');
  await ana.waitForTimeout(1500);

  // Bob loses his phone. Ana helps him back in.
  await ana.click('nav a:has-text("Balances")');
  await ana.click('.people a[aria-label="More about Bob"]');
  check(await waitText(ana, 'main', 'Lost their phone?'), 'Bob’s page offers helping him back in');
  await ana.click('a:has-text("Help Bob back in")');
  check(await waitText(ana, 'main', 'Vouch for Bob’s new phone'), 'it explains what happens');
  await ana.click('button:has-text("Show the code")');
  await ana.waitForSelector('.move-qr svg.qr');
  await ana.click('button:has-text("Copy link instead")');
  const recoverLink = await ana.evaluate(() => navigator.clipboard.readText());
  check(recoverLink.includes('move-in') && recoverLink.includes('r=1'), 'the link can be copied for when they’re apart');
  await ana.screenshot({ path: SHOTS + '/rec-1-code.png' });

  const bob = await mk('bob');
  await bob.goto(B + '#/scan');
  await bob.fill('.paste-form input', recoverLink);
  await bob.click('button:has-text("Open invite")');
  check(await waitText(bob, 'main', 'the phone helping you'), 'Bob’s new phone says someone is helping');
  check(await waitText(bob, '.move-code', '') && await waitText(ana, '.move-code', ''), 'both phones show a check code');
  const codeA = (await text(ana, '.move-code')).trim();
  const codeB = (await text(bob, '.move-code')).trim();
  check(codeA.length === 4 && codeA === codeB, `the codes match (${codeA} / ${codeB})`);
  await bob.screenshot({ path: SHOTS + '/rec-2-new.png' });
  await ana.click('button:has-text("Yes, it’s Bob")');
  check(await waitText(ana, 'main', 'Bob is back', 30000), 'Ana sees Bob is back');
  check(await waitText(bob, 'main', 'All here', 30000), 'Bob’s new phone has the group');

  await bob.click('a:has-text("Open my groups")');
  await bob.click('a.card-row');
  check(await waitText(bob, '.hero', 'You owe Ana'), 'Bob is back as himself, owing Ana');
  await addExpense(bob, 'Taxi', '1500');
  await ana.click('a:has-text("Done")');
  await ana.waitForTimeout(1500);
  check((await expensesText(ana)).includes('Taxi'), 'Ana gets what Bob adds on the new phone');
  check(await waitText(cai, '.banners', 'Bob is back in Okinawa trip on a new phone'), 'Cai is told Ana vouched for Bob’s new phone');

  // The lost phone is told, can't add, and sees nothing new
  await lost.goto(B + '#/');
  await lost.click('a.card-row');
  check(await waitText(lost, '.removed-notice', 'Ana moved you to a new phone'), 'the lost phone says it was replaced');
  check(!(await lost.isVisible('a.fab')), 'and no longer offers adding');
  await lost.waitForTimeout(1500);
  check(!(await expensesText(lost)).includes('Taxi'), 'and doesn’t see what came after');
  await lost.screenshot({ path: SHOTS + '/rec-3-lost.png' });

  for (const p of [ana, bob, cai, lost]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

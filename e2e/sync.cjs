const { chromium } = require('playwright');
const B = process.env.FOOTLESS_URL || 'http://127.0.0.1:8787/';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
(async () => {
  const browser = await chromium.launch();
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B.slice(0, -1) });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
    page.name = name; page.ctx = ctx;
    return page;
  };
  const text = (p, sel) => p.textContent(sel).catch(() => '');
  const waitText = async (p, sel, needle, ms = 6000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };
  const addExpense = async (p, title, amount, payer) => {
    await p.click('a.fab');
    await p.fill('input[placeholder="Izakaya dinner"]', title);
    await p.fill('input.amount-input', amount);
    if (payer) await p.selectOption('select >> nth=1', { label: payer });
    await p.click('button:has-text("Add expense")');
    await p.waitForTimeout(300);
  };

  // Ana creates a group on her phone
  const ana = await mk('ana');
  await ana.goto(B);
  await ana.click('a.button:has-text("Start a group")');
  await ana.fill('input[placeholder="Okinawa trip"]', 'Okinawa trip');
  await ana.fill('input[placeholder="Ana"]', 'Ana');
  await ana.fill('input[aria-label="Person 2"]', 'Bob');
  await ana.fill('input[aria-label="Person 3"]', 'Cai');
  await ana.click('text=Create group'); await ana.waitForTimeout(400);
  check((await text(ana, '.sync-line')).includes('Only on this phone'), 'new group is only on this phone');
  check((await text(ana, '.invite-card')).includes('Bob and Cai can’t see this yet'), 'invite card names who has not joined');
  await addExpense(ana, 'Izakaya dinner', '9000');
  await ana.screenshot({ path: (process.env.SHOTS || '/tmp') + '/e2e-1-ana-before.png' });

  // Ana invites
  await ana.click('header a:has-text("Invite")'); await ana.waitForTimeout(800);
  await ana.click('button:has-text(\"Create invite link\")'); await ana.waitForSelector('button:has-text(\"Copy link\")');
  await ana.screenshot({ path: (process.env.SHOTS || '/tmp') + '/e2e-2-invite.png' });
  await ana.click('button:has-text("Copy link")');
  const link = await ana.evaluate(() => navigator.clipboard.readText());
  check(link.startsWith(B + '#/join?i=') && !link.includes('k='), 'invite link carries a fresh secret after #, not the group key');
  await ana.click('button:has-text("Show QR code")'); await ana.waitForTimeout(200);
  check(await ana.isVisible('svg.qr'), 'QR code shows');
  await ana.screenshot({ path: (process.env.SHOTS || '/tmp') + '/e2e-3-qr.png' });
  await ana.click('a[aria-label="Back"]'); await ana.waitForTimeout(800);
  check(await waitText(ana, '.sync-line', 'Up to date'), 'Ana is synced after inviting');

  // Bob opens the link on his phone
  const bob = await mk('bob');
  await bob.goto(link);
  check(await waitText(bob, 'main', 'Ana invited you to'), 'join screen says who invited');
  const joinText = await text(bob, 'main');
  check(joinText.includes('Okinawa trip'), 'join screen shows the group name');
  check(!joinText.includes('¥'), 'join screen shows no money before joining');
  check(await bob.isDisabled('input[type=radio] >> nth=0'), 'Ana is taken');
  await bob.screenshot({ path: (process.env.SHOTS || '/tmp') + '/e2e-4-join.png' });
  await bob.click('label.choice:has-text("Bob")');
  await bob.click('button:has-text("Join as Bob")');
  check(await waitText(bob, '.toast', 'You joined Okinawa trip as Bob'), 'Bob sees the joined toast');
  check(await waitText(bob, '.hero', 'You owe Ana'), 'Bob sees he owes Ana');
  check((await text(bob, '.hero-amount')).includes('3,000'), 'Bob owes ¥3,000');
  await bob.screenshot({ path: (process.env.SHOTS || '/tmp') + '/e2e-5-bob-joined.png' });
  check(await waitText(ana, '.sync-line', 'Bob and you are here'), 'Ana sees Bob joined');
  check(!(await ana.isVisible('.invite-card')), 'invite card goes away once someone joins');

  // Bob adds an expense; Ana sees it live
  await addExpense(bob, 'Taxi', '3000');
  await ana.click('nav a:has-text("Expenses")');
  check(await waitText(ana, 'main', 'Taxi'), 'Ana sees Bob’s taxi live');
  await ana.click('nav a:has-text("Balances")');
  check(await waitText(ana, '.hero', '5,000'), 'Ana’s balance updates: gets back ¥5,000');
  await ana.screenshot({ path: (process.env.SHOTS || '/tmp') + '/e2e-6-ana-live.png' });

  // Ana goes offline and adds something; it reaches Bob when she's back
  await ana.ctx.setOffline(true);
  check(await waitText(ana, '.sync-line', 'Offline'), 'Ana sees she is offline');
  await addExpense(ana, 'Snacks', '600');
  await ana.screenshot({ path: (process.env.SHOTS || '/tmp') + '/e2e-7-offline.png' });
  await bob.click('nav a:has-text("Expenses")');
  await bob.waitForTimeout(1500);
  check(!(await text(bob, 'main')).includes('Snacks'), 'Bob does not see it while Ana is offline');
  await ana.ctx.setOffline(false);
  check(await waitText(bob, 'main', 'Snacks', 10000), 'Bob gets Ana’s offline expense once she reconnects');
  check(await waitText(ana, '.sync-line', 'Up to date', 10000), 'Ana is back up to date');

  // Dee joins as someone new
  const dee = await mk('dee');
  await dee.goto(link);
  await waitText(dee, 'main', 'Which one are you');
  await dee.click('label.choice:has-text("Someone else")');
  await dee.fill('input[autocomplete="given-name"]', 'Dee');
  await dee.click('button:has-text("Join the group")');
  check(await waitText(dee, '.toast', 'as Dee'), 'Dee joins as a new person');
  await ana.click('nav a:has-text("People")');
  check(await waitText(ana, 'main', 'Dee'), 'Ana sees Dee in the group');

  // Reopening an invite on a phone already in the group goes straight to it
  await bob.goto(link); await bob.waitForTimeout(800);
  check(bob.url().includes('#/g/'), 'Bob reopening the link lands in the group');

  // Settle-up recorded by Bob reaches Ana
  await bob.click('nav a:has-text("Balances")'); await bob.waitForTimeout(300);
  await bob.click('.hero a:has-text("Settle up")');
  await bob.click('button:has-text("Mark as paid")'); await bob.waitForTimeout(300);
  await ana.click('nav a:has-text("Expenses")');
  check(await waitText(ana, 'main', 'Bob paid you'), 'Ana sees Bob’s payment');

  // Persistence: Bob reloads and still has everything
  await bob.reload(); await bob.waitForTimeout(800);
  check(await waitText(bob, '.sync-line', 'Up to date'), 'Bob reloads and reconnects');

  for (const p of [ana, bob, dee]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

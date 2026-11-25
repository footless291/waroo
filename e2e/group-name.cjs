// Renaming a group (and changing its main currency) from the group's header;
// the other phone sees it.
const { chromium } = require('playwright');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
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
    page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
    page.name = name;
    return page;
  };
  const waitText = async (p, sel, needle, ms = 8000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };

  const ana = await mk('ana');
  await ana.goto(B);
  await ana.click('a.button:has-text("Start a group")');
  await ana.fill('input[placeholder="Okinawa trip"]', 'Okinawa trip');
  await ana.fill('input[placeholder="Ana"]', 'Ana');
  await ana.fill('input[aria-label="Person 2"]', 'Bob');
  await ana.click('text=Create group'); await ana.waitForTimeout(300);
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
  await waitText(bob, '.sync-line', 'Up to date');

  await ana.click('header a.title-link');
  check(await waitText(ana, 'h1', 'Group settings'), 'tapping the group name opens its settings');
  check(await ana.isDisabled('button:has-text("Save")'), 'nothing to save until something changes');
  await ana.fill('input[maxlength="80"]', '  ');
  check(await ana.isDisabled('button:has-text("Save")'), 'an empty name can’t be saved');
  await ana.fill('input[maxlength="80"]', 'Okinawa 2026');
  await ana.selectOption('select', 'USD');
  await ana.click('button:has-text("Save")');
  check(await waitText(ana, 'header h1', 'Okinawa 2026'), 'the new name shows in the group');
  check(await waitText(bob, 'header h1', 'Okinawa 2026'), 'and on Bob’s phone');
  await bob.click('a.fab');
  check((await bob.inputValue('select >> nth=0')) === 'USD', 'new expenses start in the new main currency');
  await bob.goto(B + '#/');
  check(await waitText(bob, '.cards', 'Okinawa 2026'), 'the group list uses the new name');

  for (const p of [ana, bob]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

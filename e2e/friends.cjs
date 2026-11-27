// Friends: a two-person split outside any group. Screenshots in e2e/shots/friends-*.png.
const { chromium } = require('playwright');
const path = require('path');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
const SHOTS = path.join(__dirname, 'shots');
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };

(async () => {
  const browser = await chromium.launch();
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => { try { localStorage.setItem('waroo-onboarded', '1') } catch {} });
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
  await ana.goto(B + '#/friends');
  check(await waitText(ana, 'main', 'Split with a friend, no group needed'), 'the Friends tab says what it’s for');
  await ana.screenshot({ path: SHOTS + '/friends-1-empty.png' });
  await ana.click('a.button:has-text("Add a friend")');
  await ana.fill('input[autocomplete="given-name"]', 'Ana');
  await ana.click('button:has-text("Make a friend code")');
  await ana.waitForSelector('.friend-code[data-invite-link]');
  const link = await ana.getAttribute('.friend-code', 'data-invite-link');
  check(!!link && link.includes('#/join?i='), 'a friend code is made');
  await ana.screenshot({ path: SHOTS + '/friends-2-code.png' });

  await ana.goto(B + '#/friends');
  check(await waitText(ana, '.cards', 'Friend code, not used yet'), 'the unused code is listed under Friends');
  await ana.goto(B + '#/');
  check(!(await waitText(ana, 'main', 'Ana', 1500)), 'and not under Groups');
  await ana.goto(B + '#/friends'); await ana.click('a.card-row'); await ana.waitForSelector('.friend-code[data-invite-link]');

  const bob = await mk('bob');
  await bob.goto(link);
  check(await waitText(bob, 'main', 'Ana wants to add you as a friend'), 'Bob sees a friend request from Ana');
  await bob.screenshot({ path: SHOTS + '/friends-3-request.png' });
  await bob.fill('input[autocomplete="given-name"]', 'Bob');
  await bob.click('button:has-text("Add Ana as a friend")');
  check(await waitText(bob, 'header h1', 'Ana'), 'Bob’s side is called Ana');
  check(await waitText(ana, 'header h1', 'Bob', 10000), 'Ana’s code page moves on to Bob by itself');
  check(!(await ana.isVisible('header a:has-text("Invite")')), 'no inviting more people into a friendship');

  await ana.click('a.fab');
  await ana.fill('input[placeholder="Izakaya dinner"]', 'Ramen');
  await ana.fill('input.amount-input', '2000');
  await ana.click('button:has-text("Add expense")');
  await ana.waitForTimeout(800);
  await bob.goto(B + '#/friends');
  check(await waitText(bob, '.cards', 'Ana') && await waitText(bob, '.cards', 'You owe'), 'Bob’s Friends tab shows he owes Ana');
  await bob.screenshot({ path: SHOTS + '/friends-4-list.png' });
  await ana.goto(B + '#/friends');
  check(await waitText(ana, '.cards', 'Owes you'), 'Ana’s shows Bob owes her');
  await bob.goto(B + '#/activity');
  check(await waitText(bob, 'main', 'Ramen'), 'friend expenses show in Activity');

  // The code worked once.
  const cai = await mk('cai');
  await cai.goto(link);
  check(await waitText(cai, 'main', 'doesn’t work any more') || await waitText(cai, 'main', 'used already'), 'the code doesn’t work a second time');

  for (const p of [ana, bob]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

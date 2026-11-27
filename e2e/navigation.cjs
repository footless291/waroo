// The bottom menus, the Activity feed, swiping between tabs, and the
// collapsible Settings sections.
const { chromium } = require('playwright');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  // These tests start past the first-run guide (e2e/onboarding.cjs covers it).
  await ctx.addInitScript(() => { try { localStorage.setItem("waroo-onboarded", "1") } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const waitText = async (sel, needle, ms = 6000) => { try { await page.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };
  const hash = () => page.evaluate(() => location.hash);
  // A finger swipe across the middle of the screen
  // A swipe moves the page strip sideways, as a finger does; the app follows where it settles.
  const swipe = async (direction) => {
    const before = await hash();
    await page.evaluate((dir) => {
      const strip = document.querySelector('.pager');
      strip.scrollBy({ left: dir === 'left' ? strip.clientWidth : -strip.clientWidth, behavior: 'instant' });
    }, direction);
    await page.waitForFunction((h) => location.hash !== h, before, { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(150);
  };
  const makeGroup = async (name) => {
    await page.goto(B + '#/new');
    await page.fill('input[placeholder="Okinawa trip"]', name);
    await page.fill('input[placeholder="Ana"]', 'Ana');
    await page.fill('input[aria-label="Person 2"]', 'Bob');
    await page.click('text=Create group'); await page.waitForTimeout(400);
  };
  const addExpense = async (title, amount) => {
    await page.click('a.fab:has-text("Add expense")');
    await page.fill('input[placeholder="Izakaya dinner"]', title);
    await page.fill('input.amount-input', amount);
    await page.click('button:has-text("Add expense")'); await page.waitForTimeout(300);
  };

  await page.goto(B);
  check(await page.waitForSelector('nav.tabbar a:has-text("Groups")', { timeout: 5000 }).then(() => true, () => false), 'home has the bottom menu');
  check(!(await page.isVisible('a[aria-label="You: payment settings"]')) && await page.isVisible('a[aria-label="Scan a code"]'), 'only the scanner is at the top right');

  await makeGroup('Okinawa trip');
  await addExpense('Ferry', '3000');
  await page.goto(B + '#/g/' + (await hash()).split('/')[2] + '/payments');
  await page.click('a.fab:has-text("Add payment")');
  await page.fill('input.amount-input', '500');
  await page.click('button:has-text("Mark as paid")'); await page.waitForTimeout(300);
  check(await page.isVisible('nav.tabbar a:has-text("Payments")[aria-current="page"]'), 'group tabs are at the bottom');
  await makeGroup('Ramen club');
  await addExpense('Ramen', '2000');
  await page.screenshot({ path: SHOTS + '/nav-1-group.png' });

  // Activity
  await page.goto(B + '#/');
  await page.click('nav.tabbar a:has-text("Activity")');
  await page.waitForFunction(() => location.hash === '#/activity' && !document.querySelectorAll('.pager-page')[2].hasAttribute('inert'));
  check(await waitText('.pager-page:not([inert])', 'Today'), 'Activity groups items by day');
  const titles = await page.$$eval('.pager-page:not([inert]) .cards .row-main', (els) => els.map((e) => e.textContent));
  check(titles[0]?.includes('Ramen') && titles[1]?.includes('paid') && titles[2]?.includes('Ferry'), `newest first: ${titles.map((t) => t.slice(0, 12)).join(' / ')}`);
  check(titles[1]?.includes('Okinawa trip') && titles[0]?.includes('Ramen club'), 'each item says its group');
  await page.screenshot({ path: SHOTS + '/nav-2-activity.png' });
  await page.click('.cards a[href$="/payments"]');
  check(await page.waitForFunction(() => location.hash.endsWith('/payments'), null, { timeout: 3000 }).then(() => true, () => false), 'a payment opens its group on Payments');
  await page.goto(B + '#/activity');
  await page.click('.cards a:has-text("Ferry")');
  check(await page.waitForFunction(() => location.hash.endsWith('/expenses'), null, { timeout: 3000 }).then(() => true, () => false), 'an expense opens its group on Expenses');
  await page.goto(B + '#/activity');
  await page.click('a.fab:has-text("New expense")');
  check(await waitText('main', 'Which group or friend is it for?'), 'New expense asks which group, with two groups');
  await page.click('.cards a:has-text("Okinawa trip")');
  check(await page.waitForSelector('h1:has-text("Add expense")', { timeout: 4000 }).then(() => true, () => false), 'then opens Add expense in that group');

  // Swiping
  await page.goto(B + '#/'); await page.waitForTimeout(300);
  await swipe('left');
  check((await hash()) === '#/friends', 'swipe left: Groups → Friends');
  await page.waitForTimeout(200);
  await swipe('left');
  check((await hash()) === '#/activity', 'swipe left: Friends → Activity');
  await page.waitForTimeout(200);
  await swipe('left');
  check((await hash()) === '#/settings', 'swipe left: Activity → Settings');
  await page.waitForTimeout(200);
  await swipe('right');
  check((await hash()) === '#/activity', 'swipe right goes back');
  check(await page.evaluate(() => document.querySelectorAll('.pager-page')[2].hasAttribute('inert') === false && document.querySelectorAll('.pager-page')[0].hasAttribute('inert')), 'only the page you’re on can be used');
  // Tapping a tab scrolls the strip to its page
  await page.click('nav.tabbar a:has-text("Settings")');
  check(await page.waitForFunction(() => { const s = document.querySelector('.pager'); return Math.abs(s.scrollLeft - 3 * s.clientWidth) < 2; }, null, { timeout: 3000 }).then(() => true, () => false), 'tapping a tab slides to its page');
  await page.goto(B); await page.click('a.card-row:has-text("Okinawa trip")'); await page.waitForTimeout(300);
  const gid = (await hash()).split('/')[2];
  await swipe('left');
  check((await hash()) === `#/g/${gid}/expenses`, 'in a group, swipe left: Balances → Expenses');
  await page.waitForTimeout(200);
  await swipe('left'); await page.waitForTimeout(200);
  await swipe('left');
  check((await hash()) === `#/g/${gid}/payments`, 'and stops at the last tab');

  // Settings
  await page.goto(B + '#/settings');
  const toggles = await page.$$eval('button.collapsible-toggle', (els) => els.map((e) => [e.textContent, e.getAttribute('aria-expanded')]));
  check(toggles.length === 6 && toggles.every(([, open]) => open === 'false'), 'every Settings section starts closed');
  await page.click('button.collapsible-toggle:has-text("Wallet")');
  check(await waitText('.collapsible.open', 'Friends pay you') || await waitText('.collapsible.open', 'When you pay'), 'opening Wallet shows it');
  await page.screenshot({ path: SHOTS + '/nav-3-settings.png' });
  await page.evaluate(() => document.querySelector('.pager-page:not([inert])').scrollTo(0, 99999));
  await page.waitForTimeout(200);
  // Close it from its own title, as someone would after scrolling back a little
  await page.evaluate(() => document.querySelector('button.collapsible-toggle').click());
  await page.waitForTimeout(700);
  const top = await page.evaluate(() => document.querySelector('.collapsible').getBoundingClientRect().top);
  const headerBottom = await page.evaluate(() => document.querySelector('.pager-page:not([inert])').getBoundingClientRect().top);
  check(top >= headerBottom - 1 && top < 400, `closing scrolls the section’s title into view (top ${Math.round(top)})`);

  check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

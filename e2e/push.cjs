// Push notifications, end to end on this machine:
// - a fake push service (127.0.0.1:9911, allowed via .dev.vars) records wake-ups
//   and checks the relay's VAPID signature;
// - wake-ups go only to phones that aren't connected, and only for news;
// - the service worker, woken through Chromium's devtools protocol, catches up,
//   decrypts on the phone and writes the notification.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const B = process.env.FOOTLESS_URL || 'http://127.0.0.1:8787/';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
const devPublic = /VAPID_PUBLIC_KEY=(\S+)/.exec(fs.readFileSync(__dirname + '/../.dev.vars', 'utf8'))[1];
const b64 = (s) => Buffer.from(s, 'base64url');

(async () => {
  // The fake push service
  const wakes = [];
  const server = http.createServer(async (req, res) => {
    const auth = req.headers.authorization || '';
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(auth);
    let valid = false;
    if (m && m[4] === devPublic) {
      const key = await crypto.subtle.importKey('raw', b64(m[4]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64(m[3]), Buffer.from(`${m[1]}.${m[2]}`));
    }
    wakes.push({ path: req.url, valid, ttl: req.headers.ttl });
    res.writeHead(req.url === '/gone' ? 410 : 201).end();
  }).listen(9911, '127.0.0.1');

  // The full Chromium build: the stripped-down headless shell always denies notifications.
  const browser = await chromium.launch({ channel: 'chromium' });
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write', 'notifications'], { origin: B.slice(0, -1) });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
    page.name = name; page.ctx = ctx;
    return page;
  };
  const waitText = async (p, sel, needle, ms = 8000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };
  const waitFor = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  const setEndpoint = (p, url) => p.evaluate((url) => new Promise((resolve, reject) => {
    const open = indexedDB.open('footless');
    open.onsuccess = () => { const tx = open.result.transaction('settings', 'readwrite'); tx.objectStore('settings').put(url, 'pushEndpoint'); tx.oncomplete = () => resolve(); tx.onerror = reject; };
  }), url);

  // Ana and Bob share a group
  const ana = await mk('ana');
  await ana.goto(B);
  await ana.click('a.button:has-text("Start a group")');
  await ana.fill('input[placeholder="Okinawa trip"]', 'Okinawa trip');
  await ana.fill('input[placeholder="Ana"]', 'Ana');
  await ana.fill('input[aria-label="Person 2"]', 'Bob');
  await ana.click('text=Create group'); await ana.waitForTimeout(400);
  await ana.click('header a:has-text("Invite")'); await ana.waitForTimeout(800);
  await ana.click('button:has-text(\"Create invite link\")'); await ana.waitForSelector('button:has-text(\"Copy link\")');
  await ana.click('button:has-text("Copy link")');
  const link = await ana.evaluate(() => navigator.clipboard.readText());
  await ana.click('a[aria-label="Back"]');
  const bob = await mk('bob');
  await bob.goto(link);
  await waitText(bob, 'main', 'Which one are you');
  await bob.click('label.choice:has-text("Bob")');
  await bob.click('button:has-text("Join as Bob")');
  check(await waitText(bob, '.sync-line', 'Up to date'), 'Bob joined');
  check(await waitText(ana, '.banners', 'Bob joined Okinawa trip'), 'Ana gets a banner when Bob joins');

  // The nudge, and the You screen card (headless Chromium has no real push service)
  check(await ana.waitForSelector('.nudge:has-text("Get a notification")', { timeout: 4000 }).then(() => true, () => false), 'a shared group suggests notifications');
  await ana.click('.nudge button:has-text("Not now")');
  check(await ana.waitForSelector('.nudge', { state: 'detached', timeout: 3000 }).then(() => true, () => false), '“Not now” puts the suggestion away');

  // Bob's phone subscribes (endpoint set directly; the rest is the real code path)
  await setEndpoint(bob, 'http://127.0.0.1:9911/bob');
  await bob.reload();
  check(await waitText(bob, '.sync-line', 'Up to date'), 'Bob reconnects with notifications on');
  await bob.waitForTimeout(300);

  // While Bob's app is open, he isn't woken: he gets it live
  await ana.click('a.fab');
  await ana.fill('input[placeholder="Izakaya dinner"]', 'Lunch');
  await ana.fill('input.amount-input', '2000');
  await ana.click('button:has-text("Add expense")');
  await ana.waitForTimeout(1500);
  check(wakes.length === 0, 'no wake-up for a phone that is connected');

  // Bob closes the app
  const bobCtx = bob.ctx;
  await bob.close();
  await ana.waitForTimeout(800);

  // News wakes him; an edit doesn't
  await ana.goto(B + '#/'); await ana.click('a.card-row'); await ana.waitForTimeout(500);
  await ana.click('a.fab');
  await ana.fill('input[placeholder="Izakaya dinner"]', 'Taxi');
  await ana.fill('input.amount-input', '3000');
  await ana.click('button:has-text("Add expense")');
  check(await waitFor(() => wakes.length === 1), 'a new expense wakes Bob’s phone');
  check(wakes[0]?.path === '/bob' && wakes[0]?.valid, 'the wake-up is signed by the relay (VAPID)');
  await ana.click('nav a:has-text("Expenses")');
  await ana.click('a:has-text("Taxi")');
  await ana.fill('input.amount-input', '3300');
  await ana.click('button:has-text("Save")');
  await ana.waitForTimeout(1500);
  check(wakes.length === 1, 'editing an expense doesn’t wake anyone');

  // Bob's service worker handles the wake-up: catches up, decrypts, notifies
  const sw = await bobCtx.newPage();
  await sw.goto(B + 'icon.svg');
  const cdp = await bobCtx.newCDPSession(sw);
  const reg = new Promise((resolve) => cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
    const r = e.registrations.find((r) => r.scopeURL === B && !r.isDeleted);
    if (r) resolve(r.registrationId);
  }));

  await cdp.send('ServiceWorker.enable');
  const registrationId = await Promise.race([reg, new Promise((_, no) => setTimeout(() => no(new Error('no service worker registration')), 10000))]);
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: B.slice(0, -1), registrationId, data: '' });
  const notes = async () => sw.evaluate(async () => (await (await navigator.serviceWorker.getRegistration()).getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag })));
  let shown = [];
  await waitFor(() => false, 1500);
  shown = await notes();
  console.log('     notification:', JSON.stringify(shown));
  check(shown.length === 1, 'one notification for the group');
  check(shown[0]?.title === 'Ana added Taxi, ¥3,300', 'it says what happened, as it is now (edited to ¥3,300)');
  check(shown[0]?.body === 'Your share is ¥1,650, in Okinawa trip', 'and Bob’s share');

  // The worker saved what it fetched: opening the app shows it without a wake-up storm
  const bob2 = await bobCtx.newPage();
  bob2.errors = []; bob2.on('pageerror', (e) => bob2.errors.push(String(e)));
  await bob2.goto(B); await bob2.click('a.card-row');
  check(await waitText(bob2, '.hero', 'You owe Ana'), 'Bob opens the app and sees the new balance');

  // A payment while Bob is away: the notification says he was paid... (Bob pays Ana here; Ana is away)
  await setEndpoint(ana, 'http://127.0.0.1:9911/ana');
  await ana.reload(); await ana.waitForTimeout(800);
  const anaCtx = ana.ctx;
  await ana.close();
  await bob2.click('.hero a:has-text("Settle up")');
  await bob2.click('button:has-text("Mark as paid")');
  check(await waitFor(() => wakes.some((w) => w.path === '/ana')), 'a payment wakes Ana’s phone');
  const anaSw = await anaCtx.newPage();
  await anaSw.goto(B + 'icon.svg');
  const cdp2 = await anaCtx.newCDPSession(anaSw);
  const reg2 = new Promise((resolve) => cdp2.on('ServiceWorker.workerRegistrationUpdated', (e) => {
    const r = e.registrations.find((r) => r.scopeURL === B && !r.isDeleted); if (r) resolve(r.registrationId);
  }));
  await cdp2.send('ServiceWorker.enable');
  await cdp2.send('ServiceWorker.deliverPushMessage', { origin: B.slice(0, -1), registrationId: await Promise.race([reg2, new Promise((_, no) => setTimeout(() => no(new Error('no service worker registration')), 10000))]), data: '' });
  await new Promise((r) => setTimeout(r, 1500));
  const anaNotes = await anaSw.evaluate(async () => (await (await navigator.serviceWorker.getRegistration()).getNotifications()).map((n) => n.title));
  console.log('     notification:', JSON.stringify(anaNotes));
  check(anaNotes.some((t) => /Bob marked ¥\d[\d,]* as paid to you/.test(t)), 'Ana’s notification: Bob marked it as paid');

  for (const p of [bob2]) check(p.errors.length === 0, `${p.name || 'bob2'}: no page errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  server.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

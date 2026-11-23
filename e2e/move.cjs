// Moving to a new phone: the code check, someone else racing to scan the code,
// and the groups working on the new phone (and no longer on the old one).
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
    page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
    page.name = name;
    return page;
  };
  const text = (p, sel) => p.textContent(sel).catch(() => '');
  const waitText = async (p, sel, needle, ms = 10000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };
  // Ana's old phone: a shared group with Bob, a group only on this phone, and her Lightning address
  const old = await mk('old');
  await old.goto(B);
  await old.click('a.button:has-text("Start a group")');
  await old.fill('input[placeholder="Okinawa trip"]', 'Okinawa trip');
  await old.fill('input[placeholder="Ana"]', 'Ana');
  await old.fill('input[aria-label="Person 2"]', 'Bob');
  await old.click('text=Create group'); await old.waitForTimeout(400);
  await old.click('a.fab');
  await old.fill('input[placeholder="Izakaya dinner"]', 'Dinner');
  await old.fill('input.amount-input', '6000');
  await old.click('button:has-text("Add expense")'); await old.waitForTimeout(300);
  await old.click('header a:has-text("Invite")'); await old.waitForTimeout(800);
  await old.click('button:has-text(\"Create invite link\")'); await old.waitForSelector('button:has-text(\"Copy link\")');
  await old.click('button:has-text("Copy link")');
  const invite = await old.evaluate(() => navigator.clipboard.readText());
  const bob = await mk('bob');
  await bob.goto(invite);
  await waitText(bob, 'main', 'Which one are you');
  await bob.click('label.choice:has-text("Bob")');
  await bob.click('button:has-text("Join as Bob")');
  check(await waitText(bob, '.hero', 'You owe Ana'), 'Bob joined and owes Ana');
  await old.goto(B + '#/new');
  await old.fill('input[placeholder="Okinawa trip"]', 'Solo notes');
  await old.fill('input[placeholder="Ana"]', 'Ana');
  await old.click('text=Create group'); await old.waitForTimeout(400);
  await old.goto(B + '#/settings?open=wallet');
  await old.route('https://pay.example.com/**', (route) => route.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ tag: 'payRequest', callback: 'https://pay.example.com/cb', minSendable: 1000, maxSendable: 1e11, metadata: '[]' }) }));
  await old.click('.pager.inline .pager-page:not([inert]) .setup-card:has-text("Add a different wallet") button:has-text("Add")');
  await old.fill('input[placeholder="you@walletofsatoshi.com"]', 'ana@pay.example.com');
  await old.click('.pager.inline .pager-page:not([inert]) .wallet-guide button:has-text("Add")');
  await waitText(old, '.pager.inline .pager-page:not([inert]) .wallet-list', 'ana@pay.example.com');
  // Two wallet connections, and a browser wallet that can't move
  const settings = (p, fn) => p.evaluate((fn) => new Promise((resolve) => {
    const open = indexedDB.open('footless');
    open.onsuccess = () => { const tx = open.result.transaction('settings', 'readwrite'); const st = tx.objectStore('settings'); new Function('st', 'resolve', fn)(st, resolve); };
  }), fn);
  await settings(old, `st.put([
    { id: 'w1', provider: 'other', name: 'Alby Hub', kind: 'nwc', url: 'nostr+walletconnect://aa?relay=wss://relay.example&secret=11' },
    { id: 'w2', provider: 'coinos', name: 'Coinos', kind: 'nwc', url: 'nostr+walletconnect://bb?relay=wss://relay.coinos.io&secret=22' },
    { id: 'w3', provider: 'other', name: 'Browser wallet', kind: 'webln' },
  ], 'sendWallets'); resolve()`);

  // Someone glimpses the code and scans it too: the move stops, nothing leaks
  await old.goto(B + '#/settings?open=move');
  await old.click('a:has-text("Move to a new phone")');
  check(await old.waitForSelector('h1:has-text("Move to a new phone")', { timeout: 4000 }).then(() => true, () => false), 'move screen opens from You');
  await old.click('button:has-text("Show the code")');
  await old.waitForSelector('.move-qr svg.qr');
  // The link the QR code holds (the scanner itself is covered by scan-and-banners.cjs)
  const secret1 = await old.evaluate(() => document.querySelector('[data-move-link]')?.dataset.moveLink);
  check(!!secret1, 'the code holds a move link');
  const snoop = await mk('snoop');
  const newer = await mk('new');
  await newer.goto(B + '#/scan');
  await newer.fill('.paste-form input', secret1);
  await newer.click('button:has-text("Open invite")');
  check(await waitText(newer, '.move-code', ''), 'the new phone shows a check code');
  await snoop.goto(secret1);
  check(await waitText(old, 'main', 'Another phone also scanned the code'), 'a second phone scanning stops the move');
  check(await waitText(newer, 'main', 'stopped on the other phone'), 'and the new phone is told');
  check(await waitText(snoop, 'main', 'stopped on the other phone') || await waitText(snoop, 'main', 'Not moved'), 'the snoop gets nothing');
  await old.goto(B); await old.waitForTimeout(600);
  check((await old.$$('.pager-page:not([inert]) .cards a.card-row')).length === 2, 'the old phone still has both groups');

  // Saying no on the old phone
  await old.goto(B + '#/move');
  await old.click('button:has-text("Show the code")');
  await old.waitForSelector('.move-qr svg.qr');
  const secret2 = await old.evaluate(() => document.querySelector('[data-move-link]').dataset.moveLink);
  await newer.goto(secret2);
  check(await waitText(old, 'main', 'Does the new phone show these numbers'), 'old phone asks to compare');
  await old.click('button:has-text("No, stop")');
  check(await waitText(newer, 'main', 'stopped on the other phone'), '“No” stops the new phone too');

  // The real move
  await old.click('button:has-text("Start again")');
  await old.click('button:has-text("Show the code")');
  await old.waitForSelector('.move-qr svg.qr');
  await old.screenshot({ path: SHOTS + '/move-1-qr.png' });
  const secret3 = await old.evaluate(() => document.querySelector('[data-move-link]').dataset.moveLink);
  await newer.goto(B); await newer.waitForTimeout(300);
  await newer.goto(secret3);
  check(await waitText(old, 'main', 'Does the new phone show these numbers'), 'old phone asks to compare');
  const codeOld = (await text(old, '.move-code')).trim();
  const codeNew = (await text(newer, '.move-code')).trim();
  check(/^\d{4}$/.test(codeOld) && codeOld === codeNew, `both phones show the same code (${codeOld} / ${codeNew})`);
  await old.screenshot({ path: SHOTS + '/move-2-confirm.png' });
  await newer.screenshot({ path: SHOTS + '/move-3-new-code.png' });
  await old.click('button:has-text("Yes, move my groups")');
  check(await waitText(newer, 'main', 'Your 2 groups are on this phone now', 20000) && await waitText(newer, 'main', 'connections came too'), 'the new phone has both groups and the wallets');
  check(await waitText(old, 'main', 'Your 2 groups and wallets are on the new phone now', 10000), 'the old phone says they moved');
  await newer.screenshot({ path: SHOTS + '/move-4-done.png' });

  await old.goto(B); await old.waitForTimeout(600);
  await old.screenshot({ path: SHOTS + '/move-5-old.png' });
  check(await old.waitForSelector('text=Split anything with anyone', { timeout: 6000 }).then(() => true, () => false), 'the old phone has no groups left');

  await newer.click('a:has-text("Open my groups")'); await newer.waitForTimeout(600);
  const homeText = await text(newer, 'main');
  check(homeText.includes('Okinawa trip') && homeText.includes('Solo notes'), 'both groups are listed on the new phone');
  await newer.click('a.card-row:has-text("Okinawa trip")');
  check(await waitText(newer, '.hero', 'You get back'), 'balances came along');
  check(await waitText(newer, '.sync-line', 'Up to date'), 'the new phone syncs');
  await newer.click('a.fab');
  await newer.fill('input[placeholder="Izakaya dinner"]', 'Ferry');
  await newer.fill('input.amount-input', '2000');
  await newer.click('button:has-text("Add expense")'); await newer.waitForTimeout(500);
  await bob.click('nav a:has-text("Expenses")');
  check(await waitText(bob, 'main', 'Ferry'), 'Bob sees what Ana adds from her new phone');
  check(await waitText(bob, '.cards', 'Ana'), 'still as Ana');
  await newer.goto(B + '#/settings?open=wallet'); await newer.waitForTimeout(500);
  check(await waitText(newer, '.pager.inline .pager-page:not([inert]) .wallet-list', 'ana@pay.example.com'), 'her Lightning address came along');
  const readSend = (p) => settings(p, `const r = st.get('sendWallets'); r.onsuccess = () => resolve((r.result || []).map((w) => w.name).join(','))`);
  check((await readSend(newer)) === 'Alby Hub,Coinos', `her wallet connections came along, in order (${await readSend(newer)})`);
  await newer.click('.wallet .segmented label:has-text("Send")').catch(() => newer.click('label:has-text("Send")'));
  check(await waitText(newer, '.pager.inline .pager-page:not([inert]) .wallet-list', 'Alby Hub'), 'and show in Send');
  const left = await readSend(old);
  check(left === 'Browser wallet', `the old phone keeps only the browser wallet (${left})`);

  for (const p of [old, newer, bob]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

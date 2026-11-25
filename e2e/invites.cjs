// Invite links that work once, can be turned off, and expire; old links still work.
// Plus percentage splits.
const { chromium } = require('playwright');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
const b64u = (b) => Buffer.from(b).toString('base64url');
(async () => {
  // --- The relay's rules, directly ---
  const id = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const token = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const stopHash = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  const api = (path, init) => fetch(`${B}relay/invites/${path}`, init);
  const put = (p, body) => api(p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  check((await put(id, { data: 'abc', expiresAt: Date.now() + 40 * 86400000, uses: null, stopHash })).status === 400, 'relay: invites can’t last more than 31 days');
  check((await put(id, { data: 'abc', expiresAt: Date.now() + 60000, uses: 1, stopHash })).status === 201, 'relay: one-person invite stored');
  check((await put(id, { data: 'xyz', expiresAt: Date.now() + 60000, uses: null, stopHash })).status === 409, 'relay: an invite can’t be overwritten');
  check((await (await api(id)).json()).state === 'open', 'relay: checking it doesn’t use it up');
  const first = await api(`${id}/open`, { method: 'POST' });
  check(first.status === 200 && (await first.json()).data === 'abc', 'relay: first opener gets it');
  const second = await api(`${id}/open`, { method: 'POST' });
  check(second.status === 410 && (await second.json()).state === 'used', 'relay: second opener is told it was used');
  const id2 = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await put(id2, { data: 'abc', expiresAt: Date.now() + 60000, uses: null, stopHash });
  check((await api(id2, { method: 'DELETE', headers: { 'X-Stop-Token': 'wrong' } })).status === 403, 'relay: only the inviter can turn it off');
  check((await (await api(id2, { method: 'DELETE', headers: { 'X-Stop-Token': token } })).json()).state === 'stopped', 'relay: the inviter turns it off');
  check((await api(`${id2}/open`, { method: 'POST' })).status === 410, 'relay: a turned-off link gives nothing');
  const id3 = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await put(id3, { data: 'abc', expiresAt: Date.now() + 1500, uses: null, stopHash });
  await new Promise((r) => setTimeout(r, 2200));
  const late = await api(`${id3}/open`, { method: 'POST' });
  check(late.status === 410 && (await late.json()).state === 'expired', 'relay: an expired link gives nothing');

  // --- In the app ---
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
  const waitText = async (p, sel, needle, ms = 8000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };
  const join = async (p, link, who) => {
    await p.goto(link);
    await waitText(p, 'main', 'Which one are you');
    await p.click(`label.choice:has-text("${who}")`);
    await p.click(`button:has-text("Join as ${who}")`);
    return waitText(p, '.sync-line', 'Up to date');
  };

  const ana = await mk('ana');
  await ana.goto(B);
  await ana.click('a.button:has-text("Start a group")');
  await ana.fill('input[placeholder="Okinawa trip"]', 'Okinawa trip');
  await ana.fill('input[placeholder="Ana"]', 'Ana');
  await ana.fill('input[aria-label="Person 2"]', 'Bob');
  await ana.fill('input[aria-label="Person 3"]', 'Cai');
  await ana.click('text=Create group'); await ana.waitForTimeout(400);

  // The date sits beside who paid, within the screen
  await ana.click('a.fab');
  const dateBox = await ana.locator('input[type=date]').boundingBox();
  check(dateBox && dateBox.x + dateBox.width <= 390, `the date field fits on screen (right edge ${Math.round(dateBox.x + dateBox.width)})`);
  // Shares, with − and +
  await ana.click('.segmented label:has-text("Shares")');
  await ana.fill('input.amount-input', '3000');
  await ana.click('button[aria-label="One share more for Bob"]');
  await ana.click('button[aria-label="One share fewer for Cai"]');
  check((await ana.inputValue('input[aria-label="Shares for Bob"]')) === '2' && (await ana.inputValue('input[aria-label="Shares for Cai"]')) === '0', '+ and − change the shares');
  const shared = await ana.textContent('.split-list');
  check(shared.includes('¥1,000') && shared.includes('¥2,000'), 'and the split follows: Ana 1 share, Bob 2');
  check(await ana.isDisabled('button[aria-label="One share fewer for Cai"]'), 'can’t go below zero');
  await ana.goBack(); await ana.waitForTimeout(300);

  // Percentages
  await ana.click('a.fab');
  await ana.fill('input[placeholder="Izakaya dinner"]', 'Villa');
  await ana.fill('input.amount-input', '10000');
  await ana.click('.segmented label:has-text("Percent")');
  await ana.fill('input[aria-label="Percent for Ana"]', '50');
  await ana.fill('input[aria-label="Percent for Bob"]', '30');
  check(await waitText(ana, 'main', '20% left to assign'), 'percent: says how much is left');
  check(await ana.isDisabled('button:has-text("Add expense")'), 'percent: can’t save until it adds up');
  await ana.fill('input[aria-label="Percent for Cai"]', '25');
  check(await waitText(ana, 'main', '5% too much'), 'percent: says when it’s too much');
  await ana.fill('input[aria-label="Percent for Cai"]', '20');
  const preview = await text(ana, '.split-list');
  check(preview.includes('¥5,000') && preview.includes('¥3,000') && preview.includes('¥2,000'), 'percent: shares are ¥5,000, ¥3,000 and ¥2,000');
  await ana.screenshot({ path: SHOTS + '/inv-0-percent.png' });
  await ana.click('button:has-text("Add expense")'); await ana.waitForTimeout(400);
  check(await waitText(ana, 'main', 'your share ¥5,000'), 'percent: saved with Ana’s share');
  await ana.click('a:has-text("Villa")');
  check((await ana.inputValue('input[aria-label="Percent for Bob"]')) === '30', 'percent: editing shows the percentages again');
  await ana.click('a[aria-label="Back"]');

  // A one-person link
  await ana.goto(B + '#/'); await ana.click('a.card-row');
  await ana.click('header a:has-text("Invite")');
  await ana.click('.segmented label:has-text("One person")');
  await ana.click('.segmented label:has-text("1 day")');
  await ana.click('button:has-text("Create invite link")');
  check(await waitText(ana, '.invite-link', 'For one person, until'), 'the link says who it’s for and until when');
  await ana.click('button:has-text("Copy link")');
  const once = await ana.evaluate(() => navigator.clipboard.readText());
  await ana.screenshot({ path: SHOTS + '/inv-1-created.png' });

  const bob = await mk('bob');
  check(await join(bob, once, 'Bob'), 'Bob joins with the one-person link');
  const cai = await mk('cai');
  await cai.goto(once);
  check(await waitText(cai, 'main', 'already been used'), 'Cai can’t use the same one-person link');
  await cai.screenshot({ path: SHOTS + '/inv-2-used.png' });
  await bob.goto(once); await bob.waitForTimeout(1000);
  check(bob.url().includes('#/g/'), 'Bob opening his link again still lands in the group');

  // A link for several people, then turned off
  await ana.click('button:has-text("Make a different link")');
  await ana.click('.segmented label:has-text("Several people")');
  await ana.click('button:has-text("Create invite link")');
  await ana.click('button:has-text("Copy link")');
  const many = await ana.evaluate(() => navigator.clipboard.readText());
  check(await join(cai, many, 'Cai'), 'Cai joins with a link for several people');
  await ana.reload();
  check(await waitText(ana, '.cards', 'Used'), 'Ana’s list shows the one-person link was used');
  check(await waitText(ana, '.cards', 'opened once'), 'and how often the other was opened');
  await ana.click('.invite-row:has-text("For several people") button:has-text("Turn off")');
  check(await waitText(ana, '.cards', 'Turned off'), 'Ana turns the link off');
  await ana.screenshot({ path: SHOTS + '/inv-3-list.png' });
  const dee = await mk('dee');
  await dee.goto(many);
  check(await waitText(dee, 'main', 'was turned off'), 'a turned-off link doesn’t work');

  // Links from before expiring invites held the key: no longer accepted
  const { gkey, gid, anaId } = await ana.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('waroo');
    open.onsuccess = () => { const req = open.result.transaction('groups').objectStore('groups').getAll(); req.onsuccess = () => resolve({ gkey: req.result[0].key, gid: req.result[0].id, anaId: req.result[0].meId }); };
  }));
  await dee.goto(`${B}#/join?${new URLSearchParams({ g: gid, k: gkey, from: anaId })}`);
  check(await waitText(dee, "main", "out of date"), "an old-style link is refused as out of date");

  for (const p of [ana, bob, cai]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

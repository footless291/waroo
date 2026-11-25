const { chromium } = require('playwright');
const { webcrypto: wc } = require('crypto');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
const b64u = b => Buffer.from(b).toString('base64url');
(async () => {
  const browser = await chromium.launch();
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B.slice(0, -1) });
    const p = await ctx.newPage(); p.errors = [];
    p.on('pageerror', e => p.errors.push(String(e)));
    p.on('console', m => { if (m.type() === 'error') p.errors.push(m.text()); });
    return p;
  };
  const waitText = async (p, sel, needle, ms = 8000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };

  // --- A group made by the old version: no keys, unsigned events ---
  const ana = await mk();
  await ana.goto(B);
  await ana.click('a.button:has-text("Start a group")');
  await ana.fill('input[placeholder="Okinawa trip"]', 'Old trip');
  await ana.fill('input[placeholder="Ana"]', 'Ana');
  await ana.fill('input[aria-label="Person 2"]', 'Bob');
  await ana.click('text=Create group'); await ana.waitForTimeout(300);
  await ana.click('a.fab');
  await ana.fill('input[placeholder="Izakaya dinner"]', 'Ramen');
  await ana.fill('input.amount-input', '2000');
  await ana.click('button:has-text("Add expense")'); await ana.waitForTimeout(300);
  // Turn it into what the previous version stored
  await ana.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('waroo');
    r.onsuccess = () => {
      const db = r.result, tx = db.transaction(['groups', 'events'], 'readwrite');
      const gs = tx.objectStore('groups'), es = tx.objectStore('events');
      gs.getAll().onsuccess = (e) => { for (const g of e.target.result) { delete g.key; delete g.signing; delete g.publicKey; delete g.shared; gs.put(g); } };
      es.getAll().onsuccess = (e) => { for (const ev of e.target.result) {
        if (ev.type === 'group.updated') { es.delete(ev.id); continue; }
        delete ev.signer; delete ev.sig; delete ev.pending;
        if (ev.type === 'member.added') delete ev.member.key;
        es.put(ev);
      } };
      tx.oncomplete = res; tx.onerror = rej;
    };
  }));
  await ana.reload(); await ana.waitForTimeout(500);
  check(await waitText(ana, '.sync-line', 'Only on this phone'), 'old-style group still opens');
  await ana.click('header a:has-text("Invite")'); await ana.waitForTimeout(1000);
  await ana.click('button:has-text(\"Create invite link\")'); await ana.waitForSelector('button:has-text(\"Copy link\")');
  await ana.click('button:has-text("Copy link")');
  const link = await ana.evaluate(() => navigator.clipboard.readText());
  await ana.click('a[aria-label="Back"]');
  check(await waitText(ana, '.sync-line', 'Up to date'), 'old-style group upgrades and syncs when shared');
  const bob = await mk();
  await bob.goto(link);
  check(await waitText(bob, 'main', 'Old trip'), 'Bob sees the old group’s name');
  await bob.click('label.choice:has-text("Bob")');
  await bob.click('button:has-text("Join as Bob")');
  check(await waitText(bob, '.hero', '1,000'), 'Bob sees the old expense: owes ¥1,000');

  // --- Tampering at the relay ---
  // The group key and Ana's id, from her phone's storage (invite links no longer carry the key)
  const { gkey, anaId } = await ana.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('waroo');
    open.onsuccess = () => { const req = open.result.transaction('groups').objectStore('groups').getAll(); req.onsuccess = () => resolve({ gkey: req.result[0].key, anaId: req.result[0].meId }); };
  }));
  const label = new TextEncoder().encode('waroo-room-v1:');
  const raw = Buffer.from(gkey, 'base64url');
  const room = b64u(await wc.subtle.digest('SHA-256', Buffer.concat([label, raw])));
  const ws = new WebSocket(`${B.replace(/^http/, 'ws').replace(/\/$/, '')}/relay/rooms/${room}`);
  await new Promise(r => ws.onopen = r);
  // 1. Garbage that doesn't decrypt
  // 2. A properly encrypted event signed by an outsider's key, pretending to be Ana
  const outsider = await wc.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const outsiderPub = b64u(await wc.subtle.exportKey('raw', outsider.publicKey));
  const forged = { id: '11111111-2222-4333-8444-555555555555', author: anaId, clock: 999, at: new Date().toISOString(), type: 'group.updated', name: 'HACKED' };
  const canon = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canon).join(',')}]` : `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',')}}`;
  const sig = b64u(await wc.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, outsider.privateKey, new TextEncoder().encode(canon(forged))));
  const aes = await wc.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = wc.getRandomValues(new Uint8Array(12));
  const ct = await wc.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify({ v: 1, e: forged, s: sig, k: outsiderPub })));
  ws.send(JSON.stringify({ t: 'push', items: [
    { id: 'garbage-0001', data: b64u(Buffer.from('not encrypted at all')) },
    { id: forged.id, data: b64u(Buffer.concat([Buffer.from(iv), Buffer.from(ct)])) },
  ] }));
  await new Promise(r => setTimeout(r, 1500));
  ws.close();
  const anaTitle = await ana.textContent('header h1');
  const bobTitle = await bob.textContent('header h1');
  check(anaTitle === 'Old trip' && bobTitle === 'Old trip', 'forged rename from an outsider has no effect');
  check(await waitText(ana, '.sync-line', 'Up to date'), 'garbage at the relay doesn’t break sync');
  // Bob still syncs normally afterwards
  await bob.click('a.fab');
  await bob.fill('input[placeholder="Izakaya dinner"]', 'Gyoza');
  await bob.fill('input.amount-input', '800');
  await bob.click('button:has-text("Add expense")');
  await ana.click('nav a:has-text("Expenses")');
  check(await waitText(ana, 'main', 'Gyoza'), 'normal sync continues after tampering');
  for (const p of [ana, bob]) check(p.errors.length === 0, `no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

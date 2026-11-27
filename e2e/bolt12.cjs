/**
 * BOLT12: receiving at an offer (pasted, or from a ₿name in DNS), and paying
 * one through a wallet that supports NWC's `pay` method. The wallet and its
 * relay are simulated here; no real money moves.
 */
const { chromium } = require('playwright');
const crypto = require('crypto');
const NT = require('path').join(__dirname, '../node_modules/.pnpm/nostr-tools@2.26.1_typescript@7.0.2/node_modules/nostr-tools/lib/cjs/');
const { finalizeEvent, generateSecretKey, getPublicKey } = require(NT + 'pure.js');
const nip44 = require(NT + 'nip44.js');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

const OFFER = 'lno1' + 'qgsqvgnwgcg35z6ee2h3yczraddm72xrfua9uve2rlrm9deu7xyfzrcgqgn3qzsyvfkx26qkyypvr5hfx60h9w9k934lt8s2n6zc0wwtgqlulw7dythr83dqx8tzumg';
const NAMED_OFFER = 'lno1' + 'zzzqvgnwgcg35z6ee2h3yczraddm72xrfua9uve2rlrm9deu7xyfzrcgqgn3qzsyvfkx26qkyypvr5hfx60h9w9k934lt8s2n6zc0wwtgqlulw7dythr83dqx8tzumg';

// --- A simulated NWC wallet behind a simulated relay ---
function fakeWallet({ alias, canPayOffers }) {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const clientSecret = crypto.randomBytes(32).toString('hex');
  const paid = [];
  const url = `nostr+walletconnect://${pk}?relay=wss://relay-${alias.toLowerCase().replace(/\W/g, '')}.test&secret=${clientSecret}`;
  const host = `relay-${alias.toLowerCase().replace(/\W/g, '')}.test`;
  async function handle(ws) {
    const subs = new Map();
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg[0] === 'REQ') {
        const [, id, filter] = msg;
        if (filter.kinds?.includes(13194)) {
          ws.send(JSON.stringify(['EVENT', id, finalizeEvent({ kind: 13194, created_at: Math.floor(Date.now() / 1000), tags: [['encryption', 'nip44_v2']], content: 'get_info pay_invoice' + (canPayOffers ? ' pay' : '') }, sk)]));
        } else subs.set(id, filter);
        ws.send(JSON.stringify(['EOSE', id]));
      } else if (msg[0] === 'EVENT') {
        const ev = msg[1];
        ws.send(JSON.stringify(['OK', ev.id, true, '']));
        if (ev.kind !== 23194) return;
        const key = nip44.getConversationKey(sk, ev.pubkey);
        const req = JSON.parse(nip44.decrypt(ev.content, key));
        let body;
        if (req.method === 'get_info') body = { result_type: 'get_info', result: { alias, methods: ['get_info', 'pay_invoice', ...(canPayOffers ? ['pay'] : [])] } };
        else if (req.method === 'pay' && canPayOffers) {
          const preimage = crypto.randomBytes(32);
          paid.push(req.params);
          body = { result_type: 'pay', result: { state: 'settled', instruction_type: 'bolt12', amount: req.params.amount, fees_paid: 0, preimage: preimage.toString('hex'), payment_hash: crypto.createHash('sha256').update(preimage).digest('hex') } };
        } else body = { result_type: req.method, error: { code: 'NOT_IMPLEMENTED', message: `${req.method} isn’t supported` } };
        const reply = finalizeEvent({ kind: 23195, created_at: Math.floor(Date.now() / 1000), tags: [['e', ev.id], ['p', ev.pubkey]], content: nip44.encrypt(JSON.stringify(body), key) }, sk);
        for (const [id, f] of subs) if (f['#e']?.includes(ev.id)) ws.send(JSON.stringify(['EVENT', id, reply]));
      } else if (msg[0] === 'CLOSE') subs.delete(msg[1]);
    });
  }
  return { alias, url, host, handle, paid };
}

(async () => {
  const browser = await chromium.launch();
  const offerWallet = fakeWallet({ alias: 'Offer Wallet', canPayOffers: true });
  const oldWallet = fakeWallet({ alias: 'Old Wallet', canPayOffers: false });
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    // These tests start past the first-run guide (e2e/onboarding.cjs covers it).
    await ctx.addInitScript(() => { try { localStorage.setItem("waroo-onboarded", "1") } catch {} });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B.slice(0, -1) });
    await ctx.route('**/relay/rate?*', (route) => route.fulfill({ headers: cors, body: JSON.stringify({ currency: 'JPY', price: '15000000.00', source: 'Test', at: new Date().toISOString() }) }));
    // DNS-over-HTTPS: ₿bob@phoenix.example has an offer; ₿nobody has nothing; ₿unsigned isn't DNSSEC-signed
    await ctx.route('https://cloudflare-dns.com/**', (route) => {
      const name = new URL(route.request().url()).searchParams.get('name');
      if (name === 'bob.user._bitcoin-payment.phoenix.example') {
        const uri = `bitcoin:?lno=${NAMED_OFFER}`;
        return route.fulfill({ headers: cors, body: JSON.stringify({ Status: 0, AD: true, Answer: [{ type: 16, data: `"${uri.slice(0, 100)}" "${uri.slice(100)}"` }] }) });
      }
      if (name === 'unsigned.user._bitcoin-payment.phoenix.example') {
        return route.fulfill({ headers: cors, body: JSON.stringify({ Status: 0, AD: false, Answer: [{ type: 16, data: `"bitcoin:?lno=${NAMED_OFFER}"` }] }) });
      }
      return route.fulfill({ headers: cors, body: JSON.stringify({ Status: 3 }) });
    });
    for (const w of [offerWallet, oldWallet]) await ctx.routeWebSocket(new RegExp(w.host.replace('.', '\\.')), w.handle);
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/cloudflare-dns|404/.test(m.text())) page.errors.push(m.text()); });
    page.name = name;
    return page;
  };
  const waitText = async (p, sel, needle, ms = 8000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };
  const shot = (p, n) => p.screenshot({ path: `${process.env.SHOTS || '/tmp'}/b12-${n}.png` });
  const list = '.pager.inline .pager-page:not([inert]) .wallet-list';
  const addReceive = async (p, text) => {
    await p.click('.pager.inline .pager-page:not([inert]) .setup-card:has-text("Add a different wallet") button:has-text("Add")').catch(() => {});
    await p.fill('input[placeholder="you@walletofsatoshi.com"]', text);
    await p.click('.pager.inline .pager-page:not([inert]) .wallet-guide button:has-text("Add")');
  };

  // Ana and Bob share a group; Ana owes Bob ¥1,500
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
  await waitText(bob, '.toast', 'You joined');
  await bob.click('a.fab');
  await bob.fill('input[placeholder="Izakaya dinner"]', 'Dinner');
  await bob.fill('input.amount-input', '3000');
  await bob.click('button:has-text("Add expense")'); await bob.waitForTimeout(300);

  // Bob receives at a BOLT12 offer, pasted as a bitcoin: link
  await bob.goto(B + '#/settings?open=wallet');
  await addReceive(bob, `bitcoin:?lno=${OFFER.toUpperCase()}`);
  check(await waitText(bob, list, 'BOLT12 offer'), 'Bob adds a pasted BOLT12 offer');
  // …and at a ₿name; an unsigned name is refused
  await addReceive(bob, '₿unsigned@phoenix.example');
  check(await waitText(bob, '.pager.inline .pager-page:not([inert]) .wallet-guide', 'aren’t signed'), 'a name without DNSSEC is refused');
  await addReceive(bob, '₿bob@phoenix.example');
  check(await waitText(bob, list, '@phoenix.example · BOLT12'), 'Bob adds ₿bob@phoenix.example, which points to an offer');
  await shot(bob, '1-receive');

  // Ana has two wallets: one that can't pay offers, then one that can
  await ana.evaluate(([a, b]) => new Promise((resolve) => {
    const open = indexedDB.open('waroo');
    open.onsuccess = () => {
      const tx = open.result.transaction('settings', 'readwrite');
      tx.objectStore('settings').put([
        { id: 'w1', provider: 'other', name: 'Old Wallet', kind: 'nwc', url: a },
        { id: 'w2', provider: 'other', name: 'Offer Wallet', kind: 'nwc', url: b },
      ], 'sendWallets');
      tx.oncomplete = () => resolve();
    };
  }), [oldWallet.url, offerWallet.url]);
  await ana.goto(B + '#/'); await ana.click('a.card-row');
  check(await waitText(ana, '.hero', 'You owe Bob'), 'Ana owes Bob');
  await ana.click('.hero a:has-text("Settle up")');
  await ana.click('.bitcoin button:has-text("with bitcoin")');
  check(await waitText(ana, '.quote', '10,000 sats'), 'quote: 10,000 sats');
  check(await waitText(ana, '.bitcoin', 'This is a BOLT12 offer'), 'says it’s an offer');
  await ana.click('.bitcoin button:has-text("Pay with Old Wallet")');
  check(await waitText(ana, '.bitcoin', 'Old Wallet couldn’t pay: it can’t pay BOLT12 offers yet', 30000), 'a wallet without offers says so');
  check(await waitText(ana, '.bitcoin', 'Nothing was paid'), 'and nothing was paid');
  await shot(ana, '2-old');
  await ana.click('.bitcoin button:has-text("Try Offer Wallet")');
  check(await waitText(ana, '.bitcoin', 'Paid ¥1,500 to Bob (10,000 sats)', 30000), 'Offer Wallet pays the offer');
  check(offerWallet.paid.length === 1 && offerWallet.paid[0].payment === `bitcoin:?lno=${OFFER}` && offerWallet.paid[0].amount === 10_000_000, 'it was asked to pay Bob’s offer 10,000,000 msats');
  check(await waitText(bob, '.banners', 'Ana paid you ¥1,500'), 'Bob is told');
  check((await bob.textContent('.banners')).includes('over Lightning'), 'and says it went over Lightning');
  await shot(ana, '3-paid');

  // Paying an offer from another app: type the amount there, then mark it paid
  await bob.goto(B + '#/'); await bob.click('a.card-row');
  await bob.click('nav a:has-text("Expenses")');
  await bob.click('a.fab:has-text("Add expense")');
  await bob.fill('input[placeholder="Izakaya dinner"]', 'Taxi');
  await bob.fill('input.amount-input', '1000');
  await bob.click('button:has-text("Add expense")'); await bob.waitForTimeout(500);
  await ana.click('.bitcoin button:has-text("Done")'); await ana.waitForTimeout(800);
  await ana.click('.hero a:has-text("Settle up")');
  await ana.click('.bitcoin button:has-text("with bitcoin")');
  await waitText(ana, '.quote', 'sats');
  await ana.click('.bitcoin a:has-text("Open another wallet app")');
  check(await waitText(ana, '.bitcoin', 'Pay exactly 3,33'), `says exactly how much to type (${(await ana.textContent('.bitcoin .lead').catch(() => ''))})`);
  check(await ana.isVisible('.bitcoin svg.qr'), 'shows the offer as a QR code');
  await shot(ana, '4-external');
  await ana.click('.bitcoin button:has-text("I’ve paid it")');
  check(await waitText(ana, '.bitcoin', 'Paid ¥500 to Bob'), 'Ana marks it paid');

  for (const p of [ana, bob]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

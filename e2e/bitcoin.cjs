/**
 * Paying in bitcoin, against a simulated Lightning world: a fake Lightning
 * address provider that issues real signed invoices, and a fake wallet that
 * "pays" them by revealing the preimage. Nothing touches real money.
 */
const { chromium } = require('playwright');
const bolt11 = require('bolt11');
const crypto = require('crypto');
const B = process.env.FOOTLESS_URL || 'http://127.0.0.1:8787/';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };

// --- The simulated provider: pay.example.com ---
const nodeKey = crypto.randomBytes(32).toString('hex');
const metadata = JSON.stringify([['text/plain', 'Pay bob on example']]);
const invoices = new Map(); // hash -> { preimage, paid }
let lieAboutAmount = false;
let verifySupported = true;
function makeInvoice(msats) {
  const preimage = crypto.randomBytes(32);
  const hash = crypto.createHash('sha256').update(preimage).digest('hex');
  const enc = bolt11.encode({
    network: { bech32: 'bc', pubKeyHash: 0, scriptHash: 5, validWitnessVersions: [0] },
    millisatoshis: String(lieAboutAmount ? msats * 2 : msats),
    timestamp: Math.floor(Date.now() / 1000),
    tags: [
      { tagName: 'payment_hash', data: hash },
      { tagName: 'payment_secret', data: crypto.randomBytes(32).toString('hex') },
      { tagName: 'purpose_commit_hash', data: crypto.createHash('sha256').update(metadata).digest('hex') },
      { tagName: 'expire_time', data: 600 },
    ],
  });
  invoices.set(hash, { preimage: preimage.toString('hex'), paid: false });
  return { pr: bolt11.sign(enc, nodeKey).paymentRequest, hash };
}
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
async function provider(route) {
  const url = new URL(route.request().url());
  if (url.pathname === '/.well-known/lnurlp/bob') {
    return route.fulfill({ headers: cors, body: JSON.stringify({ tag: 'payRequest', callback: 'https://pay.example.com/cb/bob', minSendable: 1000, maxSendable: 1e11, metadata }) });
  }
  if (url.pathname === '/cb/bob') {
    const { pr, hash } = makeInvoice(Number(url.searchParams.get('amount')));
    return route.fulfill({ headers: cors, body: JSON.stringify({ pr, routes: [], ...(verifySupported ? { verify: `https://pay.example.com/verify/${hash}` } : {}) }) });
  }
  if (url.pathname.startsWith('/verify/')) {
    const inv = invoices.get(url.pathname.split('/').pop());
    return route.fulfill({ headers: cors, body: JSON.stringify({ status: 'OK', settled: !!inv?.paid, preimage: inv?.paid ? inv.preimage : null, pr: '' }) });
  }
  return route.fulfill({ status: 404, headers: cors, body: '{}' });
}
const payHash = (pr) => bolt11.decode(pr).tags.find((t) => t.tagName === 'payment_hash').data;
let walletLies = false;
let failEnable = 0; // the next N times, the browser wallet refuses permission (nothing paid)
let failSend = 0; // the next N payments, the wallet errors without saying whether it paid

(async () => {
  const browser = await chromium.launch();
  const mk = async (name, { webln } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B.slice(0, -1) });
    await ctx.route('https://pay.example.com/**', provider);
    // An address whose provider is down
    await ctx.route('https://broken.example.com/**', (route) => route.fulfill({ status: 500, headers: cors, body: '{}' }));
    await ctx.route('**/relay/rate?*', (route) => route.fulfill({ headers: cors, body: JSON.stringify({ currency: 'JPY', price: '15000000.00', source: 'Test', at: new Date().toISOString() }) }));
    if (webln) {
      await ctx.exposeBinding('__testWalletEnable', () => {
        if (failEnable > 0) { failEnable--; throw new Error('denied'); }
      });
      await ctx.exposeBinding('__testWalletPay', (_src, pr) => {
        if (failSend > 0) { failSend--; throw new Error('connection lost'); }
        const inv = invoices.get(payHash(pr));
        if (!inv) throw new Error('unknown invoice');
        inv.paid = true;
        return walletLies ? 'ab'.repeat(32) : inv.preimage;
      });
      await ctx.addInitScript(() => {
        window.webln = {
          enable: async () => window.__testWalletEnable(),
          getInfo: async () => ({ node: { alias: 'Test Wallet' } }),
          sendPayment: async (pr) => ({ preimage: await window.__testWalletPay(pr) }),
        };
      });
    }
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
    page.name = name;
    return page;
  };
  const waitText = async (p, sel, needle, ms = 8000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };
  const shot = (p, n) => p.screenshot({ path: `${process.env.SHOTS || '/tmp'}/btc-${n}.png` });

  // Ana and Bob share a group; Bob paid for dinner, so Ana owes Bob ¥1,500
  const ana = await mk('ana', { webln: true });
  await ana.goto(B);
  await ana.click('a.button:has-text("Start a group")');
  await ana.fill('input[placeholder="Okinawa trip"]', 'Okinawa trip');
  await ana.fill('input[placeholder="Ana"]', 'Ana');
  await ana.fill('input[aria-label="Person 2"]', 'Bob');
  await ana.click('text=Create group'); await ana.waitForTimeout(300);
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
  await waitText(bob, '.toast', 'You joined');
  await bob.click('a.fab');
  await bob.fill('input[placeholder="Izakaya dinner"]', 'Dinner');
  await bob.fill('input.amount-input', '3000');
  await bob.click('button:has-text("Add expense")'); await bob.waitForTimeout(300);

  // Before Bob adds an address, Ana can't pay him in bitcoin
  check(await waitText(ana, '.hero', 'You owe Bob'), 'Ana owes Bob');
  await ana.click('.hero a:has-text("Settle up")');
  check(await waitText(ana, '.bitcoin', 'hasn’t added a Lightning address'), 'no address: bitcoin explains why not');

  // Bob adds his Lightning address on the You screen
  await bob.goto(B + '#/you');
  check(await waitText(bob, '.wallet', 'No addresses yet'), 'someone with no wallet starts on Receive, with none yet');
  check(await waitText(bob, '.wallet-options', 'Coinos') && await waitText(bob, '.wallet-options', 'Rizful'), 'Coinos and Rizful are always offered');
  await bob.click('.wallet-option:has-text("A different wallet") button:has-text("Add")');
  await bob.fill('input[placeholder="you@walletofsatoshi.com"]', 'not an address');
  await bob.click('.wallet-guide button:has-text("Add")');
  check(await waitText(bob, '.wallet-guide', 'doesn’t look like a Lightning address'), 'You screen rejects a bad address');
  await bob.fill('input[placeholder="you@walletofsatoshi.com"]', 'Bob@pay.example.com');
  await bob.click('.wallet-guide button:has-text("Add")');
  check(await waitText(bob, '.ranked', 'bob@pay.example.com'), 'Bob adds his address');
  await shot(bob, '1-you');
  check(await waitText(ana, '.bitcoin', 'Pay ¥1,500 with bitcoin'), 'Ana now sees she can pay Bob in bitcoin');

  // Ana connects her browser wallet
  await ana.goto(B + '#/you');
  await ana.click('.wallet .segmented label:has-text("Send")');
  await ana.click('.wallet-option:has-text("A different wallet") button:has-text("Add")');
  await ana.click('button:has-text("Use my browser wallet")');
  check(await waitText(ana, '.ranked', 'Test Wallet'), 'Ana connects her wallet');
  await ana.goBack(); await ana.waitForTimeout(500);

  // A provider that asks for the wrong amount is refused, and nothing is paid
  lieAboutAmount = true;
  await ana.click('.bitcoin button:has-text("with bitcoin")');
  check(await waitText(ana, '.bitcoin', 'asked for a different amount'), 'wrong-amount invoice is refused');
  check([...invoices.values()].every((i) => !i.paid), 'nothing paid on a wrong invoice');
  lieAboutAmount = false;

  // A wallet whose proof doesn't check out: no settlement, and a warning
  walletLies = true;
  await ana.click('.bitcoin button:has-text("with bitcoin")');
  check(await waitText(ana, '.quote', '10,000 sats'), 'quote: ¥1,500 at ¥15,000,000/BTC is 10,000 sats');
  await shot(ana, '2-quote');
  await ana.click('.bitcoin button:has-text("Pay with Test Wallet")');
  check(await waitText(ana, '.bitcoin', 'proof didn’t check out'), 'bad proof is caught');
  check(await waitText(ana, '.bitcoin', 'Check your wallet'), 'and says to check the wallet before retrying');
  walletLies = false;

  // The real thing: pay, prove, record
  await ana.click('.bitcoin button:has-text("with bitcoin")');
  await waitText(ana, '.quote', 'sats');
  await ana.click('.bitcoin button:has-text("Pay with Test Wallet")');
  check(await waitText(ana, '.bitcoin', 'Paid ¥1,500 to Bob (10,000 sats)'), 'Ana pays Bob in bitcoin');
  check(await waitText(ana, '.banners', 'Payment sent: ¥1,500 to Bob'), 'Ana gets a payment-sent banner');
  check(await waitText(bob, '.banners', 'Ana paid you ¥1,500'), 'Bob gets a payment-received banner, on another screen');
  check((await bob.textContent('.banners')).includes('10,000 sats, verified'), 'Bob’s banner shows the sats and the proof');
  await shot(ana, '3-paid');
  await shot(bob, '3b-bob-banner');
  check(!(await ana.isVisible('button:has-text("Mark as paid")')), 'no second way to record it once paid');
  await ana.click('.bitcoin button:has-text("Done")'); await ana.waitForTimeout(400);
  check(await waitText(ana, 'main', 'All square'), 'Ana is all square');
  await bob.goto(B + '#/');
  await bob.click('a.card-row'); await bob.waitForTimeout(400);
  await bob.click('nav a:has-text("Payments")');
  check(await waitText(bob, 'main', 'Bitcoin, 10,000 sats, verified'), 'Bob sees the verified bitcoin payment');
  await shot(bob, '4-bob-sees');

  // Paying from another wallet app: the provider confirms, the app notices
  await bob.click('nav a:has-text("Expenses")');
  await bob.click('a.fab:has-text("Add expense")');
  await bob.fill('input[placeholder="Izakaya dinner"]', 'Taxi');
  await bob.fill('input.amount-input', '1000');
  await bob.click('button:has-text("Add expense")'); await bob.waitForTimeout(300);
  await ana.waitForTimeout(800);
  await ana.click('.hero a:has-text("Settle up")');
  await ana.click('.bitcoin button:has-text("with bitcoin")');
  await waitText(ana, '.quote', 'sats');
  await ana.click('.bitcoin a:has-text("Open another wallet app")');
  check(await ana.isVisible('.bitcoin svg.qr'), 'shows a QR code for another wallet app');
  check(await waitText(ana, '.bitcoin', 'Waiting for the payment'), 'waits for the payment');
  await shot(ana, '5-external');
  const pending = [...invoices.entries()].filter(([, i]) => !i.paid).at(-1);
  pending[1].paid = true; // someone paid it from their phone's wallet app
  check(await waitText(ana, '.bitcoin', 'Paid ¥500 to Bob', 10000), 'the app notices the payment by itself');

  // Bob adds a second address and puts it first; its provider is down, so Ana's
  // phone quietly uses the next one (asking for an invoice moves no money)
  await bob.goto(B + '#/you');
  await bob.click('.wallet .segmented label:has-text("Receive")');
  await bob.click('.wallet-option:has-text("A different wallet") button:has-text("Add")');
  await bob.fill('input[placeholder="you@walletofsatoshi.com"]', 'bob@broken.example.com');
  await bob.click('.wallet-guide button:has-text("Add")');
  check(await waitText(bob, '.wallet-guide', 'didn’t answer'), 'an address that doesn’t answer isn’t added');
  await bob.route('https://broken.example.com/**', (route) => route.fulfill({ headers: cors, body: JSON.stringify({ tag: 'payRequest', callback: 'https://broken.example.com/cb', minSendable: 1000, maxSendable: 1e11, metadata }) }));
  await bob.click('.wallet-guide button:has-text("Add")');
  check(await waitText(bob, '.ranked', 'bob@broken.example.com'), 'Bob adds a second address, at the bottom');
  await bob.click('button[aria-label="Move bob@broken.example.com up"]');
  const order = await bob.$$eval('.ranked .address', (els) => els.map((e) => e.textContent));
  check(order[0] === 'bob@broken.example.com', 'up moves it to first');
  await shot(bob, '6-ranked');
  await bob.goto(B + '#/'); await bob.click('a.card-row');
  await bob.click('nav a:has-text("Expenses")');
  await bob.click('a.fab:has-text("Add expense")');
  await bob.fill('input[placeholder="Izakaya dinner"]', 'Ramen');
  await bob.fill('input.amount-input', '600');
  await bob.click('button:has-text("Add expense")'); await bob.waitForTimeout(800);

  // Ana has two wallets; the first refuses, and she's asked before the second is tried
  await ana.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('footless');
    open.onsuccess = () => {
      const tx = open.result.transaction('settings', 'readwrite');
      tx.objectStore('settings').put([
        { id: 'a', provider: 'other', name: 'Wallet A', kind: 'webln' },
        { id: 'b', provider: 'other', name: 'Wallet B', kind: 'webln' },
      ], 'sendWallets');
      tx.oncomplete = resolve;
    };
  }));
  await ana.goto(B + '#/'); await ana.click('a.card-row'); await ana.waitForTimeout(500);
  await ana.click('.hero a:has-text("Settle up")');
  await ana.click('.bitcoin button:has-text("with bitcoin")');
  check(await waitText(ana, '.quote', 'sats'), 'the first address is down, so Ana’s phone gets an invoice from the second');
  failEnable = 1;
  await ana.click('.bitcoin button:has-text("Pay with Wallet A")');
  check(await waitText(ana, '.bitcoin-error', 'Wallet A couldn’t pay'), 'Ana is told the first wallet failed');
  check(await waitText(ana, '.bitcoin-error', 'Nothing was paid'), 'and that nothing was paid');
  check([...invoices.values()].at(-1).paid === false, 'the next wallet wasn’t tried by itself');
  await shot(ana, '7-fallback');
  await ana.click('.bitcoin button:has-text("Try Wallet B")');
  check(await waitText(ana, '.bitcoin', 'Paid ¥300 to Bob'), 'one tap, and Wallet B pays');

  // A wallet that might have paid: Ana is told to check it first
  await bob.click('a.fab:has-text("Add expense")');
  await bob.fill('input[placeholder="Izakaya dinner"]', 'Coffee');
  await bob.fill('input.amount-input', '800');
  await bob.click('button:has-text("Add expense")'); await bob.waitForTimeout(800);
  await ana.click('.bitcoin button:has-text("Done")'); await ana.waitForTimeout(800);
  await ana.click('.hero a:has-text("Settle up")');
  await ana.click('.bitcoin button:has-text("with bitcoin")');
  await waitText(ana, '.quote', 'sats');
  failSend = 1;
  await ana.click('.bitcoin button:has-text("Pay with Wallet A")');
  check(await waitText(ana, '.bitcoin-error', 'may still have paid'), 'an unclear failure says it may still have paid');
  check(await waitText(ana, '.bitcoin', 'It didn’t pay. Try Wallet B'), 'and trying the next wallet takes a deliberate tap');
  await shot(ana, '8-unclear');
  await ana.click('.bitcoin button:has-text("It didn’t pay. Try Wallet B")');
  check(await waitText(ana, '.bitcoin', 'Paid ¥400 to Bob'), 'Wallet B pays');

  // The broken provider's 500s are part of the test, not errors.
  for (const p of [ana, bob]) p.errors = p.errors.filter((e) => !e.includes('status of 500'));
  for (const p of [ana, bob]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

/**
 * Sending a friend money and asking for it, against a simulated Lightning world: a fake Lightning
 * address provider that issues real signed invoices, and a fake wallet that
 * "pays" them by revealing the preimage. Nothing touches real money.
 */
const { chromium } = require('playwright');
const bolt11 = require('bolt11');
const crypto = require('crypto');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
const SHOTS = require('path').join(__dirname, 'shots');
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
    // These tests start past the first-run guide (e2e/onboarding.cjs covers it).
    await ctx.addInitScript(() => { try { localStorage.setItem("waroo-onboarded", "1") } catch {} });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B.slice(0, -1) });
    await ctx.route('https://pay.example.com/**', provider);
    // An address whose provider is down
    await ctx.route('https://broken.example.com/**', (route) => route.fulfill({ status: 500, headers: cors, body: '{}' }));
    // No ₿names here (an address that fails is also tried as one)
    await ctx.route('https://cloudflare-dns.com/**', (route) => route.fulfill({ headers: cors, body: JSON.stringify({ Status: 3 }) }));
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

  const friends = async (ana, bob) => {
    await ana.goto(B + '#/friends/add');
    await ana.fill('input[autocomplete="given-name"]', 'Ana');
    await ana.click('button:has-text("Make a friend code")');
    await ana.waitForSelector('.friend-code[data-invite-link]');
    const link = await ana.getAttribute('.friend-code', 'data-invite-link');
    await bob.goto(link);
    await bob.fill('input[autocomplete="given-name"]', 'Bob');
    await bob.click('button:has-text("Add Ana as a friend")');
    await waitText(ana, 'header h1', 'Bob', 10000);
  };
  const ana = await mk('ana', { webln: true });
  const bob = await mk('bob');
  await friends(ana, bob);
  const friendPage = ana.url();

  // Bob's address, Ana's wallet
  await bob.goto(B + '#/settings?open=wallet');
  await bob.click('.pager.inline .pager-page:not([inert]) .setup-card:has-text("Add a different wallet") button:has-text("Add")');
  await bob.fill('input[placeholder="you@walletofsatoshi.com"]', 'bob@pay.example.com');
  await bob.click('.pager.inline .pager-page:not([inert]) .wallet-guide button:has-text("Add")');
  await waitText(bob, '.pager.inline .pager-page:not([inert]) .wallet-list', 'bob@pay.example.com');
  await ana.goto(B + '#/settings?open=wallet');
  await ana.click('.wallet .segmented label:has-text("Send")');
  await ana.click('.pager.inline .pager-page:not([inert]) .setup-card:has-text("Add a different wallet") button:has-text("Add")');
  await ana.click('button:has-text("Use my browser wallet")');
  await waitText(ana, '.pager.inline .pager-page:not([inert]) .wallet-list', 'Test Wallet');

  const send = async (amount, purpose, note) => {
    await ana.goto(friendPage);
    await ana.click('.friend-money a:has-text("Send money")');
    await ana.fill('input.amount-input', amount);
    if (purpose) await ana.click(`.segmented label:has-text("${purpose}")`);
    if (note) await ana.fill('input[maxlength="200"]', note);
    await ana.click('button:has-text("Next")');
    await ana.click('.bitcoin button:has-text("with bitcoin")');
    await waitText(ana, '.quote', 'sats');
    await ana.click('.bitcoin button:has-text("Pay with Test Wallet")');
    return waitText(ana, '.bitcoin', 'Paid', 10000);
  };

  // Just sending: a gift, no balance
  check(await send('3000', 'Just sending', 'Happy birthday'), 'Ana sends Bob ¥3,000 from her wallet');
  check(await waitText(bob, '.banners', 'Ana sent you ¥3,000', 10000), 'Bob is told, with the note');
  check((await bob.textContent('.banners')).includes('Happy birthday'), 'including the note');
  await ana.goto(friendPage);
  check(await waitText(ana, 'main', 'Nothing to split yet'), 'a gift leaves the balance alone');
  await ana.click('nav a:has-text("Payments")');
  check(await waitText(ana, '.pager-page:not([inert])', 'You sent Bob') && await waitText(ana, '.pager-page:not([inert])', 'Happy birthday'), 'and shows under Payments as sent');
  await ana.screenshot({ path: SHOTS + '/send-1-payments.png' });

  // Lending: Bob owes it back
  check(await send('1000', 'Lending'), 'Ana lends Bob ¥1,000');
  await ana.goto(friendPage);
  check(await waitText(ana, '.hero', '¥1,000'), 'and Bob owes it back');

  // Paying for something: an expense Bob paid for Ana, and her payment; balance unchanged
  check(await send('2000', 'Paying for something', 'Concert ticket'), 'Ana pays Bob back for a concert ticket');
  await ana.goto(friendPage);
  check(await waitText(ana, '.hero', '¥1,000'), 'which leaves the balance as it was');
  await ana.click('nav a:has-text("Expenses")');
  check(await waitText(ana, '.pager-page:not([inert])', 'Concert ticket'), 'but the ticket is in the history');

  // Bob asks Ana for ¥500; she pays it from the request
  await bob.goto(B + '#/friends'); await bob.click('a.card-row:has-text("Ana")');
  await bob.click('.friend-money a:has-text("Ask for money")');
  await bob.fill('input.amount-input', '500');
  await bob.fill('input[maxlength="200"]', 'Pizza');
  await bob.click('button:has-text("Ask for ¥500")');
  check(await waitText(ana, '.banners', 'Bob asks you for ¥500', 10000), 'Ana is asked, with a notification');
  await ana.goto(B + '#/friends');
  check(await waitText(ana, '.cards', 'Asks you for ¥500'), 'and sees it on her Friends tab');
  await ana.goto(friendPage);
  check(await waitText(ana, '.request-card', 'Pizza'), 'and on Bob’s page');
  await ana.screenshot({ path: SHOTS + '/send-2-request.png' });
  await ana.click('.request-card a:has-text("Pay")');
  check((await ana.inputValue('input.amount-input')) === '500', 'paying a request fills in the amount');
  await ana.click('button:has-text("Next")');
  await ana.click('.bitcoin button:has-text("with bitcoin")');
  await waitText(ana, '.quote', 'sats');
  await ana.click('.bitcoin button:has-text("Pay with Test Wallet")');
  check(await waitText(ana, '.bitcoin', 'Paid', 10000), 'Ana pays it');
  await ana.goto(friendPage);
  check(!(await waitText(ana, '.request-card', 'Pizza', 1500)), 'and the request is done');
  check(await waitText(bob, '.banners', 'Ana sent you ¥500', 10000), 'Bob is told');

  // Ana asks Bob for what he owes; he declines
  await ana.click('.friend-money a:has-text("Ask for money")');
  check((await ana.inputValue('input.amount-input')) === '1000', 'asking fills in what Bob owes');
  await ana.click('button:has-text("Ask for ¥1,000")');
  await bob.goto(B + '#/friends'); await bob.click('a.card-row:has-text("Ana")');
  await bob.click('.request-card button:has-text("Decline")');
  check(await waitText(ana, '.banners', 'Bob declined your request for ¥1,000', 10000), 'Ana hears Bob declined');

  for (const p of [ana, bob]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

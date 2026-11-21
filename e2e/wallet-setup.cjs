// The guided wallet setup for people with no bitcoin wallet (Coinos), with
// Coinos's address lookup simulated.
const { chromium } = require('playwright');
const B = process.env.FOOTLESS_URL || 'http://127.0.0.1:8787/';
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B.slice(0, -1) });
  await ctx.route('https://coinos.io/.well-known/lnurlp/**', (route) => {
    const name = route.request().url().split('/').pop();
    if (name !== 'anna') return route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"status":"ERROR"}' });
    return route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: 'payRequest', callback: 'https://coinos.io/api/lnurl/anna', minSendable: 1000, maxSendable: 100000000000, metadata: '[["text/plain","Paying anna"]]' }),
    });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const waitText = async (sel, needle, ms = 6000) => { try { await page.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };

  await page.goto(B + '#/you');
  check(await waitText('.setup', 'Set up bitcoin'), 'the guided setup shows for someone with no wallet');
  const href = await page.getAttribute('.setup a:has-text("Open Coinos")', 'href');
  check(href === 'https://coinos.io/register', 'step 1 opens Coinos sign-up');
  await page.screenshot({ path: SHOTS + '/wallet-1-guide.png' });

  await page.fill('.setup input >> nth=0', 'Bob');
  check(await waitText('#coinos-address', 'bob@coinos.io'), 'the username becomes a Coinos address');
  await page.click('.setup button:has-text("Save")');
  check(await waitText('#coinos-address', 'Couldn’t find bob@coinos.io'), 'an unknown username is caught');

  await page.fill('.setup input >> nth=0', 'anna@coinos.io');
  await page.click('.setup button:has-text("Save")');
  check(await waitText('.setup', 'Friends can pay you at anna@coinos.io'), 'a real username is saved as the address');
  check(await waitText('.setup', 'Nostr Wallet Connect'), 'step 3 explains connecting for one-tap payments');

  await page.evaluate(() => navigator.clipboard.writeText('not a connection'));
  await page.click('.setup button:has-text("Paste")');
  check(await page.waitForFunction(() => document.querySelector('.setup input[type=password]')?.value === 'not a connection', null, { timeout: 3000 }).then(() => true, () => false), 'Paste fills in what was copied');
  await page.click('.setup button:has-text("Connect")');
  check(await waitText('.setup', 'isn’t a wallet connection'), 'a wrong connection is explained');
  await page.screenshot({ path: SHOTS + '/wallet-2-step3.png' });

  await page.reload();
  check(await page.waitForSelector('input[placeholder="you@walletofsatoshi.com"]', { timeout: 5000 }).then(() => true, () => false), 'once an address is set, the regular settings show');
  check((await page.inputValue('input[placeholder="you@walletofsatoshi.com"]')) === 'anna@coinos.io', 'with the Coinos address');

  check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

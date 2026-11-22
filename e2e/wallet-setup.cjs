// Guided wallet setup on the You screen: Coinos (username, then a pasted
// connection) and Rizful (one code), with both services simulated.
const { chromium } = require('playwright');
const B = process.env.FOOTLESS_URL || 'http://127.0.0.1:8787/';
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Content-Type': 'application/json' };
const lnurl = (name, domain) => JSON.stringify({ tag: 'payRequest', callback: `https://${domain}/cb/${name}`, minSendable: 1000, maxSendable: 1e11, metadata: '[["text/plain","x"]]' });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B.slice(0, -1) });
  await ctx.route('https://coinos.io/.well-known/lnurlp/**', (route) => {
    const name = route.request().url().split('/').pop();
    return name === 'anna' ? route.fulfill({ headers: cors, body: lnurl('anna', 'coinos.io') }) : route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  let exchanged;
  await ctx.route('https://rizful.com/nostr_onboarding_auth_token/post_for_secrets', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    exchanged = JSON.parse(route.request().postData());
    if (exchanged.secret_code !== 'GOOD-CODE') return route.fulfill({ status: 400, headers: cors, body: 'invalid code' });
    return route.fulfill({ headers: cors, body: JSON.stringify({ nwc_uri: 'nostr+walletconnect://abc?relay=wss://relay.rizful.com&secret=def', lightning_address: 'Anna@rizful.com', nostr_public_key: exchanged.nostr_public_key }) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const waitText = async (sel, needle, ms = 6000) => { try { await page.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };
  const paste = async (text) => { await page.evaluate((t) => navigator.clipboard.writeText(t), text); await page.click('.wallet-guide .paste-row button:has-text("Paste")'); };

  await page.goto(B + '#/you');
  check(await waitText('.wallet', 'No addresses yet'), 'new: Wallet starts on Receive, empty');
  check(await waitText('.wallet-options', 'Coinos') && await waitText('.wallet-options', 'Rizful') && await waitText('.wallet-options', 'A different wallet'), 'Coinos, Rizful and a different wallet are offered');
  await page.screenshot({ path: SHOTS + '/wallet-1-empty.png' });

  // Coinos
  await page.click('.wallet-option:has-text("Coinos") button:has-text("Set up")');
  check((await page.getAttribute('.wallet-guide a:has-text("Open Coinos")', 'href')) === 'https://coinos.io/register', 'Coinos step 1 opens sign-up');
  await page.fill('.wallet-guide input >> nth=0', 'Bob');
  await page.click('.wallet-guide button:has-text("Save")');
  check(await waitText('#coinos-address', 'Couldn’t find bob@coinos.io'), 'an unknown username is caught');
  await page.fill('.wallet-guide input >> nth=0', 'anna');
  await page.click('.wallet-guide button:has-text("Save")');
  check(await waitText('.ranked', 'anna@coinos.io'), 'the Coinos address joins the Receive list');
  check((await page.getAttribute('.wallet-guide a:has-text("Open Coinos Nostr settings")', 'href')) === 'https://coinos.io/settings/nostr', 'step 3 opens Coinos’s Nostr settings');
  await paste('not a connection');
  check(await page.waitForFunction(() => document.querySelector('.wallet-guide input[type=password]')?.value === 'not a connection', null, { timeout: 3000 }).then(() => true, () => false), 'Paste fills in what was copied');
  await page.click('.wallet-guide button:has-text("Connect")');
  check(await waitText('.wallet-guide', 'isn’t a wallet connection'), 'a wrong connection is explained');
  await page.click('.wallet-option:has-text("Coinos") button:has-text("Close")');
  check((await page.locator('.wallet-option', { hasText: 'Coinos' }).textContent()).includes('Connected'), 'Coinos shows as connected on Receive');

  // Rizful: one code sets up both
  await page.click('.wallet-option:has-text("Rizful") button:has-text("Set up")');
  check((await page.getAttribute('.wallet-guide a:has-text("Get a code in Rizful")', 'href')) === 'https://rizful.com/nostr_onboarding_auth_token/get_token', 'Rizful step 2 opens the code page');
  await paste('BAD');
  await page.click('.wallet-guide button:has-text("Connect")');
  check(await waitText('.wallet-guide', 'That code didn’t work'), 'a bad code is explained');
  await paste('GOOD-CODE');
  await page.click('.wallet-guide button:has-text("Connect")');
  check(await waitText('.ranked', 'anna@rizful.com'), 'the Rizful address joins Receive, after Coinos');
  check(/^[0-9a-f]{64}$/.test(exchanged?.nostr_public_key || ''), 'the code is exchanged with a fresh public key');
  await page.screenshot({ path: SHOTS + '/wallet-2-receive.png' });
  await page.click('.wallet .segmented label:has-text("Send")');
  check(await waitText('.ranked', 'Rizful'), 'and Rizful joins Send too');
  check((await page.locator('.wallet-option', { hasText: 'Rizful' }).textContent()).includes('Connected'), 'Rizful shows as connected on Send');
  check(!(await page.locator('.wallet-option', { hasText: 'Coinos' }).textContent()).includes('Connected'), 'Coinos isn’t connected for sending yet');
  await page.screenshot({ path: SHOTS + '/wallet-3-send.png' });

  // Order and removal on Receive, and it sticks
  await page.click('.wallet .segmented label:has-text("Receive")');
  await page.click('button[aria-label="Move anna@rizful.com up"]');
  let order = await page.$$eval('.ranked .address', (els) => els.map((e) => e.textContent));
  check(order.join() === 'anna@rizful.com,anna@coinos.io', 'up/down reorders');
  // Drag the second back to the top by its handle
  const handle = await page.$$('.ranked .drag-handle');
  const box = await handle[1].boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  order = await page.$$eval('.ranked .address', (els) => els.map((e) => e.textContent));
  check(order.join() === 'anna@coinos.io,anna@rizful.com', `dragging reorders (${order})`);
  await page.click('button[aria-label="Remove anna@rizful.com"]');
  await page.click('button[aria-label="Tap again to remove anna@rizful.com"]');
  await page.waitForTimeout(300);
  await page.reload();
  await page.click('.wallet .segmented label:has-text("Receive")');
  await page.waitForSelector('.ranked .address');
  order = await page.$$eval('.ranked .address', (els) => els.map((e) => e.textContent));
  check(order.join() === 'anna@coinos.io', 'removing takes two taps, and the list is kept');

  check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

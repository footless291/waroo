// Renaming wallets: a name given on Receive shows on Send for the same
// wallet (matched by provider, or by the connection's Lightning address),
// and clearing it goes back to the wallet's own name. Also checks the
// lowercase wordmark in the header.
const { chromium } = require('playwright');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  // These tests start past the first-run guide (e2e/onboarding.cjs covers it).
  await ctx.addInitScript(() => { try { localStorage.setItem("waroo-onboarded", "1") } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const text = (sel) => page.textContent(sel).catch(() => '');
  const receiveList = '.pager.inline .pager-page:nth-child(1) .wallet-list';
  const sendList = '.pager.inline .pager-page:nth-child(2) .wallet-list';

  await page.goto(B);
  check((await text('header h1')) === 'waroo', 'the header wordmark is lowercase');

  // One wallet on both sides: an address, and a connection that names the same address
  await page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('waroo');
    open.onsuccess = () => {
      const tx = open.result.transaction('settings', 'readwrite');
      const st = tx.objectStore('settings');
      st.put([{ id: 'r1', provider: 'other', address: 'ana@pay.example.com' }], 'receiveWallets');
      st.put([
        { id: 's1', provider: 'other', name: 'Alby Hub', kind: 'nwc', url: 'nostr+walletconnect://aa?relay=wss://relay.example&secret=11&lud16=Ana%40pay.example.com' },
        { id: 's2', provider: 'other', name: 'Other Hub', kind: 'nwc', url: 'nostr+walletconnect://bb?relay=wss://relay.example&secret=22' },
      ], 'sendWallets');
      tx.oncomplete = () => resolve();
    };
  }));
  await page.goto(B + '#/settings?open=wallet'); await page.waitForTimeout(500);

  await page.click(`${receiveList} button[aria-label="Rename ana"]`);
  await page.fill('.rename-form input', 'Everyday wallet');
  await page.click('.rename-form button:has-text("Save")');
  await page.waitForTimeout(200);
  const receive = await text(receiveList);
  check(receive.includes('Everyday wallet') && receive.includes('ana@pay.example.com'), 'Receive shows the new name, with the address underneath');
  await page.click('.wallet .segmented label:has-text("Send")'); await page.waitForTimeout(400);
  const send = await text(sendList);
  check(send.includes('Everyday wallet') && send.includes('Other Hub') && !send.includes('Alby Hub'), 'Send shows the same name for the same wallet, and leaves the other alone');

  // Renaming on Send works too, and an empty name goes back to the default
  await page.click(`${sendList} button[aria-label="Rename Other Hub"]`);
  await page.fill('.rename-form input', 'Savings');
  await page.press('.rename-form input', 'Enter'); await page.waitForTimeout(200);
  check((await text(sendList)).includes('Savings'), 'a connection can be renamed from Send');
  await page.click(`${sendList} button[aria-label="Rename Everyday wallet"]`);
  await page.fill('.rename-form input', '');
  await page.click('.rename-form button:has-text("Save")'); await page.waitForTimeout(200);
  check((await text(sendList)).includes('Alby Hub'), 'clearing the name brings back the wallet’s own');
  await page.click(`${sendList} button[aria-label="Rename Savings"]`);
  await page.press('.rename-form input', 'Escape'); await page.waitForTimeout(200);
  check((await page.$$('.rename-form')).length === 0 && (await text(sendList)).includes('Savings'), 'Escape cancels without changing it');
  await page.screenshot({ path: (process.env.SHOTS || '/tmp') + '/wallet-names.png' });

  check(errors.length === 0, `no console errors ${errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

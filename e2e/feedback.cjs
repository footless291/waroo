// Settings → Send feedback: a bug report with a screenshot, and signing up
// for updates. Locally, wrangler simulates the email (nothing is sent) and
// keeps sign-ups in a local D1, which this checks.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const zlib = require('zlib');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };

// A small real PNG, as a phone screenshot would be.
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = []; for (let y = 0; y < h; y++) { rows.push(0); for (let x = 0; x < w; x++) rows.push(255, (x * 255 / w) | 0, (y * 255 / h) | 0); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const subscribers = () => {
  try {
    const out = execSync(`npx wrangler d1 execute waroo --local --json --command "SELECT email, lang FROM subscribers"`, { cwd: __dirname + '/..', stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return JSON.parse(out)[0].results;
  } catch { return []; }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('400')) errors.push(m.text()); });
  const waitText = async (sel, needle, ms = 8000) => { try { await page.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };
  const sent = [];
  page.on('request', (r) => { if (r.url().endsWith('/relay/feedback')) sent.push(JSON.parse(r.postData())); });

  await page.goto(B + '#/settings?open=feedback');
  check(await waitText('.feedback', 'What happened?'), 'Settings has Send feedback, starting on Bug');
  check(await page.isDisabled('.feedback button.primary'), 'nothing to send yet');
  await page.fill('.feedback textarea', 'The date field wraps on my phone.\nSteps: open Add expense.');
  await page.setInputFiles('.feedback-add input', [{ name: 'IMG_0001.PNG', mimeType: 'image/png', buffer: png(1290, 2796) }]);
  await page.waitForSelector('.feedback-shot img');
  const shotSize = await page.$eval('.feedback-shot img', (img) => [img.naturalWidth, img.naturalHeight]);
  check(shotSize[1] === 1600, `the screenshot is shrunk before sending (${shotSize})`);
  await page.fill('.feedback input[type=email]', 'Tester@Example.com');
  await page.check('.feedback input[type=checkbox]');
  await page.screenshot({ path: SHOTS + '/feedback-1.png', fullPage: true });
  await page.click('.feedback button:has-text("Send")');
  check(await waitText('.feedback', 'It’s on its way, and you’ll get news'), 'sending says thanks');
  check(sent[0]?.kind === 'bug' && sent[0].screenshots.length === 1 && sent[0].screenshots[0].type === 'image/jpeg' && sent[0].updates === true, 'it sent the report, one JPEG screenshot and the opt-in');
  check(typeof sent[0]?.app === 'string' && sent[0].lang === 'en', 'with the app version and language');
  check((await page.inputValue('.feedback textarea')) === '' && (await page.$$('.feedback-shot')).length === 0, 'the form clears');
  check(subscribers().some((s) => s.email === 'tester@example.com'), 'the address is on the updates list');

  // Just signing up, no message
  await page.fill('.feedback input[type=email]', 'news@example.com');
  check((await page.textContent('.feedback button.primary')).includes('Sign me up'), 'with only an email ticked, the button says Sign me up');
  await page.click('.feedback button:has-text("Sign me up")');
  check(await waitText('.feedback', 'You’re on the list'), 'signing up alone works');
  check(subscribers().some((s) => s.email === 'news@example.com'), 'and is stored');

  // The server refuses junk
  const res = await page.evaluate(async () => (await fetch('/relay/feedback', { method: 'POST', body: JSON.stringify({ message: 'hi', email: 'not an email' }) })).status);
  check(res === 400, 'a bad email address is refused');

  check(errors.length === 0, `no console errors ${errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

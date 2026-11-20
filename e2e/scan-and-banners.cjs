// Joining by scanning a QR code in the app, and payment banners.
// The camera is faked: a canvas stream showing the inviter's on-screen QR code.
// Headless Chromium on Linux has no BarcodeDetector, so this runs the jsQR
// path, the same one iPhones use.
const { chromium } = require('playwright');
const B = process.env.FOOTLESS_URL || 'http://127.0.0.1:8787/';
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };
(async () => {
  const browser = await chromium.launch();
  const mk = async (name, camera) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B.slice(0, -1) });
    if (camera) await ctx.addInitScript(({ svg, deny }) => {
      navigator.mediaDevices.getUserMedia = async () => {
        if (deny) throw new DOMException('denied', 'NotAllowedError');
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 480;
        const g = canvas.getContext('2d');
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await img.decode();
        const draw = () => { g.fillStyle = '#ddd'; g.fillRect(0, 0, 640, 480); g.drawImage(img, 170, 90, 300, 300); };
        draw(); setInterval(draw, 100);
        return canvas.captureStream(10);
      };
    }, camera);
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
    page.name = name;
    return page;
  };
  const text = (p, sel) => p.textContent(sel).catch(() => '');
  const waitText = async (p, sel, needle, ms = 8000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };

  // Ana makes a group with a dinner and shows her invite QR code
  const ana = await mk('ana');
  await ana.goto(B);
  check(await ana.waitForSelector('a:has-text("Join with a QR code")', { timeout: 5000 }).then(() => true, () => false), 'empty home offers joining with a QR code');
  await ana.click('a.button:has-text("Start a group")');
  await ana.fill('input[placeholder="Okinawa trip"]', 'Ramen night');
  await ana.fill('input[placeholder="Ana"]', 'Ana');
  await ana.fill('input[aria-label="Person 2"]', 'Bob');
  await ana.click('text=Create group'); await ana.waitForTimeout(400);
  await ana.click('a.fab');
  await ana.fill('input[placeholder="Izakaya dinner"]', 'Ramen');
  await ana.fill('input.amount-input', '4000');
  await ana.click('button:has-text("Add expense")'); await ana.waitForTimeout(300);
  await ana.click('header a:has-text("Invite")'); await ana.waitForTimeout(800);
  await ana.click('button:has-text("Show QR code")'); await ana.waitForTimeout(200);
  const svg = await ana.evaluate(() => {
    const s = document.querySelector('svg.qr').cloneNode(true);
    s.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    s.setAttribute('width', '300'); s.setAttribute('height', '300');
    return s.outerHTML;
  });
  await ana.click('a[aria-label="Back"]');
  check(await waitText(ana, '.sync-line', 'Up to date'), 'Ana is synced');

  // A phone that refuses the camera gets a clear way forward
  const nocam = await mk('nocam', { svg, deny: true });
  await nocam.goto(B + '#/scan');
  check(await waitText(nocam, '.scanner', 'Allow camera access'), 'camera refused: says how to allow it');
  await nocam.fill('.paste-form input', 'https://example.com/nothing');
  await nocam.click('button:has-text("Open invite")');
  check(await waitText(nocam, '#paste-error', 'isn’t a Footless invite link'), 'pasting a wrong link explains');

  // Bob scans from the installed app
  const bob = await mk('bob', { svg });
  await bob.goto(B);
  await bob.click('a[aria-label="Scan a code"]');
  check(await bob.waitForSelector('h1:has-text("Scan a code")', { timeout: 4000 }).then(() => true, () => false), 'scan screen opens');
  check(await waitText(bob, 'main', 'Ana invited you to', 10000), 'scanning the QR code opens the invite');
  check((await text(bob, 'main')).includes('Ramen night'), 'it is Ana’s group');
  const tracksLive = await bob.evaluate(() => [...document.querySelectorAll('video')].length);
  check(tracksLive === 0, 'the camera view is gone after scanning');
  await bob.screenshot({ path: SHOTS + '/scan-1-join.png' });
  await bob.click('label.choice:has-text("Bob")');
  await bob.click('button:has-text("Join as Bob")');
  check(await waitText(bob, '.hero', 'You owe Ana'), 'Bob joined and owes Ana');

  // Bob marks a cash payment; Ana, on another screen, gets a banner
  await ana.goto(B + '#/you'); await ana.waitForTimeout(800);
  await bob.click('.hero a:has-text("Settle up")');
  await bob.click('button:has-text("Mark as paid")'); await bob.waitForTimeout(300);
  check(await waitText(ana, '.banners', 'Bob marked ¥2,000 as paid to you'), 'Ana gets a payment banner');
  await ana.screenshot({ path: SHOTS + '/scan-2-banner.png' });
  check(!(await text(bob, '.banners')).includes('Payment sent'), 'no sent banner for a manual record');
  await ana.click('.banner:has-text("as paid to you") .banner-body');
  check(await waitText(ana, 'main', 'All square'), 'tapping the banner opens the group');
  check(!(await ana.isVisible('.banner:has-text("as paid to you")')), 'and the banner goes away');

  // Old payments fetched when joining are not announced
  const cai = await mk('cai');
  await ana.click('header a:has-text("Invite")'); await ana.waitForTimeout(500);
  await ana.click('button:has-text("Copy link")');
  const link = await ana.evaluate(() => navigator.clipboard.readText());
  await cai.goto(link);
  await waitText(cai, 'main', 'Which one are you');
  check(await cai.isVisible('.notice:has-text("Home Screen")'), 'in a phone browser, the join page points to the installed app');
  await cai.click('label.choice:has-text("Someone else")');
  await cai.fill('input[autocomplete="given-name"]', 'Cai');
  await cai.click('button:has-text("Join the group")'); await cai.waitForTimeout(1500);
  check(!(await cai.isVisible('.banner')), 'joining doesn’t replay old payments as banners');

  for (const p of [ana, bob, nocam, cai]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

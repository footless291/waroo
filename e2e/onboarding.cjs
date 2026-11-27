// The first-run guide: language, welcome, Home Screen. Screenshots in e2e/shots/onboarding-*.png.
const { chromium } = require('playwright');
const path = require('path');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
const SHOTS = path.join(__dirname, 'shots');
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const LINE = IPHONE + ' Line/14.19.0';

(async () => {
  const browser = await chromium.launch();
  const mk = async (ua, { standalone = false, locale = 'en-US' } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: ua, locale, hasTouch: true, isMobile: true });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B.slice(0, -1) });
    if (standalone) await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    // The made-up invite isn't on the relay: its 404 is expected.
    page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) page.errors.push(m.text()); });
    return page;
  };
  const has = async (p, needle, ms = 6000) => { try { await p.waitForFunction((n) => document.body.innerText.includes(n), needle, { timeout: ms }); return true; } catch { return false; } };

  // An iPhone in Safari, phone set to English; picks Japanese.
  const ios = await mk(IPHONE);
  await ios.goto(B);
  check(await has(ios, 'Choose your language') && await has(ios, '言語を選んでください'), 'first thing: the language, asked in both');
  check(await ios.isVisible('.language-choice.on:has-text("English")'), 'the phone’s language is picked already');
  await ios.screenshot({ path: SHOTS + '/onboarding-1-language.png' });
  await ios.click('.language-choice:has-text("日本語")');
  check(await has(ios, 'Warooへようこそ'), 'after switching, the welcome is in Japanese');
  check(await has(ios, 'デジタルウォレット'), 'it says what Waroo is');
  await ios.screenshot({ path: SHOTS + '/onboarding-2-welcome.png' });
  await ios.click('button:has-text("次へ")');
  check(await has(ios, 'ホーム画面に追加しましょう'), 'then: put it on the Home Screen');
  check(await ios.isChecked('.segmented input[value="ios"]'), 'iPhone is picked for an iPhone');
  check(await has(ios, '共有ボタン') && await has(ios, '「ホーム画面に追加」'), 'with Safari’s steps');
  await ios.screenshot({ path: SHOTS + '/onboarding-3-install-ios.png', fullPage: true });
  await ios.click('.segmented label:has-text("Android")');
  check(await has(ios, 'メニュー ⋮'), 'another device can be picked');
  await ios.screenshot({ path: SHOTS + '/onboarding-4-install-android.png', fullPage: true });
  await ios.click('button:has-text("ブラウザのまま続ける")');
  check(await has(ios, 'グループを作成') || await has(ios, 'グループ'), 'they can carry on in the browser');
  await ios.reload();
  await ios.waitForTimeout(800);
  check(!(await has(ios, '言語を選んでください', 1500)), 'and the guide doesn’t come back');

  // An invite opened on an iPhone: the guide first, with a way to take the invite to the app.
  const invited = await mk(IPHONE);
  const link = B + '#/join?i=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  await invited.goto(link);
  await invited.click('.language-choice.on');
  await invited.click('button:has-text("Next")');
  check(await has(invited, 'keeps its own data'), 'an invite on iPhone explains the Home Screen app has its own data');
  await invited.click('button:has-text("Copy the link")');
  check((await invited.evaluate(() => navigator.clipboard.readText())) === link, 'and copies the invite link to paste there');
  await invited.click('button:has-text("Continue to the invite in the browser")');
  check(await has(invited, 'invite'), 'or goes on to the invite here');
  check(invited.url().includes('#/join?i='), 'the invite link is kept through the guide');

  // Android in Chrome.
  const android = await mk(ANDROID);
  await android.goto(B);
  await android.click('.language-choice.on');
  await android.click('button:has-text("Next")');
  check(await android.isChecked('.segmented input[value="android"]'), 'Android is picked for an Android phone');

  // LINE's own browser can't install.
  const line = await mk(LINE, { locale: 'ja-JP' });
  await line.goto(B);
  check(await line.waitForSelector('.language-choice.on:has-text("日本語")', { timeout: 5000 }).then(() => true, () => false), 'a phone set to Japanese starts in Japanese');
  await line.click('.language-choice.on');
  await line.click('button:has-text("次へ")');
  const out = await line.getAttribute('a:has-text("ブラウザで開く")', 'href');
  check(!!out && out.includes('openExternalBrowser=1'), 'LINE’s browser gets a link out to the real browser');
  await line.screenshot({ path: SHOTS + '/onboarding-5-line.png', fullPage: true });

  // Already on the Home Screen: no install step.
  const app = await mk(IPHONE, { standalone: true });
  await app.goto(B);
  await app.click('.language-choice.on');
  check(await app.isVisible('button:has-text("Get started")'), 'opened from the Home Screen, the welcome is the last step');
  await app.click('button:has-text("Get started")');
  check(await has(app, 'Start a group'), 'and leads to the app');

  // Someone who had groups before the guide existed never sees it.
  const old = await mk(IPHONE);
  await old.goto(B);
  await old.evaluate(() => localStorage.setItem('waroo-onboarded', '1'));
  await old.goto(B + '#/new'); await old.reload();
  await old.fill('input[placeholder="Okinawa trip"]', 'Trip');
  await old.fill('input[placeholder="Ana"]', 'Ana');
  await old.click('text=Create group'); await old.waitForTimeout(400);
  await old.evaluate(() => localStorage.removeItem('waroo-onboarded'));
  await old.goto(B); await old.reload(); await old.waitForTimeout(800);
  check(!(await has(old, 'Choose your language', 1500)) && await has(old, 'Trip'), 'existing users skip the guide');

  // Settings offers the guide again.
  await old.goto(B + '#/settings');
  await old.click('a:has-text("Add Waroo to your Home Screen")');
  check(await has(old, 'Scroll down and tap'), 'Settings has the Home Screen steps');

  for (const p of [ios, invited, android, line, app, old]) check(p.errors.length === 0, `no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

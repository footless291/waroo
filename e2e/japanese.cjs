// The app in Japanese: a phone set to Japanese gets Japanese, with no English
// left on the main screens; banners come in Japanese; and the language can be
// switched in Settings.
const { chromium } = require('playwright');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };

// Words allowed to stay in Latin letters: names, the brand, units and protocols.
const ALLOWED = new Set(['Waroo', 'waroo', 'Ana', 'Bob', 'sats', 'JPY', 'USD', 'EUR', 'GBP', 'KRW', 'TWD', 'CNY', 'HKD', 'SGD', 'THB', 'AUD', 'CAD', 'CHF', 'NZD', 'Coinos', 'Rizful', 'BOLT12', 'Lightning', 'Nostr', 'Wallet', 'Connect', 'English', 'Phoenix', 'Satoshi', 'Alby', 'Hub', 'Zeus', 'Primal', 'Get', 'code', 'New', 'connection', 'Submit', 'Copy', 'NWC', 'iPhone', 'iPad', 'QR', 'Web', 'DNSSEC', 'lno1']);
const english = (text) => (text.match(/[A-Za-z][A-Za-z’']{2,}/g) || []).filter((w) => !ALLOWED.has(w));

(async () => {
  const browser = await chromium.launch();
  const mk = async (name, locale) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale });
    // These tests start past the first-run guide (e2e/onboarding.cjs covers it).
    await ctx.addInitScript(() => { try { localStorage.setItem("waroo-onboarded", "1") } catch {} });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B.slice(0, -1) });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
    page.name = name;
    return page;
  };
  const waitText = async (p, sel, needle, ms = 8000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };
  const visibleText = (p) => p.evaluate(() => {
    const parts = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('[inert], .visually-hidden, svg, script, style')) continue;
      for (const node of el.childNodes) if (node.nodeType === 3 && node.textContent.trim()) parts.push(node.textContent.trim());
      for (const attr of ['placeholder', 'aria-label']) if (el.getAttribute(attr)) parts.push(el.getAttribute(attr));
    }
    return parts.join(' ');
  });
  const noEnglish = async (p, where) => {
    const left = english(await visibleText(p));
    check(left.length === 0, `${where}: no English left${left.length ? ` (${[...new Set(left)].join(', ')})` : ''}`);
  };

  const hana = await mk('hana', 'ja-JP');
  await hana.goto(B);
  check(await hana.evaluate(() => document.documentElement.lang) === 'ja', 'a Japanese phone gets lang="ja"');
  check(await waitText(hana, 'main', '誰とでも割り勘'), 'the home screen is in Japanese');
  await noEnglish(hana, 'home');
  await hana.screenshot({ path: SHOTS + '/ja-1-home.png' });

  await hana.click('a.button:has-text("グループを作る")');
  await hana.fill('input[aria-label="グループ名"], input[placeholder="沖縄旅行"]', '沖縄旅行');
  await hana.fill('input[placeholder="はなこ"]', 'はなこ');
  await hana.fill('input[aria-label="メンバー2"]', 'たろう');
  await noEnglish(hana, 'new group');
  await hana.click('button:has-text("グループを作成")'); await hana.waitForTimeout(400);
  check(await waitText(hana, '.invite-card', 'たろう'), 'the group says who can’t see it yet, in Japanese');

  // An expense, with the form in Japanese
  await hana.click('a.fab');
  await noEnglish(hana, 'add expense');
  await hana.fill('input[placeholder="居酒屋の夕食"]', '居酒屋');
  await hana.fill('input.amount-input', '6000');
  check(await waitText(hana, '.split-list', '￥3,000') || await waitText(hana, '.split-list', '¥3,000'), 'shares show in yen');
  await hana.screenshot({ path: SHOTS + '/ja-2-expense.png' });
  await hana.click('button:has-text("支出を追加")'); await hana.waitForTimeout(400);
  await hana.click('nav a:has-text("残高")'); await hana.waitForTimeout(300);
  check(await waitText(hana, '.hero', '受け取る額'), 'the balance card says what Hana gets back');
  await noEnglish(hana, 'balances');
  await hana.screenshot({ path: SHOTS + '/ja-3-balances.png' });
  await hana.click('nav a:has-text("支出")'); await hana.waitForTimeout(300);
  check(await waitText(hana, '.pager-page:not([inert])', 'あなたが支払い'), 'the expense row is a Japanese sentence');
  await noEnglish(hana, 'expenses');

  // Invite, and Taro joins on an English phone
  await hana.click('header a:has-text("招待")');
  await noEnglish(hana, 'invite');
  await hana.click('button:has-text("招待リンクを作成")');
  await hana.click('button:has-text("リンクをコピー")');
  const link = await hana.evaluate(() => navigator.clipboard.readText());
  await hana.screenshot({ path: SHOTS + '/ja-4-invite.png' });
  await hana.click('a[aria-label="戻る"]');
  const taro = await mk('taro', 'en-US');
  await taro.goto(link);
  check(await waitText(taro, 'main', 'Which one are you'), 'an English phone joining sees English');
  await taro.click('label.choice:has-text("たろう")');
  await taro.click('button:has-text("Join as たろう")');
  check(await waitText(taro, '.hero', 'You owe はなこ'), 'and its own balance in English');
  check(await waitText(hana, '.banners', 'たろうさんが沖縄旅行に参加しました'), 'Hana’s banner is in Japanese');
  await hana.screenshot({ path: SHOTS + '/ja-5-banner.png' });

  // Settings, all sections open
  await hana.goto(B + '#/settings');
  for (const b of await hana.$$('button.collapsible-toggle')) { await b.click(); await hana.waitForTimeout(150); }
  await noEnglish(hana, 'settings');
  await hana.screenshot({ path: SHOTS + '/ja-6-settings.png', fullPage: true });

  // Switching to English, and back to the phone's language
  await hana.click('.segmented label:has-text("English")');
  await hana.waitForLoadState('load'); await hana.waitForTimeout(800);
  check(await waitText(hana, 'main', 'Groups') && await hana.evaluate(() => document.documentElement.lang) === 'en', 'switching to English reloads in English');
  await hana.goto(B + '#/settings?open=language');
  await hana.click('.language .segmented label >> nth=0');
  await hana.waitForLoadState('load'); await hana.waitForTimeout(800);
  check(await hana.evaluate(() => document.documentElement.lang) === 'ja', 'and “Phone’s” goes back to Japanese');

  for (const p of [hana, taro]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

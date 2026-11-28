// Friends: a two-person split outside any group. Screenshots in e2e/shots/friends-*.png.
const { chromium } = require('playwright');
const path = require('path');
const B = process.env.WAROO_URL || 'http://127.0.0.1:8787/';
const SHOTS = path.join(__dirname, 'shots');
let failed = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };

(async () => {
  const browser = await chromium.launch();
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => { try { localStorage.setItem('waroo-onboarded', '1') } catch {} });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B.slice(0, -1) });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
    page.name = name;
    return page;
  };
  const waitText = async (p, sel, needle, ms = 8000) => { try { await p.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || '').includes(n), [sel, needle], { timeout: ms }); return true; } catch { return false; } };

  const ana = await mk('ana');
  await ana.goto(B + '#/friends');
  check(await waitText(ana, 'main', 'Split with a friend, no group needed'), 'the Friends tab says what it’s for');
  await ana.screenshot({ path: SHOTS + '/friends-1-empty.png' });
  await ana.click('a.button:has-text("Add a friend")');
  await ana.fill('input[autocomplete="given-name"]', 'Ana');
  await ana.click('button:has-text("Make a friend code")');
  await ana.waitForSelector('.friend-code[data-invite-link]');
  const link = await ana.getAttribute('.friend-code', 'data-invite-link');
  check(!!link && link.includes('#/join?i='), 'a friend code is made');
  await ana.screenshot({ path: SHOTS + '/friends-2-code.png' });

  await ana.goto(B + '#/friends');
  check(await waitText(ana, '.cards', 'Friend code, not used yet'), 'the unused code is listed under Friends');
  await ana.goto(B + '#/');
  check(!(await waitText(ana, 'main', 'Ana', 1500)), 'and not under Groups');
  await ana.goto(B + '#/friends'); await ana.click('a.card-row'); await ana.waitForSelector('.friend-code[data-invite-link]');

  const bob = await mk('bob');
  await bob.goto(link);
  check(await waitText(bob, 'main', 'Ana wants to add you as a friend'), 'Bob sees a friend request from Ana');
  await bob.screenshot({ path: SHOTS + '/friends-3-request.png' });
  await bob.fill('input[autocomplete="given-name"]', 'Bob');
  await bob.click('button:has-text("Add Ana as a friend")');
  check(await waitText(bob, 'header h1', 'Ana'), 'Bob’s side is called Ana');
  check(await waitText(ana, 'header h1', 'Bob', 10000), 'Ana’s code page moves on to Bob by itself');
  check(!(await ana.isVisible('header a:has-text("Invite")')), 'no inviting more people into a friendship');

  await ana.click('a.fab');
  await ana.fill('input[placeholder="Izakaya dinner"]', 'Ramen');
  await ana.fill('input.amount-input', '2000');
  await ana.click('button:has-text("Add expense")');
  await ana.waitForTimeout(800);
  await bob.goto(B + '#/friends');
  check(await waitText(bob, '.cards', 'Ana') && await waitText(bob, '.cards', 'You owe'), 'Bob’s Friends tab shows he owes Ana');
  await bob.screenshot({ path: SHOTS + '/friends-4-list.png' });
  await ana.goto(B + '#/friends');
  check(await waitText(ana, '.cards', 'Owes you'), 'Ana’s shows Bob owes her');
  await bob.goto(B + '#/activity');
  check(await waitText(bob, 'main', 'Ramen'), 'friend expenses show in Activity');

  // The code worked once.
  const cai = await mk('cai');
  await cai.goto(link);
  check(await waitText(cai, 'main', 'doesn’t work any more') || await waitText(cai, 'main', 'used already'), 'the code doesn’t work a second time');

  // Step 2: friends in groups. Ana starts a group and invites Bob through their friendship.
  await ana.goto(B + '#/new');
  await ana.fill('input[placeholder="Okinawa trip"]', 'Okinawa');
  await ana.fill('input[placeholder="Ana"]', 'Ana');
  await ana.click('text=Create group'); await ana.waitForTimeout(300);
  await ana.click('header a:has-text("Invite")');
  check(await waitText(ana, '.invite-friends', 'Bob'), 'inviting people offers Ana’s friends');
  await ana.click('.invite-friends button:has-text("Send invite")');
  check(await waitText(ana, '.invite-friends', 'Invite sent'), 'and sends Bob a private invite');
  await ana.screenshot({ path: SHOTS + '/friends-5-invite.png' });
  await bob.goto(B + '#/');
  const found = await waitText(bob, '.friend-invites', 'Ana invited you to Okinawa', 10000);
  check(found, 'Bob finds it on his Groups page');
  await bob.screenshot({ path: SHOTS + '/friends-6-invited.png' });
  await bob.click('.friend-invites a:has-text("Open the invite")');
  await bob.fill('input[autocomplete="given-name"]', 'Bob');
  await bob.click('button:has-text("Join the group")');
  check(await waitText(bob, 'header h1', 'Okinawa'), 'Bob joins Okinawa');
  await bob.goto(B + '#/');
  await bob.waitForTimeout(800);
  check(!(await bob.isVisible('.friend-invites')), 'the invite goes away once he’s in');

  // Ana adds an expense in the group; the friend page counts it.
  await ana.goto(B + '#/'); await ana.click('a.card-row:has-text("Okinawa")');
  await ana.waitForTimeout(1500);
  await ana.click('a.fab');
  await ana.fill('input[placeholder="Izakaya dinner"]', 'Hotel');
  await ana.fill('input.amount-input', '6000');
  await ana.click('button:has-text("Add expense")');
  await ana.waitForTimeout(1500);
  await ana.goto(B + '#/friends');
  check(await waitText(ana, '.cards', 'Counting 1 group you share', 10000), 'Ana’s Friends tab counts the group they share');
  const row = await ana.textContent('a.card-row:has-text("Bob")');
  check(row.includes('¥4,000'), `with everything Bob owes, together: ¥1,000 between them and ¥3,000 in the group (${row})`);
  await ana.click('a.card-row:has-text("Bob")');
  check(await waitText(ana, '.friend-across', 'Okinawa') && await waitText(ana, '.friend-across', 'Owes you ¥3,000'), 'Bob’s page lists Okinawa and what he owes there');
  await ana.screenshot({ path: SHOTS + '/friends-7-across.png', fullPage: true });

  // Removing a friend: only when all square.
  await ana.click('.people a.person-row:has-text("Bob")');
  check(await waitText(ana, 'main', 'To remove Bob as a friend, settle up first'), 'Bob’s options say he can’t be removed while he owes Ana');
  check(!(await waitText(ana, 'main', 'Remove from the group', 1000)), 'and don’t offer removing him from a “group”');
  await ana.goto(B + '#/friends/add');
  await ana.fill('input[autocomplete="given-name"]', 'Ana');
  await ana.click('button:has-text("Make a friend code")');
  await ana.waitForSelector('.friend-code[data-invite-link]');
  const deeLink = await ana.getAttribute('.friend-code', 'data-invite-link');
  const dee = await mk('dee');
  await dee.goto(deeLink);
  await dee.fill('input[autocomplete="given-name"]', 'Dee');
  await dee.click('button:has-text("Add Ana as a friend")');
  check(await waitText(ana, 'header h1', 'Dee', 10000), 'Ana and Dee are friends');
  await ana.click('.people a.person-row:has-text("Dee")');
  await ana.click('button:has-text("Remove Dee as a friend")');
  await ana.click('.remove-friend button:has-text("Remove")');
  await ana.waitForTimeout(800);
  check(!(await waitText(ana, '.cards', 'Dee', 1500)) && await waitText(ana, 'main', 'Removed friends (1)'), 'Dee leaves Ana’s list, archived');
  check(!(await waitText(dee, '.banners', 'left', 2000)), 'Dee gets no banner about it');
  await dee.goto(B + '#/friends');
  check(await waitText(dee, '.cards', 'Disconnected', 10000), 'Dee sees the friendship disconnected, without a notification');
  await dee.click('a.card-row:has-text("Ana")');
  check(await waitText(dee, '.friend-status', 'Send a new friend code'), 'and can send a new friend code');
  await dee.screenshot({ path: SHOTS + '/friends-8-disconnected.png' });
  await dee.click('a:has-text("Send a new friend code")');
  await dee.waitForSelector('.friend-code[data-invite-link]');
  const back = await dee.getAttribute('.friend-code', 'data-invite-link');
  await ana.goto(back);
  check(await waitText(ana, 'header h1', 'Dee', 10000), 'Ana opens it and they’re reconnected');
  check(await waitText(dee, 'header h1', 'Ana', 10000), 'Dee’s code page moves on by itself');
  await ana.goto(B + '#/friends');
  check(await waitText(ana, '.cards', 'Dee') && !(await ana.isVisible('a.archived-link')), 'Dee is back on Ana’s list');

  // Removed friends aren't offered when inviting; friends can be invited while making a group.
  await ana.goto(B + '#/new');
  check(await waitText(ana, '.friend-picks', 'Bob') && await waitText(ana, '.friend-picks', 'Dee'), 'a new group offers Ana’s friends');
  await ana.fill('input[placeholder="Okinawa trip"]', 'Kyoto');
  await ana.check('.friend-picks label:has-text("Dee") input');
  await ana.click('text=Create group');
  check(await waitText(ana, 'header h1', 'Kyoto'), 'the group is made');
  await dee.goto(B + '#/');
  check(await waitText(dee, '.friend-invites', 'Ana invited you to Kyoto', 10000), 'and Dee gets the invite');
  await dee.click('button:has-text("Not now")');
  // Dee removes Ana: Ana's invite list no longer offers Dee.
  await dee.goto(B + '#/friends'); await dee.click('a.card-row:has-text("Ana")');
  await dee.click('.people a.person-row:has-text("Ana")');
  await dee.click('button:has-text("Remove Ana as a friend")');
  await dee.click('.remove-friend button:has-text("Remove")');
  await dee.waitForTimeout(1500);
  await ana.goto(B + '#/new');
  await ana.waitForSelector('.friend-picks');
  check(!(await waitText(ana, '.friend-picks', 'Dee', 1500)), 'a friend who disconnected isn’t offered');

  for (const p of [ana, bob, dee]) check(p.errors.length === 0, `${p.name}: no console errors ${p.errors.join(' | ').slice(0, 300)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });

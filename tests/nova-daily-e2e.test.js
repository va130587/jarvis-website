// Daily use in the browser: Daily Briefing, Smart Email (demo inbox), Automation Centre, the notification bell and browser pop-ups,
// "brief me" by voice, layout at three widths and accessibility. The server is real; Gmail itself is not connected here (see server-daily tests).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const { boot, closeAll } = require('./server-helpers');

let browser, srv;
test.before(async () => { browser = await H.launch(); srv = await boot({ NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }); });
test.after(async () => { await browser.close(); await closeAll(); });
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets|fonts\.googleapis/.test(e));
let n = 0;
async function open(opts) {
  const email = (opts && opts.email) || 'roshan@example.com';
  const o = await H.openApp(browser, Object.assign({ base: srv.base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', email); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  return o;
}
const go = async (page, v, sel) => { await page.evaluate(h => { location.hash = h; }, v); await page.waitForSelector(sel); };
const post = (page, p, b) => page.evaluate(([u, body]) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NOVA-CSRF': NOVA.csrf }, body: JSON.stringify(body || {}) }).then(r => r.json()), [p, b]);
// every test uses its own account so that tests do not see each other's data
const fresh = () => ({ email: 'roshan@example.com' });

test('Daily Briefing: greeting, the one thing, counts, sections, read aloud, saved copies; also on the Dashboard', async () => {
  const { page, ctx, errors } = await open(fresh());
  await post(page, '/api/demo/load'); await post(page, '/api/email/demo');
  await page.evaluate(() => { location.hash = 'dashboard'; }); await page.waitForSelector('.dash-brief .brief-hero');
  assert.match(await page.innerText('.dash-brief'), /The one thing/i);
  await go(page, 'briefing', '.brief-sec');
  const t = await page.innerText('main');
  assert.match(t, /Good (morning|afternoon|evening), Roshan/); assert.match(t, /The one thing/i); assert.match(t, /includes demo data/i);
  assert.match(t, /Overdue/i); assert.match(t, /Follow-ups/i); assert.match(t, /E-mail \(last 48 hours\)/i); assert.match(t, /may be phishing/);
  assert.match(t, /Next automatic briefing: .*07:30 \(Dubai\)/);
  assert.ok(await page.locator('.dayload[aria-label^="Day load"]').count());
  await page.click('button[data-act="dSpeakBrief"]');
  await page.waitForFunction(() => /Good (morning|afternoon|evening), Roshan\. It is \w+day\..*The most important thing/.test(window.__said.join(' ')));
  await page.click('button[data-act="dSaveBrief"]');
  await page.waitForSelector('.timeline li'); assert.match(await page.innerText('.timeline'), /saved by you/i);
  await page.click('.brief-sec a[href="#proofloop"]'); await page.waitForFunction(() => J.current() === 'proofloop');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('Smart Email: demo inbox, filters with counts, reasons, draft (edit, copy, never sent), phishing guard, ProofLoop tracking', async () => {
  const { page, ctx, errors } = await open(fresh());
  await post(page, '/api/email/demo/remove');
  await go(page, 'email', '.conn');
  assert.match(await page.innerText('.conn'), /Gmail is not connected/); assert.match(await page.innerText('.conn'), /How to connect your real Gmail/);
  await page.click('button[data-act="dDemoOn"]'); await page.waitForSelector('.mail-list');
  assert.match(await page.innerText('.mail-filters'), /Important 4/); assert.match(await page.innerText('.mail-filters'), /Check first 1/);
  const first = page.locator('.mail-btn').first(); assert.match(await first.innerText(), /Sara Haddad/); assert.match(await first.innerText(), /Critical/i); assert.match(await first.innerText(), /Deadline: tomorrow/);
  await first.click(); await page.waitForSelector('.mail-detail h2');
  assert.match(await page.innerText('.mail-detail'), /Why NOVA sorted it this way/i); assert.match(await page.innerText('.reason-list'), /It is about a job/);
  await page.click('button[data-act="dDraft"]'); await page.waitForSelector('#dDraftBody');
  assert.match(await page.inputValue('#dDraftBody'), /^Hi Sara,/);
  await page.fill('#dDraftBody', 'Hi Sara, Tuesday at 10:00 works for me. Roshan'); await page.click('button[data-act="dSaveDraft"]');
  await page.waitForSelector('.toast:has-text("has not been sent")');
  await page.click('button[data-act="dSendDraft"]'); await page.waitForSelector('.toast:has-text("cannot send")');
  await page.click('button[data-act="dTrack"]'); await page.waitForSelector('.mail.sel .tag:has-text("In ProofLoop")');
  // filters
  await page.click('button[data-act="dFilter"][data-id="review"]'); await page.waitForSelector('.mail-btn:has-text("Gulf Bank")');
  assert.equal(await page.locator('.mail-btn').count(), 1);
  await page.click('.mail-btn'); await page.waitForSelector('.mail-detail .login-msg');
  assert.match(await page.innerText('.mail-detail'), /may be phishing/); assert.equal(await page.locator('button[data-act="dDraft"]').count(), 0);
  await page.click('button[data-act="dFilter"][data-id="low"]'); await page.waitForFunction(() => document.querySelectorAll('.mail-btn').length === 3);
  await page.click('button[data-act="dDemoOff"]'); await page.waitForSelector('text=No e-mail yet');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('Automation Centre: six jobs (the weekly review is off), switch off, change time, run now with history; notification bell, read and pop-ups', async () => {
  const { page, ctx, errors } = await open(fresh());
  await go(page, 'automation', '.sched');
  assert.deepEqual(await page.$$eval('.sched h2', h => h.map(x => x.textContent)), ['Daily briefing', 'Deadline check', 'Follow-up nudges', 'Backup', 'Weekly review notification', 'E-mail check']);
  const card = page.locator('.sched[data-kind="deadlines"]');
  await card.locator('input[data-f="enabled"]').uncheck({ force: true });
  await page.waitForFunction(() => /Off/.test(document.querySelector('.sched[data-kind="deadlines"] .kv').textContent));
  await page.locator('.sched[data-kind="deadlines"] input[data-f="enabled"]').check({ force: true });
  await page.waitForFunction(() => !/Off/.test(document.querySelector('.sched[data-kind="deadlines"] .kv').textContent));
  await page.locator('.sched[data-kind="briefing"] input[type="time"]').fill('06:15');
  await page.locator('.sched[data-kind="briefing"] input[type="time"]').dispatchEvent('change');
  await page.waitForFunction(() => /06:15 \(Dubai\)/.test(document.querySelector('.sched[data-kind="briefing"] .kv').textContent));
  await page.locator('.sched[data-kind="briefing"] select').selectOption('weekdays');
  await page.waitForFunction(() => document.querySelector('.sched[data-kind="briefing"] select').value === 'weekdays');
  const before = await page.evaluate(() => NOVA.daily.unread);
  await page.locator('.sched[data-kind="briefing"] button[data-act="dRunNow"]').click();
  await page.waitForSelector('.runs td:has-text("Daily briefing")');
  assert.match(await page.innerText('.runs'), /succeeded/i);
  await page.waitForFunction(b => NOVA.daily.unread > b, before);
  // the bell
  assert.match(await page.innerText('#novaBellN'), /^\d+$/);
  await page.click('#novaBell'); await page.waitForSelector('#novaNotifs:not([hidden]) .notif-item');
  assert.match(await page.innerText('#novaNotifs'), /Your briefing for/);
  await page.keyboard.press('Escape'); assert.equal(await page.isHidden('#novaNotifs'), true);
  await page.click('#novaBell'); await page.click('#novaNotifs .notif-item'); await page.waitForFunction(() => J.current() === 'briefing');
  // browser pop-ups for new notifications (permission granted in this test browser)
  await page.evaluate(() => { window.__notes.length = 0; });
  await go(page, 'automation', '.sched'); await page.click('button[data-act="dTestNotif"]');
  await page.waitForFunction(() => window.__notes.some(x => /NOVA test notification/.test(x)));
  await page.click('#novaBell'); await page.click('button[data-act="dReadAll"]'); await page.waitForFunction(() => NOVA.daily.unread === 0);
  assert.equal(await page.isHidden('#novaBellN'), true);
  assert.match(await page.innerText('main'), /Phone push \(ntfy, free\)/); assert.match(await page.innerText('main'), /NOVA_NTFY_TOPIC/);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('voice: "brief me" and "check my email" are answered and spoken; Connected Apps shows Gmail and phone push honestly', async () => {
  const { page, ctx, errors } = await open(fresh());
  await post(page, '/api/email/demo');
  const reply = await page.evaluate(t => J.voice.command(t).then(o => typeof o === 'string' ? o : o && o.text), 'brief me');
  assert.match(reply, /^Good (morning|afternoon|evening), Roshan\. It is /);
  const mail = await page.evaluate(t => J.voice.command(t).then(o => typeof o === 'string' ? o : o && o.text), 'any important emails');
  assert.match(mail, /Critical: "Interview invitation/);
  await go(page, 'connections', '.sources');
  await page.waitForFunction(() => /Gmail \(read-only\)/.test(document.querySelector('main').textContent) && !/Checking/.test(document.querySelector('main').textContent));
  const t = await page.innerText('main'); assert.match(t, /Gmail \(read-only\)/); assert.match(t, /Demo inbox/i); assert.match(t, /Phone push \(ntfy\)/);
  await page.goto(srv.base + '/?gmail=denied#email'); await page.waitForFunction(() => window.NOVA && NOVA.user);
  await page.waitForSelector('.gmail-msg:has-text("cancelled at Google")');                  // stays on the page until dismissed
  await page.click('button[data-act="dGmailMsgOff"]'); assert.equal(await page.locator('.gmail-msg').count(), 0);
  assert.equal(await page.evaluate(() => location.search), '');
  await post(page, '/api/email/demo/remove');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

for (const width of [1440, 768, 390]) {
  test('layout and axe at ' + width + ' px: briefing, e-mail with a draft open, automation, notification panel', async () => {
    const { checkLayout } = require('./layout-check');
    const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
    const { page, ctx, errors } = await open(Object.assign(fresh(), { width, height: width === 390 ? 844 : 900 }));
    await post(page, '/api/email/demo'); await post(page, '/api/demo/load'); await post(page, '/api/notifications/test');
    await page.evaluate(() => NOVA.daily.poll(true));
    const problems = [], check = async name => (await page.evaluate(checkLayout)).forEach(x => problems.push(name + ': ' + x));
    await page.evaluate(src => (0, eval)(src), AXE);
    const axe = async name => { const r = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
      r.violations.filter(x => x.impact === 'serious' || x.impact === 'critical').forEach(x => problems.push(name + ' axe ' + x.id + ': ' + x.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | '))); };
    await go(page, 'briefing', '.brief-sec'); await page.waitForTimeout(400); await check('briefing'); await axe('briefing');
    await page.screenshot({ path: path.join(__dirname, 'screenshots', width + '-nova-briefing.png'), fullPage: true }).catch(() => {});
    await go(page, 'email', '.mail-btn'); await page.locator('.mail-btn').first().click(); await page.waitForSelector('.mail-detail h2');
    if (!(await page.locator('#dDraftBody').count())) { await page.click('button[data-act="dDraft"]'); await page.waitForSelector('#dDraftBody'); }
    await page.waitForTimeout(400); await check('email'); await axe('email');
    await page.screenshot({ path: path.join(__dirname, 'screenshots', width + '-nova-email.png'), fullPage: true }).catch(() => {});
    await go(page, 'automation', '.sched'); await page.waitForTimeout(400); await check('automation'); await axe('automation');
    await page.screenshot({ path: path.join(__dirname, 'screenshots', width + '-nova-automation.png'), fullPage: true }).catch(() => {});
    await page.click('#novaBell'); await page.waitForSelector('#novaNotifs:not([hidden])'); await check('notifications'); await axe('notifications');
    await go(page, 'dashboard', '.dash-brief'); await page.waitForTimeout(400); await check('dashboard');
    assert.deepEqual(problems, [], problems.join('\n')); assert.deepEqual(clean(errors), []);
    await post(page, '/api/email/demo/remove');
    await ctx.close();
  });
}

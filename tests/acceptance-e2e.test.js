// ACCEPTANCE: the first-run setup page in a browser, then NOVA_DEMO_GUIDE.md followed step by step against the real demo data
// (scripts/demo.js seed) in a real browser. If the guide promises something on screen, this test checks it is there.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers');
const { createApp } = require('../server');
const { seed } = require('../scripts/demo');
const { runSetup } = require('../server/setup');

let browser, app, base;
test.before(async () => {
  browser = await H.launch();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-accept-'));
  app = createApp({ NOVA_DB: path.join(dir, 'demo.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'demo@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_SECRET_KEY: 'demo-only-key-not-for-real-accounts', NOVA_NTFY_TOPIC: '',
    NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  seed(app);
  base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); app.server.closeAllConnections(); await app.close(); });
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets|fonts\.googleapis/.test(e));

test('first-run setup page: checks, code from the terminal, e-mail, AI choice; writes .env; accessible', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-setup-')), envPath = path.join(dir, '.env');
  const s = await runSetup({ root: path.join(__dirname, '..'), envPath, port: 0, log: false });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + s.port + '/');
  await page.waitForSelector('#checks li.ok');
  assert.equal(await page.locator('#checks li.bad').count(), 0);
  await page.fill('#email', 'roshan@example.com'); await page.click('button.go');
  assert.match(await page.innerText('#err'), /Paste the setup code/);
  await page.fill('#token', 'wrong-code-wrong-code-'); await page.click('button.go');
  await page.waitForSelector('#err:has-text("Wrong setup code")');
  await page.fill('#token', s.token); await page.check('input[name="ai"][value="ollama"]'); await page.check('#ntfy'); await page.click('button.go');
  await page.waitForSelector('#doneBox:not([hidden])');
  assert.match(await page.innerText('#doneBox'), /Sign in with roshan@example\.com/); assert.match(await page.innerText('#doneBox'), /ollama pull/); assert.match(await page.innerText('#ntfyTopic'), /^nova-/);
  const env = fs.readFileSync(envPath, 'utf8');
  assert.match(env, /OWNER_EMAILS=roshan@example\.com/); assert.match(env, /NOVA_AI_PROVIDER=ollama/); assert.match(env, /NOVA_NTFY_TOPIC=nova-/);
  const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
  await page.evaluate(src => (0, eval)(src), AXE);
  const r = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
  assert.deepEqual(r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id), []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scrolling on a phone');
  assert.deepEqual(errors.filter(e => !/status of 403/.test(e)), [], 'only the deliberate wrong-code attempt failed');
  await ctx.close(); await s.finished;
});

test('NOVA_DEMO_GUIDE.md, step by step, on the demo data', async () => {
  const { page, ctx, errors } = await H.openApp(browser, { base, hash: '' });
  await page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await page.fill('#novaDevEmail', 'demo@nova.local'); await page.click('#novaDevForm button');
  await page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  // 1. the orb
  assert.ok(await page.locator('.nova-orb[data-state]').count());
  // 2. Daily Briefing: the one thing (a late promise beats an overdue task), sections, read aloud, "brief me"
  await page.evaluate(() => { location.hash = 'briefing'; }); await page.waitForSelector('.brief-sec');
  const brief = await page.innerText('main');
  assert.match(brief, /The one thing\s+Submit the scholarship form/i); assert.match(brief, /You promised this to Scholarship Office \(demo\) and it is 3 days late/);
  for (const s of ['Overdue', 'Due today', 'Next three days', 'Follow-ups', 'E-mail \\(last 48 hours\\)', 'may be phishing']) assert.match(brief, new RegExp(s, 'i'), s);
  assert.ok(await page.locator('.dayload').count());
  await page.click('button[data-act="dSpeakBrief"]'); await page.waitForFunction(() => window.__said.join(' ').includes('The most important thing'));
  const say = async t => { await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg'); const n = await page.$$eval('.msg.bot', e => e.length); await page.fill('#novaMsg', t); await page.click('#novaChatForm button'); await page.waitForFunction(k => document.querySelectorAll('.msg.bot').length > k && !document.querySelector('.typing'), n); return page.innerText('.msg.bot:last-child'); };
  assert.match(await say('brief me'), /The most important thing: Submit the scholarship form/);
  // 3. approve before acting, verified result, undo; destructive needs a button and cannot be undone
  await say('add a task to send the portfolio link to Sara by Thursday');
  const card = await page.innerText('.preview');
  for (const l of ['Proposed action', 'Why', 'Where', 'What will change', 'Possible consequences', 'Can it be undone?']) assert.match(card, new RegExp(l, 'i'));
  await page.click('.preview button:has-text("Approve")'); await page.waitForSelector('.msg.bot:last-child .text:has-text("Read back from the database")');
  await page.click('button[data-act="novaUndo"]'); await page.waitForSelector('.toast');
  await say('forget that I prefer short answers');
  assert.match(await page.innerText('.preview'), /Can it be undone\?\s*No\./i);
  await page.click('.preview button:has-text("Reject")');
  // 4. ProofLoop: nine demo commitments; Awaiting Confirmation is not Verified; evidence -> Verified -> Completed -> receipt
  await page.evaluate(() => { location.hash = 'proofloop'; }); await page.waitForSelector('button[data-act="plOpen"]');
  assert.match(await page.innerText('main'), /9 fictional demo commitments/);
  const row = page.locator('li', { hasText: 'Send the updated project proposal to Alex Rivera' }).first();
  await row.locator('button[data-act="plOpen"]').click(); await page.waitForSelector('#plEvKind');
  assert.match(await page.innerText('.why .verdict'), /Awaiting Confirmation/);
  await page.selectOption('#plEvKind', 'verified'); await page.fill('#plEvText', 'Alex replied that he received it'); await page.click('button[data-act="plAddEvidence"]');
  await page.waitForSelector('.toast:has-text("Evidence added")');
  await page.waitForSelector('button[data-act="plMove"][data-to="verified"]');            // the detail reopens after each step
  await page.click('button[data-act="plMove"][data-to="verified"]');
  await page.waitForSelector('button[data-act="plMove"][data-to="completed"]');
  await page.click('button[data-act="plMove"][data-to="completed"]');
  await page.waitForSelector('.why .verdict:has-text("Completed")');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button[data-act="plReceipt"]')]);
  const receipt = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(receipt, /Verified only by your own confirmation \(self-reported\)/); assert.match(receipt, /DEMO/);
  await page.keyboard.press('Escape');
  assert.match(await say('Omar owes me the final figures by Thursday'), /owes you|Omar/i);
  // 5. Smart Email: why, draft, sending refused, phishing guard, tracking a promise, by voice
  await page.evaluate(() => { location.hash = 'email'; }); await page.waitForSelector('.mail-btn');
  await page.locator('.mail-btn', { hasText: 'Interview invitation' }).click(); await page.waitForSelector('.reason-list');
  assert.match(await page.innerText('.reason-list'), /They ask you something directly[\s\S]*about a job[\s\S]*Deadline tomorrow/);
  await page.click('button[data-act="dDraft"]'); await page.waitForSelector('#dDraftBody');
  await page.click('button[data-act="dSendDraft"]'); await page.waitForSelector('.toast:has-text("cannot send")');
  await page.click('button[data-act="dFilter"][data-id="review"]'); await page.locator('.mail-btn', { hasText: 'Gulf Bank' }).click();
  await page.waitForSelector('.mail-detail .login-msg:has-text("may be phishing")');
  await page.click('button[data-act="dFilter"][data-id="all"]'); await page.locator('.mail-btn', { hasText: 'Omar Farouk' }).click();
  await page.click('button[data-act="dTrack"]'); await page.waitForSelector('.toast:has-text("owed to you")');
  assert.match(await page.evaluate(() => J.voice.command('any important emails?').then(o => typeof o === 'string' ? o : o.text)), /Critical: "Interview invitation/);
  // 6. Automation and notifications
  await page.evaluate(() => { location.hash = 'automation'; }); await page.waitForSelector('.sched');
  assert.equal(await page.locator('.sched').count(), 5);
  await page.locator('.sched[data-kind="followups"] button[data-act="dRunNow"]').click(); await page.waitForSelector('.runs td:has-text("Follow-up nudges")');
  await page.click('button[data-act="dTestNotif"]'); await page.waitForFunction(() => NOVA.daily.unread > 0);
  await page.click('#novaBell'); await page.waitForSelector('#novaNotifs .notif-item'); await page.keyboard.press('Escape');
  // 7. Voice page is there with the honest voice note (the microphone part needs a person)
  await page.evaluate(() => { location.hash = 'voice'; }); await page.waitForSelector('#ptt');
  assert.match(await page.innerText('#vVoiceNote'), /voices?/i);
  // 8. Trust: tools with risk levels, audit, export, and free usage
  await page.evaluate(() => { location.hash = 'security'; }); await page.waitForSelector('table.cmds th:has-text("email.list")'); assert.match(await page.innerText("main"), /Download everything \(JSON\)/);
  const audit = await page.evaluate(() => fetch('/api/audit').then(r => r.json()).then(j => j.entries.map(e => e.action)));
  for (const a of ['email_send_refused', 'email_tracked', 'schedule_run_now']) assert.ok(audit.includes(a), a);
  await page.evaluate(() => { location.hash = 'usage'; }); await page.waitForTimeout(600);
  assert.match(await page.innerText('main'), /rules|built-in/i);
  // 9. Look and feel: Daylight theme from Security and Settings, remembered after a reload, and back
  await page.evaluate(() => { location.hash = 'security'; }); await page.waitForSelector('#themePanel');
  await page.click('.theme-opt.t-light'); await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
  await page.reload(); await page.waitForFunction(() => window.NOVA && NOVA.user && window.J);
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  await page.evaluate(() => { location.hash = 'security'; }); await page.waitForSelector('#themePanel'); await page.click('.theme-opt.t-dark');
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme'));
  // 10. Tasks and Calendar: Done shows a preview first; Reject changes nothing
  await page.evaluate(() => { location.hash = 'hub'; }); await page.waitForSelector('button[data-act="novaTaskDone"]');
  await page.locator('button[data-act="novaTaskDone"]').first().click(); await page.waitForSelector('#hubPreview .preview');
  await page.click('#hubPreview button[data-act="novaRejectRun"]'); await page.waitForFunction(() => !document.querySelector('#hubPreview .preview'));
  // 11. When the server fails, the page says so and Try again recovers
  await page.route(/\/api\/life$/, r => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await page.evaluate(() => { location.hash = 'life'; }); await page.waitForSelector('.load-error:has-text("Try again")');
  await page.unroute(/\/api\/life$/); await page.click('.load-error button[data-act="novaRetry"]'); await page.waitForSelector('.life-grid');
  // 12. Promise Orbit: dots on the dashboard; an overdue one is marked with "!", opens its commitment from the keyboard
  await page.evaluate(() => { location.hash = 'dashboard'; }); await page.waitForSelector('.odot.s-overdue');
  assert.equal(await page.locator('.odot.s-overdue').first().innerText(), '!'); assert.match(await page.getAttribute('.odot.s-overdue', 'aria-label'), /overdue \d+ days?/);
  await page.locator('.odot[data-id^="commitment:"]').first().focus(); await page.keyboard.press('Enter'); await page.waitForSelector('#formDialog[open]'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#formDialog[open]'));
  // 13. Day Replay: today's events in order, the slider moves the marker
  await page.evaluate(() => { location.hash = 'replay'; }); await page.waitForSelector('.rp-ev'); const total = await page.locator('.rp-ev').count(); assert.ok(total > 3);
  await page.focus('#rpTime'); await page.keyboard.press('Home'); assert.match(await page.innerText('#rpReadout'), new RegExp('Up to 00:00: 0 of ' + total + ' events')); await page.keyboard.press('End'); assert.match(await page.innerText('#rpReadout'), new RegExp('of ' + total + ' events'));
  // 14. Life Radar on Weekly Insights: five measures, exact numbers on focus, a table
  await page.evaluate(() => { location.hash = 'insights'; }); await page.waitForSelector('#radarPanel .rd-spoke'); assert.equal(await page.locator('.rd-spoke').count(), 5);
  await page.locator('.rd-spoke').first().focus(); assert.match(await page.innerText('#rdTip'), /Promises kept on time: this week/);
  // 15. Proof receipt: export, then the public check page says it matches; one changed letter does not
  const rec = await page.evaluate(async () => { const l = await fetch('/api/commitments').then(x => x.json()); return fetch('/api/commitments/' + l.commitments[0].id + '/receipt?format=md').then(x => x.text()); });
  assert.match(rec, /\*\*Fingerprint \(SHA-256\):\*\* `[0-9a-f]{64}`/);
  await page.goto(page.url().split('#')[0].replace(/\/$/, '') + '/verify'); await page.waitForSelector('#verifyForm');
  await page.fill('#receipt', rec); await page.click('#check'); await page.waitForFunction(() => /Matches/.test(document.getElementById('verdict').textContent));
  await page.fill('#receipt', rec.replace('Proof receipt', 'Proof receipt!')); await page.click('#check'); await page.waitForFunction(() => /Does not match/.test(document.getElementById('verdict').textContent));
  // 16. What happens if: the preview lists effects before you approve; Reject changes nothing
  await page.goto(page.url().split('/verify')[0] + '/#chat'); await page.waitForSelector('#novaMsg'); await page.fill('#novaMsg', 'add a task to call HR by friday'); await page.click('#novaChatForm button');
  await page.waitForSelector('.preview .fx li'); assert.match(await page.innerText('.preview .fx'), /ProofLoop/); await page.click('.preview button:has-text("Reject")');
  assert.deepEqual(clean(errors).filter(e => !/status of 500/.test(e)), []);
  await ctx.close();
});

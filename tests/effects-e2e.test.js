// "What happens if" in the browser: the Future Preview card has an Effects row with facts before you approve, "No other effects
// found" when nothing else is touched, nothing for read requests, long Arabic/emoji text, and it is clean in both themes.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers');
const { checkLayout } = require('./layout-check');
const { createApp } = require('../server');

const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const NOW = Date.parse('2026-10-19T08:00:00+04:00');                       // Monday 19 October 2026, Dubai
let browser; const apps = [];
function mk() {
  const a = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-fx-')), 'e.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }, { now: () => NOW });
  a.db.prepare("INSERT INTO users (email, display_name, created_at) VALUES ('a@nova.local', 'Ayla', 1)").run();
  a.db.prepare("INSERT INTO tasks (user_id, title, due, status, created_at) VALUES (1, 'Prepare the slides', '2026-10-23', 'open', 1)").run();
  a.db.prepare("INSERT INTO commitments (user_id, title, direction, status, deadline, source_type, created_at, updated_at) VALUES (1, 'Send the proposal', 'i_owe', 'awaiting_confirmation', '2026-10-23', 'manual', 1, 1)").run();
  apps.push(a); return a;
}
test.before(async () => { browser = await H.launch(); });
test.after(async () => { await browser.close(); for (const a of apps) { a.server.closeAllConnections(); await a.close(); } });
async function open(opts) {
  const a = mk(), base = 'http://127.0.0.1:' + await a.listen();
  const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {})); o.app = a;
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown'); await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  await o.page.evaluate(() => { location.hash = 'chat'; }); await o.page.waitForSelector('#novaMsg'); return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const ask = async (page, text) => { await page.fill('#novaMsg', text); await page.click('#novaChatForm button'); await page.waitForSelector('.preview, .msg.bot:last-child .text:not(:empty)'); };

test('a task with a date: the Effects row lists what else falls on that day and the ProofLoop tracking; approving works as before', async () => {
  const { page, ctx, errors, app } = await open();
  await ask(page, 'add a task to call HR by friday'); await page.waitForSelector('.preview .fx li');
  const dts = await page.$$eval('.preview dt', d => d.map(x => x.textContent)); assert.deepEqual(dts, ['Proposed action', 'Why', 'Where', 'What will change', 'Effects', 'Possible consequences', 'Can it be undone?']);
  const fx = await page.$$eval('.preview .fx li', l => l.map(x => x.textContent));
  assert.deepEqual(fx, ['2 other items are already due on Friday 23 October: “Prepare the slides”, “Send the proposal”.', 'NOVA will also track it in ProofLoop as something you owe, due 2026-10-23. It will wait in Awaiting Confirmation: NOVA cannot see whether you did it.']);
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM tasks WHERE title = 'call HR'").get().n, 0, 'nothing is created before you approve');
  await page.click('.preview button:has-text("Approve")'); await page.waitForSelector('.msg.bot:last-child .text:has-text("Created the task")');
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM tasks WHERE title = 'call HR'").get().n, 1); assert.deepEqual(clean(errors), []); await ctx.close();
});

test('no other effects: said in words; a read request has no preview; Arabic and emoji text stay readable', async () => {
  const { page, ctx } = await open();
  await ask(page, 'add a note that the lab is closed on Sunday'); await page.waitForSelector('.preview');
  assert.equal((await page.innerText('.preview .fx')).trim(), 'No other effects found.'); await page.click('.preview button:has-text("Reject")');
  await ask(page, 'what are my tasks'); await page.waitForSelector('.msg.bot:last-child .text:has-text("Prepare the slides")'); assert.equal(await page.locator('.preview').count(), 0, 'reading needs no approval and shows no preview');
  await ask(page, 'add a task to مراجعة طلب التأشيرة وتجديد الإقامة 🚀 by friday'); await page.waitForSelector('.preview .fx li');
  assert.ok(await page.locator('.preview .fx li').count() >= 2); await ctx.close();
});

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1024, 1440]) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': a preview with effects', async () => {
    const { page, ctx, errors } = await open({ width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await ask(page, 'add a task to call HR by friday'); await page.waitForSelector('.preview .fx li'); await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(checkLayout), []);
    await page.evaluate(src => (0, eval)(src), AXE);
    const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }));
    const bad = ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | '));
    assert.deepEqual(bad, [], bad.join('\n')); assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

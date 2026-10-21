// Day Replay in the browser: a day's events in order, the time slider (keyboard and mouse) filters what counts as "so far",
// day buttons, empty days, 200 events, read-only (no change requests), and clean at four widths in both themes.
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
const dubai = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date(ms));
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TODAY = dubai(Date.now()), D = addDays(TODAY, -1);
const at = (day, hhmmss) => Date.parse(day + 'T' + hhmmss + '+04:00');
let browser, app, base; const extra = [];
test.before(async () => {
  browser = await H.launch();
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-replay-')), 'r.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local,b@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  const db = app.db; db.prepare("INSERT INTO users (email, display_name, created_at) VALUES ('a@nova.local', 'Ayla', 1)").run();
  const r = Number(db.prepare("INSERT INTO runs (user_id, request, status, planner, created_at, updated_at) VALUES (1, 'x', 'completed', 'rules', 1, 1)").run().lastInsertRowid);
  const st = (seq, kind, summary, t) => db.prepare('INSERT INTO run_steps (run_id, user_id, seq, kind, summary, ts) VALUES (?, 1, ?, ?, ?, ?)').run(r, seq, kind, summary, at(D, t));
  st(1, 'request', 'You asked: add a task to call the bank', '09:00:00'); st(2, 'approval_requested', 'Waiting for your approval: create a task', '09:00:02'); st(3, 'approval_granted', 'You approved: tasks.create.', '09:01:10');
  st(4, 'verified', 'Read back from the database: task #5 exists.', '09:01:11'); st(5, 'request', 'You asked: مراجعة طلب التأشيرة 🚀', '15:30:00'); st(6, 'approval_rejected', 'You rejected: delete a task.', '15:31:00');
  base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); for (const a of [app].concat(extra)) { a.server.closeAllConnections(); await a.close(); } });

async function open(b, email, opts) {
  const o = await H.openApp(browser, Object.assign({ base: b, hash: '' }, opts || {}));
  const changes = []; o.page.on('request', q => { if (q.method() !== 'GET') changes.push(q.method() + ' ' + q.url()); });
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', email); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  changes.length = 0; o.changes = changes; return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const goDay = async (page, day) => { await page.fill('#rpDay', day); await page.dispatchEvent('#rpDay', 'change'); await page.waitForFunction(d => (document.querySelector('.rp-dayname') || {}).textContent && document.querySelector('#rpDay').value === d && !document.querySelector('#main .empty.loading'), day); };

test('a day in order: times, plain titles, the slider and the readout agree; Home/End/arrows and a time button move the marker; later rows are marked', async () => {
  const { page, ctx, errors, changes } = await open(base, 'a@nova.local');
  await page.evaluate(() => { location.hash = 'replay'; }); await page.waitForSelector('#rpTime');
  assert.deepEqual(await page.$$eval('.rp-ev .rp-title', t => t.map(x => x.childNodes[0].textContent)), ['You signed in']);   // today: only this sign-in
  await page.click('button[data-act="rpPrev"]'); await page.waitForSelector('.rp-ev');
  assert.equal(await page.inputValue('#rpDay'), D);
  assert.deepEqual(await page.$$eval('.rp-ev .rp-title', t => t.map(x => x.childNodes[0].textContent)), ['You asked', 'Preview shown, waiting for you', 'You approved', 'Result checked', 'You asked', 'You rejected']);
  assert.deepEqual(await page.$$eval('.rp-time', t => t.map(x => x.textContent)), ['09:00:00', '09:00:02', '09:01:10', '09:01:11', '15:30:00', '15:31:00']);
  assert.match(await page.innerText('.rp-list'), /مراجعة طلب التأشيرة 🚀/);
  assert.equal(await page.getAttribute('#rpTime', 'value'), '1439', 'a past day starts with the marker at the end of the day');
  assert.match(await page.innerText('#rpReadout'), /Up to 23:59: 6 of 6 events/); assert.equal(await page.locator('.rp-ev.later').count(), 0);
  await page.focus('#rpTime'); await page.keyboard.press('Home');
  assert.match(await page.innerText('#rpReadout'), /Up to 00:00: 0 of 6 events/); assert.equal(await page.locator('.rp-ev.later').count(), 6);
  assert.match(await page.innerText('.rp-ev .rp-later-text'), /later than the marker/);
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight'); assert.match(await page.innerText('#rpReadout'), /Up to 00:05: 0 of 6 events/, 'arrow keys move one minute');
  await page.fill('#rpTime', '545');                                                                       // 09:05 in one move (a mouse drag does the same)
  assert.match(await page.innerText('#rpReadout'), /Up to 09:05: 4 of 6 events/); assert.equal(await page.locator('.rp-ev.later').count(), 2);
  assert.match(await page.getAttribute('#rpTime', 'aria-valuetext'), /^09:05, 4 of 6 events so far$/);
  await page.locator('.rp-time', { hasText: '15:30:00' }).click(); assert.match(await page.innerText('#rpReadout'), /Up to 15:30: 5 of 6 events/);
  await page.focus('#rpTime'); await page.keyboard.press('End'); assert.match(await page.innerText('#rpReadout'), /Up to 23:59: 6 of 6/);
  assert.deepEqual(changes, [], 'read-only: no request that changes anything'); assert.deepEqual(clean(errors), []); await ctx.close();
});

test('day buttons: previous, next and today; the date box; the future is refused; an empty day says so', async () => {
  const { page, ctx } = await open(base, 'a@nova.local');
  await page.evaluate(() => { location.hash = 'replay'; }); await page.waitForSelector('#rpTime');
  assert.equal(await page.isDisabled('button[data-act="rpNext"]'), true); assert.equal(await page.isDisabled('button[data-act="rpToday"]'), true); assert.equal(await page.getAttribute('#rpDay', 'max'), TODAY);
  await page.click('button[data-act="rpPrev"]'); await page.waitForSelector('.rp-ev'); assert.equal(await page.inputValue('#rpDay'), D);
  await page.click('button[data-act="rpPrev"]'); await page.waitForSelector('#main .empty:has-text("Nothing happened on this day")'); assert.equal(await page.inputValue('#rpDay'), addDays(D, -1));
  await page.click('button[data-act="rpToday"]'); await page.waitForFunction(d => document.querySelector('#rpDay').value === d, TODAY);
  await page.click('button[data-act="rpPrev"]'); await page.waitForSelector('.rp-ev'); await page.click('button[data-act="rpNext"]'); await page.waitForFunction(d => document.querySelector('#rpDay').value === d, TODAY);
  await goDay(page, D); await page.waitForSelector('.rp-ev');
  await ctx.close();
});

test('200+ events: all shown in order, the slider counts them, nothing overflows; another account sees nothing', async () => {
  const a = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-replay-big-')), 'b.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local,b@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000' }); extra.push(a);
  a.db.prepare("INSERT INTO users (email, display_name, created_at) VALUES ('a@nova.local', 'Ayla', 1)").run();
  const r = Number(a.db.prepare("INSERT INTO runs (user_id, request, status, planner, created_at, updated_at) VALUES (1, 'x', 'completed', 'rules', 1, 1)").run().lastInsertRowid);
  a.db.exec('BEGIN'); for (let i = 0; i < 240; i++) a.db.prepare('INSERT INTO run_steps (run_id, user_id, seq, kind, summary, ts) VALUES (?, 1, ?, ?, ?, ?)').run(r, i, 'verified', (i % 7 ? 'Checked item ' + i + ' with a fairly long description that keeps going to test wrapping' : 'تم التحقق من العنصر ' + i + ' 🚀'), at(D, '08:00:00') + i * 60000); a.db.exec('COMMIT');
  const b = 'http://127.0.0.1:' + await a.listen();
  const { page, ctx, errors } = await open(b, 'a@nova.local');
  await page.evaluate(() => { location.hash = 'replay'; }); await page.waitForSelector('#rpTime'); await page.click('button[data-act="rpPrev"]'); await page.waitForSelector('.rp-ev');
  assert.equal(await page.locator('.rp-ev').count(), 240);
  await page.focus('#rpTime'); await page.fill('#rpTime', '540');                                                                    // 09:00 -> events at 08:00 to 09:00 = 61
  assert.match(await page.innerText('#rpReadout'), /Up to 09:00: 61 of 240 events/);
  assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(clean(errors), []); await ctx.close();
  const o = await open(b, 'b@nova.local'); await o.page.evaluate(() => { location.hash = 'replay'; }); await o.page.waitForSelector('#rpTime'); await o.page.click('button[data-act="rpPrev"]');
  await o.page.waitForSelector('#main .empty:has-text("Nothing happened on this day")'); await o.ctx.close();
});

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1024, 1440]) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': the day, the slider and the quiet rows', async () => {
    const { page, ctx, errors } = await open(base, 'a@nova.local', { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await page.evaluate(() => { location.hash = 'replay'; }); await page.waitForSelector('#rpTime'); await page.click('button[data-act="rpPrev"]'); await page.waitForSelector('.rp-ev');
    await page.fill('#rpTime', '545');                                                                       // some rows quiet, some full
    assert.ok(await page.locator('.rp-ev.later').count() > 0 && await page.locator('.rp-ev:not(.later)').count() > 0); await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(checkLayout), []);
    await page.evaluate(src => (0, eval)(src), AXE);
    const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }));
    const bad = ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | '));
    assert.deepEqual(bad, [], bad.join('\n')); assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

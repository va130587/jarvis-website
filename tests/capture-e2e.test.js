// Quick capture in the browser: top-bar button and Ctrl+K "Capture:", one combined preview, nothing added before Approve, keyboard-only,
// unsure parts unticked, edits, results with Undo, plain errors; clean at four widths in both themes, also at 150% text.
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
let browser; const apps = [];
test.before(async () => { browser = await H.launch(); });
test.after(async () => { await browser.close(); for (const a of apps) { a.server.closeAllConnections(); await a.close(); } });

async function server() {
  const app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-cap-')), 'c.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  apps.push(app); return { app, base: 'http://127.0.0.1:' + await app.listen() };
}
async function open(base, opts) {
  const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {}));
  const posts = []; o.page.on('request', q => { if (q.method() !== 'GET') posts.push(q.method() + ' ' + new URL(q.url()).pathname); });
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  await o.page.waitForSelector('#capBtn', { state: 'attached' }); posts.length = 0; o.posts = posts; return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const MIXED = 'call Sara tomorrow 3pm, AED 40 lunch, note: مراجعة طلب التأشيرة 🚀, 40 aed, delete my tasks';
const axeRun = async page => { await page.evaluate(src => { if (!window.axe) (0, eval)(src); }, AXE); const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })); return ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')); };
// the top-bar button is hidden on narrow screens (no room); there Ctrl+K "Capture:" is the way in
const openCapture = async page => { if (await page.locator('#capBtn').isVisible()) await page.click('#capBtn'); else { await page.keyboard.press('Control+k'); await page.waitForSelector('#palQ'); await page.keyboard.type('capture:'); await page.keyboard.press('Enter'); } await page.waitForSelector('#captureDialog[open] #capText'); };
const rows = async page => page.$$eval('#capBody .cap-row', r => r.map(x => ({ text: x.innerText.replace(/\s+/g, ' '), on: !!(x.querySelector('input[data-cap=pick]') || {}).checked })));

test('top-bar button: type, Review shows ONE preview with ticks for sure parts only, nothing is added until Approve, then Added with Undo', async () => {
  const { app, base } = await server(); const { page, ctx, errors, posts } = await open(base);
  await page.click('#capBtn'); await page.waitForSelector('#captureDialog[open] #capText'); assert.equal(await page.evaluate(() => document.activeElement.id), 'capText');
  await page.fill('#capText', MIXED); await page.click('[data-cap=review]'); await page.waitForSelector('#capBody .cap-row');
  const r = await rows(page); assert.equal(r.length, 5);
  assert.match(r[0].text, /Reminder.*call Sara.*15:00/i); assert.equal(r[0].on, true); assert.match(r[1].text, /Expense.*AED 40/i);
  assert.equal(r[2].on, true); assert.match(r[3].text, /Expense.*not what it was for|see an amount/i); assert.equal(r[3].on, false); assert.match(r[4].text, /Not understood.*delete my tasks.*never deletes/i); assert.equal(r[4].on, false);
  assert.deepEqual(posts, ['POST /api/capture/preview']); assert.equal(app.db.prepare('SELECT COUNT(*) n FROM reminders').get().n, 0);
  assert.match(await page.innerText('[data-cap=approve]'), /Approve selected \(3\)/);
  await page.click('[data-cap=approve]'); await page.waitForSelector('#capBody .cap-row.ok');
  assert.match(await page.innerText('#capHead'), /Added 3 of 3/); assert.equal(app.db.prepare('SELECT COUNT(*) n FROM reminders').get().n, 1); assert.equal(app.db.prepare('SELECT COUNT(*) n FROM notes').get().n, 1); assert.equal(app.db.prepare('SELECT COUNT(*) n FROM expenses').get().n, 1);
  await page.click('[data-cap=close]'); await page.waitForFunction(() => !document.querySelector('#captureDialog[open]'));
  await page.evaluate(() => { location.hash = 'replay'; }); await page.waitForSelector('#undoPanel .un-row'); assert.equal(await page.locator('#undoPanel button[data-act="undoOpen"]').count(), 3);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('keyboard only: Ctrl+K "Capture: ..." opens it with the text, Space unticks, Enter approves; Escape closes and adds nothing', async () => {
  const { app, base } = await server(); const { page, ctx, errors } = await open(base);
  await page.keyboard.press('Control+k'); await page.waitForSelector('#palQ'); await page.keyboard.type('capture: AED 12 coffee, note: ask about visas'); await page.keyboard.press('Enter');
  await page.waitForSelector('#captureDialog[open] .cap-row'); assert.equal((await rows(page)).length, 2); assert.equal(await page.evaluate(() => document.activeElement.id), 'capHead');
  await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-cap')), 'pick'); await page.keyboard.press('Space');
  assert.match(await page.innerText('[data-cap=approve]'), /\(1\)/);
  await page.focus('[data-cap=approve]'); await page.keyboard.press('Enter'); await page.waitForSelector('#capBody .cap-row.ok');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM expenses').get().n + app.db.prepare('SELECT COUNT(*) n FROM notes').get().n, 1);
  await page.click('[data-cap=again]'); await page.fill('#capText', 'note: never added'); await page.keyboard.press('Control+Enter'); await page.waitForSelector('#capBody .cap-row');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#captureDialog[open]'));
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM notes WHERE text LIKE ?').get('%never added%').n, 0); assert.deepEqual(clean(errors), []); await ctx.close();
});

test('Edit changes a row before approval; empty text and too-long text give plain messages', async () => {
  const { app, base } = await server(); const { page, ctx } = await open(base);
  await page.click('#capBtn'); await page.click('[data-cap=review]'); assert.equal(await page.innerText('#capBody .load-error'), 'Type or paste what you want to capture.');
  await page.evaluate(() => { document.querySelector('#capText').removeAttribute('maxlength'); }); await page.fill('#capText', 'note: x '.repeat(300)); await page.click('[data-cap=review]');
  await page.waitForSelector('#capBody .load-error:has-text("2,000")'); assert.match(await page.innerText('#capBody .load-error'), /^That is too long/);
  await page.fill('#capText', 'AED 40 lunch'); await page.click('[data-cap=review]'); await page.waitForSelector('#capBody .cap-row');
  await page.click('[data-cap=edit]'); await page.fill('.cap-edit:not([hidden]) [data-field=fils]', '55.5'); await page.click('[data-cap=editDone]');
  assert.match((await rows(page))[0].text, /edited.*AED 55\.5/i); await page.click('[data-cap=approve]'); await page.waitForSelector('#capBody .cap-row.ok');
  assert.equal(app.db.prepare('SELECT amount_fils f FROM expenses').get().f, 5550); await ctx.close();
});

for (const width of [390, 768, 1024, 1440]) for (const theme of ['dark', 'light']) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': write, review, done, and 150% text', async () => {
    const { base } = await server(); const { page, ctx, errors } = await open(base, { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await openCapture(page); await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    const many = MIXED + ', ' + Array.from({ length: 12 }, (_, i) => 'note: item ' + i + ' 🚀').join(', ');
    await page.fill('#capText', many); await page.click('[data-cap=review]'); await page.waitForSelector('#capBody .cap-row'); await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => { const c = document.querySelector('.cap-card').getBoundingClientRect(); return c.left >= 0 && c.right <= innerWidth + 1; }));
    assert.deepEqual(await axeRun(page), []);
    await page.click('[data-cap=edit]'); assert.deepEqual(await axeRun(page), []); await page.click('[data-cap=editCancel]');
    await page.evaluate(() => document.documentElement.setAttribute('data-text', '150')); await page.waitForTimeout(150); assert.deepEqual(await axeRun(page), []);
    assert.ok(await page.evaluate(() => { const c = document.querySelector('#captureDialog'); return c.scrollWidth <= c.clientWidth + 1; }), 'no sideways scroll at 150% text');
    await page.click('[data-cap=approve]'); await page.waitForSelector('#capBody .cap-row.ok'); assert.deepEqual(await axeRun(page), []);
    assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

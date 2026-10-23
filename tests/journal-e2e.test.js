// Decision Journal in the browser: record a decision with a preview and approval, answer it when due, the honest record, keyboard only, the Undo list;
// clean at four widths in both themes with axe, also at 150% text.
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

const dubai = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date(ms));
const day = n => dubai(Date.now() + n * 864e5);
async function server() {
  const app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-jn-')), 'j.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', BASE_URL: '', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  apps.push(app); return { app, base: 'http://127.0.0.1:' + await app.listen() };
}
const row = (db, title, reviewOn, status, outcome) => db.prepare('INSERT INTO decisions (user_id, title, why, expected, review_on, status, outcome, reviewed_at, created_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)').run(title, 'Because مراجعة 🚀', 'It goes well', reviewOn, status, outcome || null, outcome ? 1 : null, 1);
function fixture(db) { row(db, 'Take the new job', day(-1), 'open'); row(db, 'Buy a car', day(10), 'open'); ['as_expected', 'better', 'worse', 'as_expected', 'as_expected'].forEach((o, i) => row(db, 'Old decision ' + i, day(-30 - i), 'reviewed', o)); for (let i = 0; i < 20; i++) row(db, 'Extra decision ' + i, day(30 + i), 'open'); }
async function open(srv, opts) {
  const o = await H.openApp(browser, Object.assign({ base: srv.base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  if (srv.seed) srv.seed(srv.app.db);
  await o.page.evaluate(() => { location.hash = 'journal'; }); await o.page.waitForSelector('#jnForm'); await o.page.waitForFunction(() => !/Loading…/.test(document.querySelector('main').innerText)); return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const axeRun = async page => { await page.evaluate(src => { if (!window.axe) (0, eval)(src); }, AXE); const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })); return ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')); };

test('record a decision: preview first, nothing saved until Approve, then it is listed and in the Undo list; Reject saves nothing', async () => {
  const srv = await server(); const { page, ctx, errors } = await open(srv);
  assert.match(await page.innerText('main'), /Nothing is waiting for your answer\./); assert.match(await page.innerText('#jn-rec ~ .jn-line'), /^Not enough data yet: 0 of 5 reviewed decisions needed for a record\./);
  await page.click('#jnForm button'); await page.waitForSelector('#jnForm .load-error'); assert.equal(await page.innerText('#jnForm .load-error'), 'Write what you decided and what you expect to happen.');
  await page.fill('#jnTitle', 'Move to the new office مراجعة 🚀'); await page.fill('#jnWhy', 'Shorter commute'); await page.fill('#jnExpected', 'Saves me an hour a day'); await page.fill('#jnDate', day(7));
  await page.click('#jnForm button'); await page.waitForSelector('#jnRun .preview'); const pv = await page.innerText('#jnRun'); assert.match(pv, /Record a decision/i); assert.match(pv, /Move to the new office/); assert.match(pv, /Look back on /); assert.equal(srv.app.db.prepare('SELECT COUNT(*) n FROM decisions').get().n, 0, 'nothing saved yet');
  await page.click('#jnRun button[data-act="novaRejectRun"]'); await page.waitForSelector('#jnRun:not(:has(.preview))'); assert.equal(srv.app.db.prepare('SELECT COUNT(*) n FROM decisions').get().n, 0);
  await page.click('#jnRun button[data-act="jnDismiss"]'); await page.fill('#jnTitle', 'Move to the new office'); await page.fill('#jnExpected', 'Saves me an hour a day'); await page.fill('#jnDate', day(7)); await page.focus('#jnForm button'); await page.keyboard.press('Enter');
  await page.waitForSelector('#jnRun .preview'); await page.click('#jnRun button[data-act="novaApproveRun"]'); await page.waitForSelector('#jnRun:has-text("Done and checked")');
  await page.waitForFunction(() => /Coming up/i.test(document.querySelector('main').innerText) && /Move to the new office/.test(document.querySelector('main').innerText)); assert.equal(srv.app.db.prepare('SELECT COUNT(*) n FROM decisions').get().n, 1);
  assert.equal(await page.inputValue('#jnTitle'), '', 'the form is cleared after saving');
  await page.evaluate(() => { location.hash = 'replay'; }); await page.waitForSelector('#undoPanel .un-row'); assert.match(await page.innerText('#undoPanel'), /Record a decision/i); assert.deepEqual(clean(errors), []); await ctx.close();
});

test('a decision that is due: three answers, preview, approval; the record needs 5 answered decisions', async () => {
  const srv = await server(); srv.seed = db => { row(db, 'Take the new job', day(-1), 'open'); ['as_expected', 'better', 'worse', 'as_expected'].forEach((o, i) => row(db, 'Old ' + i, day(-30 - i), 'reviewed', o)); };
  const { page, ctx, errors } = await open(srv); const t = await page.innerText('main'); assert.match(t, /Time to look back/i); assert.match(t, /Take the new job/); assert.match(t, /Not enough data yet: 4 of 5 reviewed decisions needed/);
  assert.equal(await page.locator('button[data-act="jnAnswer"]').count(), 3);
  await page.focus('button[data-act="jnAnswer"][data-id$=":better"]'); await page.keyboard.press('Enter'); await page.waitForSelector('#jnRun .preview'); assert.match(await page.innerText('#jnRun'), /Answer: Better than expected/);
  await page.click('#jnRun button[data-act="novaApproveRun"]'); await page.waitForSelector('#jnRun:has-text("Done and checked")');
  await page.waitForFunction(() => /5 reviewed|turned out as expected or better/.test(document.querySelector('main').innerText)); assert.match(await page.innerText('main'), /4 of 5 turned out as expected or better\./); assert.equal(await page.locator('button[data-act="jnAnswer"]').count(), 0);
  assert.equal(srv.app.db.prepare("SELECT outcome FROM decisions WHERE title = 'Take the new job'").get().outcome, 'better'); assert.deepEqual(clean(errors), []); await ctx.close();
});

for (const width of [390, 768, 1024, 1440]) for (const theme of ['dark', 'light']) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': with 25 decisions and a preview, also at 150% text', async () => {
    const srv = await server(); srv.seed = fixture; const { page, ctx, errors } = await open(srv, { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await page.waitForTimeout(250); assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    await page.fill('#jnTitle', 'Join the gym مراجعة 🚀'); await page.fill('#jnExpected', 'I feel better'); await page.click('#jnForm button'); await page.waitForSelector('#jnRun .preview'); await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    await page.evaluate(() => document.documentElement.setAttribute('data-text', '150')); await page.waitForTimeout(250); assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

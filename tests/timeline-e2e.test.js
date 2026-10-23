// Life Timeline in the browser: events grouped by day, kind filters and search by keyboard, "Show more" for a long history, rows that link to their page,
// plain empty state; clean at four widths in both themes with axe, also at 150% text.
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
async function server() {
  const app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-tl-')), 't.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', BASE_URL: '', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  apps.push(app); return { app, base: 'http://127.0.0.1:' + await app.listen() };
}
function fixture(db) {
  const T = Date.now() - 3600e3, OLD = T - 40 * 864e5;
  db.exec('BEGIN');
  for (let i = 0; i < 130; i++) db.prepare("INSERT INTO notes (user_id, text, created_at) VALUES (1, ?, ?)").run('Note number ' + i + (i % 10 === 0 ? ' مراجعة 🚀' : ''), T - i * 60e3);
  db.prepare("INSERT INTO tasks (user_id, title, status, created_at, completed_at) VALUES (1, 'Send the proposal', 'done', ?, ?)").run(OLD, T + 1000);
  db.prepare("INSERT INTO expenses (user_id, amount_fils, category, note, day, created_at) VALUES (1, 4500, 'food', 'Lunch', ?, ?)").run(dubai(T), T + 2000);
  db.exec('COMMIT');
}
async function open(srv, opts) {
  const o = await H.openApp(browser, Object.assign({ base: srv.base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  if (srv.seed) srv.seed(srv.app.db);
  await o.page.evaluate(() => { location.hash = 'timeline'; }); await o.page.waitForSelector('#tlForm'); await o.page.waitForFunction(() => !/Loading…/.test(document.querySelector('#main').innerText)); return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const axeRun = async page => { await page.evaluate(src => { if (!window.axe) (0, eval)(src); }, AXE); const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })); return ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')); };
const rows = page => page.locator('.tl-row').count();

test('a long history: newest first, grouped by day, "Show more" adds the next page, rows link to their page', async () => {
  const srv = await server(); srv.seed = fixture; const { page, ctx, errors } = await open(srv);
  assert.equal(await rows(page), 50); assert.match(await page.innerText('.tl-day h2'), /^Today/i); const first = await page.innerText('.tl-row'); assert.match(first, /Expense[\s\S]*AED 45 on Lunch/i);
  assert.equal(await page.getAttribute('.tl-row:nth-child(2) a', 'href'), '#hub'); assert.match(await page.getAttribute('.tl-row a', 'aria-label'), /^Open: AED 45 on Lunch/);
  await page.focus('#tlMore'); await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelectorAll('.tl-row').length === 100); assert.equal(await page.evaluate(() => document.activeElement.id), 'tlMore', 'focus stays on the button');
  await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelectorAll('.tl-row').length === 132); assert.equal(await page.locator('#tlMore').count(), 0, 'no more pages');
  const texts = await page.$$eval('.tl-row b', b => b.map(x => x.textContent)); assert.equal(new Set(texts).size, 132, 'every event once'); assert.deepEqual(clean(errors), []); await ctx.close();
});

test('filter by kind and search, by keyboard; plain "nothing matches" and a kind cannot be switched off completely', async () => {
  const srv = await server(); srv.seed = fixture; const { page, ctx } = await open(srv);
  const idle = () => page.waitForFunction(() => !NOVA.timeline.busy && NOVA.timeline.events !== null);
  await page.click('[data-act="tlType"][data-id="note"]'); await idle(); assert.equal(await rows(page), 2); assert.equal(await page.getAttribute('[data-id="note"]', 'aria-pressed'), 'false');
  await page.click('[data-act="tlType"][data-id="note"]'); await idle(); await page.waitForFunction(() => document.querySelectorAll('.tl-row').length === 50);
  for (const id of ['note', 'task', 'promise', 'habit', 'action']) { await page.click('[data-act="tlType"][data-id="' + id + '"]'); await idle(); }
  assert.equal(await rows(page), 1); assert.match(await page.innerText('.tl-row'), /AED 45 on Lunch/);
  await page.click('[data-act="tlType"][data-id="expense"]'); await page.waitForSelector('.toast:has-text("Keep at least one kind selected."), #toast:has-text("Keep at least one kind selected."), [role="status"]:has-text("Keep at least one kind selected.")'); assert.equal(await page.getAttribute('[data-id="expense"]', 'aria-pressed'), 'true');
  for (const id of ['note', 'task', 'promise', 'habit', 'action']) { await page.click('[data-act="tlType"][data-id="' + id + '"]'); await idle(); }
  await page.fill('#tlQ', 'مراجعة'); await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelectorAll('.tl-row').length === 13); assert.match(await page.innerText('#main'), /Note number 0 مراجعة 🚀/);
  await page.fill('#tlQ', 'zzz nothing'); await page.keyboard.press('Enter'); await page.waitForSelector('.empty:has-text("Nothing matches")'); assert.equal(await rows(page), 0);
  await ctx.close();
});

test('an empty timeline says so in plain words', async () => {
  const srv = await server(); const { page, ctx } = await open(srv); assert.match(await page.innerText('#main'), /Nothing has happened yet\. Finish a task, add a note or log an expense and it appears here\./); await ctx.close();
});

for (const width of [390, 768, 1024, 1440]) for (const theme of ['dark', 'light']) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': 100 events, also at 150% text', async () => {
    const srv = await server(); srv.seed = fixture; const { page, ctx, errors } = await open(srv, { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await page.click('#tlMore'); await page.waitForFunction(() => document.querySelectorAll('.tl-row').length === 100); await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    await page.evaluate(() => document.documentElement.setAttribute('data-text', '150')); await page.waitForTimeout(250); assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

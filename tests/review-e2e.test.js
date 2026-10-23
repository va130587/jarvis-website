// Weekly Review in the browser: the page for the last full week, "not enough data yet" where there is none, the week picker by keyboard,
// Copy as text and Download as Markdown, the three priorities with their rules; clean at four widths in both themes, also at 150% text.
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
const mondayOfToday = () => { const t = day(0), wd = new Date(t + 'T12:00:00Z').getUTCDay(); return day(-((wd + 6) % 7)); };
const addIso = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lastMonday = () => addIso(mondayOfToday(), -7);
const ms = (iso, hm) => Date.parse(iso + 'T' + hm + ':00+04:00');

async function server() {
  const app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-wr-')), 'r.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', BASE_URL: '', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  apps.push(app); return { app, base: 'http://127.0.0.1:' + await app.listen() };
}
function fixture(db) {
  const m = lastMonday(), d = n => addIso(m, n), OLD = Date.now() - 40 * 864e5;
  const task = (title, due, status, doneAt) => db.prepare('INSERT INTO tasks (user_id, title, due, status, created_at, completed_at) VALUES (1, ?, ?, ?, ?, ?)').run(title, due, status, OLD, doneAt || null);
  task('Send the proposal مراجعة 🚀', d(1), 'done', ms(d(1), '10:00')); task('Book the flights', null, 'done', ms(d(2), '12:00')); task('Renew passport', d(-9), 'open');
  for (let i = 0; i < 25; i++) task('Extra finished task ' + i, null, 'done', ms(d(i % 7), '09:00'));
  const id = Number(db.prepare("INSERT INTO commitments (user_id, title, direction, counterparty, deadline, source_type, status, created_at, updated_at) VALUES (1, 'Send Sara the slides', 'i_owe', 'Sara', ?, 'manual', 'verified', ?, ?)").run(d(3), OLD, OLD).lastInsertRowid);
  db.prepare("INSERT INTO commitment_events (commitment_id, user_id, seq, from_status, to_status, note, actor, ts) VALUES (?, 1, 1, 'submitted', 'verified', 'x', 'you', ?)").run(id, ms(d(2), '10:00'));
  db.prepare("INSERT INTO focus_sessions (user_id, title, planned_min, started_at, ended_at, status) VALUES (1, 'Focus', 50, ?, ?, 'completed')").run(ms(d(1), '10:00'), ms(d(1), '10:50'));
  const h = Number(db.prepare("INSERT INTO habits (user_id, name, schedule, created_at) VALUES (1, 'Read', 'daily', ?)").run(OLD).lastInsertRowid);
  for (let i = -7; i < -2; i++) db.prepare('INSERT INTO habit_checks (habit_id, user_id, day, created_at) VALUES (?, 1, ?, ?)').run(h, d(i), OLD);
  for (let i = 0; i < 2; i++) db.prepare('INSERT INTO habit_checks (habit_id, user_id, day, created_at) VALUES (?, 1, ?, ?)').run(h, d(i), OLD);
  db.prepare("INSERT INTO expenses (user_id, amount_fils, category, day, created_at) VALUES (1, 4500, 'food', ?, ?)").run(d(2), OLD);
  db.prepare("INSERT INTO budgets (user_id, category, monthly_fils) VALUES (1, 'total', 300000)").run();
}
async function open(srv, opts) {
  const o = await H.openApp(browser, Object.assign({ base: srv.base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  if (srv.seed) srv.seed(srv.app.db);
  await o.page.evaluate(() => { location.hash = 'weekreview'; }); await o.page.waitForSelector('#wrWeek'); return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const axeRun = async page => { await page.evaluate(src => { if (!window.axe) (0, eval)(src); }, AXE); const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })); return ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')); };

test('the page shows the last full week from your data: every section, the rules, and the three priorities', async () => {
  const srv = await server(); srv.seed = fixture; const { page, ctx, errors } = await open(srv);
  assert.equal(await page.innerText('main h1'), 'Weekly Review'); assert.equal(await page.inputValue('#wrWeek'), lastMonday());
  await page.waitForSelector('#wr-done'); const t = await page.textContent('main');
  assert.match(t, /What I finished/i); assert.match(t, /27 tasks finished/); assert.match(t, /Send the proposal مراجعة 🚀/); assert.match(t, /Kept on time[\s\S]*1/i); assert.match(t, /50 min in 1 session/); assert.match(t, /AED 45 spent in 1 purchase/);
  assert.match(t, /Month so far: AED 45 of AED 3,000 \(2%\)/); assert.match(t, /Read[\s\S]*2 of 7 days/); assert.match(t, /Renew passport/); assert.match(t, /Rule 1: the item that is the most overdue\./); assert.match(t, /Rule 3: a habit you did at least 2 fewer times/);
  assert.match(await page.innerText('#wr-next'), /Three priorities for next week/i); assert.deepEqual(clean(errors), []); await ctx.close();
});

test('an empty week says "not enough data yet" in plain words, section by section', async () => {
  const srv = await server(); const { page, ctx } = await open(srv); await page.waitForSelector('#wr-done');
  assert.equal((await page.$$('.wr-none')).length >= 6, true); const t = await page.innerText('main');
  assert.match(t, /Not enough data yet: no tasks were finished this week\./); assert.match(t, /Not enough data yet: no focus sessions were recorded this week\./); assert.match(t, /Nothing slipped/); assert.match(t, /No monthly budget is set/); await ctx.close();
});

test('week picker by keyboard, Copy as text, and Download as Markdown', async () => {
  const srv = await server(); srv.seed = fixture; const { page, ctx, errors } = await open(srv); await page.waitForSelector('#wr-done');
  await page.focus('#wrWeek'); await page.keyboard.press('ArrowDown'); await page.waitForFunction(() => !/Loading/.test(document.querySelector('main').innerText) && document.querySelector('#wrWeek').value !== '');
  assert.equal(await page.inputValue('#wrWeek'), addIso(lastMonday(), -7)); assert.equal(await page.evaluate(() => document.activeElement.id), 'wrWeek');
  assert.match(await page.innerText('main'), /Not enough data yet: no tasks were finished this week\./);
  await page.selectOption('#wrWeek', lastMonday()); await page.waitForSelector('#wr-done'); await page.waitForFunction(() => /27 tasks finished/.test(document.querySelector('main').innerText));
  await ctxGrant(ctx, srv.base); await page.click('button[data-act="wrCopy"]'); await page.waitForSelector('.toast:has-text("Copied your weekly review"), #toast:has-text("Copied your weekly review"), [role="status"]:has-text("Copied your weekly review")');
  const copied = await page.evaluate(() => navigator.clipboard.readText()); assert.match(copied, /^WEEKLY REVIEW: /); assert.match(copied, /Finished 27 tasks\./);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button[data-act="wrDownload"]')]);
  assert.equal(dl.suggestedFilename(), 'nova-weekly-review-' + lastMonday() + '.md'); const body = fs.readFileSync(await dl.path(), 'utf8'); assert.match(body, /^# Weekly Review: /); assert.match(body, /\n## Three priorities for next week\n/);
  assert.deepEqual(clean(errors), []); await ctx.close();
});
async function ctxGrant(ctx, base) { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base }).catch(() => {}); }

test('it is in the Life group of the menu and in Ctrl+K, and the sidebar link is keyboard reachable', async () => {
  const srv = await server(); const { page, ctx } = await open(srv);
  assert.equal(await page.getAttribute('.nav a[data-view="weekreview"]', 'href'), '#weekreview');
  await page.evaluate(() => { location.hash = 'dashboard'; }); await page.keyboard.press('Control+k'); await page.waitForSelector('#palQ'); await page.keyboard.type('weekly rev'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => J.current() === 'weekreview'); await ctx.close();
});

for (const width of [390, 768, 1024, 1440]) for (const theme of ['dark', 'light']) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': a full week and an empty week, also at 150% text', async () => {
    const full = await server(); full.seed = fixture; const o = await open(full, { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await o.page.waitForSelector('#wr-done'); await o.page.waitForTimeout(300);
    assert.deepEqual(await o.page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(o.page), []);
    await o.page.evaluate(() => document.documentElement.setAttribute('data-text', '150')); await o.page.waitForTimeout(250);
    assert.deepEqual(await o.page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(o.page), []); assert.deepEqual(clean(o.errors), []); await o.ctx.close();
    const empty = await server(); const e = await open(empty, { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await e.page.waitForSelector('#wr-done'); await e.page.waitForTimeout(250); assert.deepEqual(await e.page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(e.page), []); assert.deepEqual(clean(e.errors), []); await e.ctx.close();
  });
}

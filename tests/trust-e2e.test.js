// "Can people rely on me?" on the ProofLoop page: the numbers with their rule, "not enough data yet", the "Before you promise" week check by keyboard,
// the empty state; clean at four widths in both themes with axe, also at 150% text.
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
  const app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-trust-')), 't.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', BASE_URL: '', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  apps.push(app); return { app, base: 'http://127.0.0.1:' + await app.listen() };
}
function add(db, o) {
  const id = Number(db.prepare('INSERT INTO commitments (user_id, title, direction, counterparty, deadline, source_type, status, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)').run(o.title, o.dir || 'i_owe', o.who || null, o.deadline || null, 'manual', o.status, Date.now() - 864e5 * 20, Date.now()).lastInsertRowid);
  db.prepare("INSERT INTO commitment_events (commitment_id, user_id, seq, from_status, to_status, note, actor, ts) VALUES (?, 1, 1, NULL, 'request_detected', 'x', 'you', ?)").run(id, Date.now() - 864e5 * 20);
  if (o.keptDays !== undefined) db.prepare("INSERT INTO commitment_events (commitment_id, user_id, seq, from_status, to_status, note, actor, ts) VALUES (?, 1, 2, 'submitted', 'verified', 'x', 'you', ?)").run(id, Date.now() + o.keptDays * 864e5);
}
function fixture(db) {
  add(db, { title: 'Send the slides', who: 'Sara Haddad', deadline: day(-10), status: 'verified', keptDays: -11 });
  add(db, { title: 'Review the budget', who: 'Sara Haddad', deadline: day(-8), status: 'verified', keptDays: -5 });
  add(db, { title: 'Book the room', who: 'Sara Haddad', deadline: day(-3), status: 'failed' });
  add(db, { title: 'Share the report مراجعة 🚀', who: 'Sara Haddad', deadline: day(-1), status: 'task_prepared' });
  add(db, { title: 'Call Omar', who: 'Omar', deadline: day(-6), status: 'verified', keptDays: -7 });
  for (let i = 0; i < 4; i++) add(db, { title: 'Open promise ' + i, who: 'Person ' + i, deadline: day(3), status: 'task_prepared' });
  add(db, { title: 'Send me the contract', dir: 'owed_to_me', who: 'Lina', deadline: day(-9), status: 'verified', keptDays: -10 });
  add(db, { title: 'Send me the photos', dir: 'owed_to_me', who: 'Lina', deadline: day(-9), status: 'verified', keptDays: -10 });
  add(db, { title: 'Send me the invoice', dir: 'owed_to_me', who: 'Lina', deadline: day(-9), status: 'verified', keptDays: -2 });
}
async function open(base) { // base is an object with page opts
  const o = await H.openApp(browser, Object.assign({ base: base.base, hash: '' }, base.opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  if (base.seed) base.seed(base.app.db);
  await o.page.evaluate(() => { location.hash = 'proofloop'; }); await o.page.waitForSelector('#trustPanel .trust-side, #trustPanel .empty');
  return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const axeRun = async page => { await page.evaluate(src => { if (!window.axe) (0, eval)(src); }, AXE); const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })); return ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')); };

test('the panel shows the numbers and the rule; a person with fewer than 3 counted promises says "not enough data yet"', async () => {
  const srv = await server(); srv.seed = fixture; const { page, ctx, errors } = await open(srv);
  const text = await page.innerText('#trustPanel');
  assert.match(text, /Can people rely on me\?/i); assert.match(text, /You kept 2 of 5 promises on time\./); assert.match(text, /\(40%\)/);
  assert.match(text, /You kept 1 of 4 promises to Sara Haddad on time\./); assert.match(text, /Omar[\s\S]*Not enough data yet: at least 3 promises/);
  assert.match(text, /Lina kept 2 of 3 promises to you on time\./);
  assert.equal(await page.getAttribute('#trustPanel details.trust-rule', 'open'), null); await page.click('#trustPanel .trust-rule summary'); assert.match(await page.innerText('#trustPanel .trust-rule'), /on or before its deadline/);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('"Before you promise": pick a date by keyboard, press Enter, and the week is read out; nothing is changed', async () => {
  const srv = await server(); srv.seed = fixture; const { page, ctx, errors } = await open(srv); const before = srv.app.db.prepare('SELECT COUNT(*) n FROM commitments').get().n;
  await page.fill('#trustDate', day(3)); await page.focus('#trustDate'); await page.keyboard.press('Enter');
  await page.waitForSelector('.trust-heads .trust-people'); const t = await page.innerText('.trust-heads');
  assert.match(t, /Heads up\./); assert.match(t, /You already have \d+ open promises due the week of /); assert.match(t, /Open promise 0/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'trustDate', 'focus stays on the field');
  await page.fill('#trustDate', day(60)); await page.keyboard.press('Enter'); await page.waitForSelector('.trust-heads:has-text("No heads-up")');
  assert.match(await page.innerText('.trust-heads'), /You have 0 open promises due that week/);
  await page.fill('#trustDate', ''); await page.keyboard.press('Enter'); await page.waitForSelector('.trust-heads .load-error'); assert.equal(await page.innerText('.trust-heads .load-error'), 'Choose a date first.');
  assert.equal(srv.app.db.prepare('SELECT COUNT(*) n FROM commitments').get().n, before); assert.deepEqual(clean(errors), []); await ctx.close();
});

test('with no promises the panel says so in plain words', async () => {
  const srv = await server(); const { page, ctx } = await open(srv);
  assert.match(await page.innerText('#trustPanel'), /No promises yet\./); await ctx.close();
});

for (const width of [390, 768, 1024, 1440]) for (const theme of ['dark', 'light']) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': the trust panel, also at 150% text', async () => {
    const srv = await server(); srv.seed = fixture; srv.opts = { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined };
    const { page, ctx, errors } = await open(srv); await page.waitForTimeout(300);
    await page.fill('#trustDate', day(3)); await page.keyboard.press('Enter'); await page.waitForSelector('.trust-heads .trust-people'); await page.click('#trustPanel .trust-rule summary'); await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    await page.evaluate(() => document.documentElement.setAttribute('data-text', '150')); await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

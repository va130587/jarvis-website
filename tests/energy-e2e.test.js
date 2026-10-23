// Energy marks on the Focus and Planner page: one tap per part of today (by keyboard too), "not enough data yet" before 7 days, the planner switch
// only after 7 days; clean at four widths in both themes with axe, also at 150% text.
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
  const app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-en-')), 'e.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', BASE_URL: '', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  apps.push(app); return { app, base: 'http://127.0.0.1:' + await app.listen() };
}
const history = db => { for (let i = 1; i <= 8; i++) { db.prepare("INSERT OR REPLACE INTO energy_marks (user_id, day, slot, level, updated_at) VALUES (1, ?, 'morning', ?, 1)").run(day(-i), i <= 6 ? 'high' : 'low'); db.prepare("INSERT OR REPLACE INTO energy_marks (user_id, day, slot, level, updated_at) VALUES (1, ?, 'afternoon', 'medium', 1)").run(day(-i)); } };
async function open(srv, opts) {
  const o = await H.openApp(browser, Object.assign({ base: srv.base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  if (srv.seed) srv.seed(srv.app.db);
  await o.page.evaluate(() => { location.hash = 'focus'; }); await o.page.waitForSelector('#energyPanel .en-row'); return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const axeRun = async page => { await page.evaluate(src => { if (!window.axe) (0, eval)(src); }, AXE); const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })); return ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')); };
const pressed = page => page.$$eval('#energyPanel [data-act="enMark"]', b => b.filter(x => x.getAttribute('aria-pressed') === 'true').map(x => x.getAttribute('data-id')));

test('tap and keyboard: mark each part of today, change it, clear it; before 7 days the pattern says "not enough data yet" and the switch is off', async () => {
  const srv = await server(); const { page, ctx, errors } = await open(srv);
  assert.match(await page.innerText('#energyPanel'), /How is your energy\?/i); assert.match(await page.innerText('.en-summary'), /^Not enough data yet: 0 of 7 days marked\./); assert.equal(await page.isDisabled('#enPlan'), true);
  await page.click('[data-id="morning:high"]'); await page.waitForFunction(() => document.querySelector('[data-id="morning:high"]').getAttribute('aria-pressed') === 'true'); assert.deepEqual(await pressed(page), ['morning:high']);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-id')), 'morning:high', 'focus stays on the button you pressed');
  await page.focus('[data-id="afternoon:medium"]'); await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelector('[data-id="afternoon:medium"]').getAttribute('aria-pressed') === 'true');
  await page.click('[data-id="morning:low"]'); await page.waitForFunction(() => document.querySelector('[data-id="morning:low"]').getAttribute('aria-pressed') === 'true'); assert.deepEqual(await pressed(page), ['morning:low', 'afternoon:medium']);
  await page.click('[data-id="morning:low"]'); await page.waitForFunction(() => document.querySelector('[data-id="morning:low"]').getAttribute('aria-pressed') === 'false'); assert.deepEqual(await pressed(page), ['afternoon:medium'], 'pressing it again clears it');
  assert.equal(srv.app.db.prepare('SELECT COUNT(*) n FROM energy_marks WHERE user_id = 1').get().n, 1); assert.deepEqual(clean(errors), []); await ctx.close();
});

test('after 7 days the pattern appears and the planner switch can be turned on and off by keyboard', async () => {
  const srv = await server(); srv.seed = history; const { page, ctx, errors } = await open(srv);
  assert.equal(await page.innerText('.en-summary'), 'You usually mark high energy in the morning (6 of 8 days).'); assert.equal(await page.isDisabled('#enPlan'), false);
  await page.focus('#enPlan'); await page.keyboard.press('Space'); await page.waitForSelector('.en-plan:has-text("go in your high-energy time")');
  assert.equal(srv.app.db.prepare('SELECT energy_plan FROM users WHERE id = 1').get().energy_plan, 1); assert.match(await page.innerText('.en-plan'), /Hard tasks \(60 minutes or more\) go in your high-energy time/); assert.equal(await page.evaluate(() => document.activeElement.id), 'enPlan');
  await page.focus('#enPlan'); await page.keyboard.press('Space'); await page.waitForSelector('.en-plan:has-text("Off. The planner ignores")'); assert.equal(srv.app.db.prepare('SELECT energy_plan FROM users WHERE id = 1').get().energy_plan, 0);
  await page.click('#energyPanel .trust-rule summary'); assert.match(await page.innerText('#energyPanel .trust-rule'), /at least 7 different days/); assert.deepEqual(clean(errors), []); await ctx.close();
});

for (const width of [390, 768, 1024, 1440]) for (const theme of ['dark', 'light']) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': before and after 7 days, also at 150% text', async () => {
    const srv = await server(); srv.seed = history; const { page, ctx, errors } = await open(srv, { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await page.click('[data-id="morning:high"]'); await page.click('#energyPanel .trust-rule summary'); await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    await page.evaluate(() => document.documentElement.setAttribute('data-text', '150')); await page.waitForTimeout(250); assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    assert.deepEqual(clean(errors), []); await ctx.close();
    const fresh = await server(); const f = await open(fresh, { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined }); await f.page.waitForTimeout(250);
    assert.deepEqual(await f.page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(f.page), []); assert.deepEqual(clean(f.errors), []); await f.ctx.close();
  });
}

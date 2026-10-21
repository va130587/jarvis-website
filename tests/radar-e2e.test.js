// Life Radar in the browser (Weekly Insights): five spokes, two outlines told apart by line style and words, exact numbers on
// hover and keyboard focus, "not enough data yet" instead of invented values, a table view, the scoring rules, both themes.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers');
const { checkLayout } = require('./layout-check');
const { createApp } = require('../server');
const { seed, NOW } = require('./radar-fixture');

const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
let browser; const apps = [];
const mk = (withData) => {
  const a = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-radar-')), 'r.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }, { now: () => NOW });
  a.db.prepare("INSERT INTO users (email, display_name, created_at) VALUES ('a@nova.local', 'Ayla', 1)").run(); if (withData) seed(a.db, 1);
  apps.push(a); return a;
};
test.before(async () => { browser = await H.launch(); });
test.after(async () => { await browser.close(); for (const a of apps) { a.server.closeAllConnections(); await a.close(); } });
async function open(app, opts) {
  const base = 'http://127.0.0.1:' + await app.listen();
  const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  await o.page.evaluate(() => { location.hash = 'insights'; }); await o.page.waitForSelector('#radarPanel .rd-svg');
  return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));

test('five spokes and two outlines: exact numbers by hover and keyboard, legend and scoring rules in words, a table with the same numbers', async () => {
  const { page, ctx, errors } = await open(mk(true));
  assert.equal(await page.locator('.rd-spoke').count(), 5);
  assert.equal(await page.locator('.rd-shape.rd-this').count(), 1); assert.equal(await page.locator('.rd-shape.rd-last').count(), 1);
  assert.equal(await page.locator('.rd-dot.rd-this').count(), 5); assert.equal(await page.locator('.rd-dot.rd-last').count(), 5);
  assert.notEqual(await page.$eval('.rd-shape.rd-last', e => getComputedStyle(e).strokeDasharray), 'none', 'last week is dashed: told apart without colour');
  assert.equal(await page.$eval('.rd-shape.rd-this', e => getComputedStyle(e).strokeDasharray), 'none');
  assert.deepEqual(await page.$$eval('.rd-lbl', t => t.map(x => x.textContent)), ['Promises kept', 'Focus', 'Habits', 'Budget', 'No overdue']);
  const legend = await page.innerText('.rd-legend'); assert.match(legend, /This week \(19 Oct to 21 Oct, so far\)/); assert.match(legend, /Last week \(12 Oct to 18 Oct\)/);
  await page.locator('.rd-spoke').first().focus();
  assert.equal(await page.innerText('#rdTip'), 'Promises kept on time: this week 33 (kept 1 of 3), last week 100 (kept 2 of 2)');
  await page.keyboard.press('Tab'); assert.equal(await page.innerText('#rdTip'), 'Focus time: this week 30 (1 h 30 min of focus), last week 50 (2 h 30 min of focus)');
  await page.locator('.rd-spoke').nth(3).hover(); assert.match(await page.innerText('#rdTip'), /Spending within budget: this week 100 \(AED 200 spent of AED 290\), last week 52/);
  assert.equal(await page.locator('.rd-rules li').count(), 5); assert.match(await page.innerText('.rd-rules'), /each overdue item costs 10 points/);
  await page.click('#radarPanel summary'); const rows = await page.$$eval('#radarPanel tbody tr', r => r.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
  assert.equal(rows.length, 5); assert.match(rows[0], /Promises kept on time 33 · kept 1 of 3 100 · kept 2 of 2/i); assert.match(rows[4], /Nothing overdue 80 · 2 overdue 90 · 1 overdue/i);
  assert.ok(!/NaN|undefined/.test(await page.$eval('.rd-svg', e => e.outerHTML)));
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('no data: "not enough data yet" in words, left out of the outline, never a made-up number', async () => {
  const { page, ctx, errors } = await open(mk(false));
  assert.equal(await page.locator('.rd-nodata').count(), 4); assert.equal(await page.locator('.rd-dot.rd-this').count(), 1, 'only "nothing overdue" can be measured');
  assert.equal(await page.locator('.rd-shape.rd-this').count(), 0, 'one point makes no shape');
  assert.match(await page.innerText('#radarPanel'), /left out of the outline: Promises kept on time, Focus time, Habits done, Spending within budget/);
  await page.locator('.rd-spoke').first().focus(); assert.equal(await page.innerText('#rdTip'), 'Promises kept on time: this week not enough data yet, last week not enough data yet');
  await page.click('#radarPanel summary'); assert.match(await page.innerText('#radarPanel tbody tr'), /not enough data yet/);
  assert.ok(!/NaN|undefined/.test(await page.$eval('.rd-svg', e => e.outerHTML))); assert.deepEqual(clean(errors), []); await ctx.close();
});

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1024, 1440]) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': the radar, labels, tip, table and rules', async () => {
    const { page, ctx, errors } = await open(mk(true), { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await page.click('#radarPanel summary'); await page.locator('.rd-spoke').nth(3).focus(); await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(checkLayout), []);
    const box = await page.$eval('.rd-svg', e => { const r = e.getBoundingClientRect(); return [r.left, r.right, innerWidth]; }); assert.ok(box[0] >= 0 && box[1] <= box[2], 'the chart fits the screen');
    await page.evaluate(src => (0, eval)(src), AXE);
    const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }));
    const bad = ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | '));
    assert.deepEqual(bad, [], bad.join('\n')); assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

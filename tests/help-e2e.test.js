// Help page in the browser: the guide, the common problems, "Check my setup" (read-only), keyboard use, an unavailable check,
// the menu entry and Ctrl+K, and clean at four widths in both themes.
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
let browser, app, base;
test.before(async () => {
  browser = await H.launch();
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-help-')), 'h.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  app.scheduler.start(); base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); app.scheduler.stop(); app.server.closeAllConnections(); await app.close(); });

async function open(opts) {
  const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {}));
  const changes = []; o.page.on('request', q => { if (q.method() !== 'GET') changes.push(q.method() + ' ' + q.url()); });
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  changes.length = 0; o.changes = changes; return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));

test('the Help page: how to start, the five common problems, every page explained; reachable from the System menu and Ctrl+K', async () => {
  const { page, ctx, errors } = await open();
  await page.click('.nav a[data-view="support"]'); await page.waitForSelector('#hpCheck');
  await page.waitForFunction(() => document.querySelector('main h1').textContent === 'Help');                // the title types itself in for a moment
  assert.match(await page.innerText('main'), /Start NOVA demo\.bat/); assert.match(await page.innerText('main'), /127\.0\.0\.1:8788/);
  const problems = await page.$$eval('.hp-prob summary', s => s.map(x => x.textContent));
  assert.equal(problems.length, 5); for (const w of [/port/i, /Node\.js/, /Gmail/, /Firefox/, /e-mail I used/]) assert.ok(problems.some(p => w.test(p)), String(w));
  await page.locator('.hp-prob summary', { hasText: 'Firefox' }).click(); assert.match(await page.innerText('.hp-prob[open] p'), /Chrome or Edge/);
  assert.equal(await page.locator('.hp-pages dt').count(), 23);
  assert.equal(await page.getAttribute('.nav a[data-view="support"]', 'href'), '#support');
  await page.evaluate(() => { location.hash = 'dashboard'; }); await page.keyboard.press('Control+k'); await page.waitForSelector('#novaPalette:not([hidden])'); await page.keyboard.type('Help'); await page.waitForTimeout(300);
  assert.match(await page.innerText('#novaPalette'), /Help/); await page.keyboard.press('Enter'); await page.waitForFunction(() => J.current() === 'support');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('Check my setup: by keyboard, shows each check with a word (not colour alone), changes nothing, can be run again', async () => {
  const { page, ctx, errors, changes } = await open();
  await page.evaluate(() => { location.hash = 'support'; }); await page.waitForSelector('#hpCheck');
  await page.focus('button[data-act="hpCheck"]'); await page.keyboard.press('Enter'); await page.waitForSelector('.hp-checks li');
  assert.equal(await page.locator('.hp-checks li').count(), 6);
  const rows = await page.$$eval('.hp-checks li', l => l.map(x => x.innerText.replace(/\s+/g, ' ')));
  assert.match(rows[0], /Node\.js.*OK/i); assert.match(rows[1], /Your data.*OK/i); assert.match(rows[2], /Daily jobs.*OK/i); assert.match(rows[4], /Gmail.*fine.*Not set up/i); assert.match(rows[5], /AI model.*fine.*Not set up/i);
  assert.match(await page.innerText('.hp-summary'), /working/);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-act')), 'hpCheck', 'focus stays on the button');
  assert.equal(await page.innerText('button[data-act="hpCheck"]'), 'Check again');
  assert.deepEqual(changes, [], 'read-only: no request that changes anything'); assert.deepEqual(clean(errors), []); await ctx.close();
});

test('when the check cannot run, the page says so in plain words and can try again', async () => {
  const { page, ctx } = await open();
  await page.evaluate(() => { location.hash = 'support'; }); await page.waitForSelector('#hpCheck');
  await page.route('**/api/check', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await page.click('button[data-act="hpCheck"]'); await page.waitForSelector('#hpCheck .load-error');
  assert.match(await page.innerText('#hpCheck .load-error'), /Something went wrong on the server\. Nothing was changed/);
  assert.doesNotMatch(await page.innerText('#hpCheck'), /undefined|\[object|Error:|500/);
  await page.unroute('**/api/check'); await page.click('button[data-act="hpCheck"]'); await page.waitForSelector('.hp-checks li'); await ctx.close();
});

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1024, 1440]) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': the Help page with its results', async () => {
    const { page, ctx, errors } = await open({ width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await page.evaluate(() => { location.hash = 'support'; }); await page.waitForSelector('#hpCheck'); await page.click('button[data-act="hpCheck"]'); await page.waitForSelector('.hp-checks li');
    await page.locator('.hp-prob summary').first().click(); await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(checkLayout), []);
    await page.evaluate(src => (0, eval)(src), AXE);
    const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }));
    const bad = ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | '));
    assert.deepEqual(bad, [], bad.join('\n')); assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

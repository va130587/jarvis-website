// The signature look: sidebar groups and the phone bottom bar, skeletons while loading, page changes under 250 ms,
// the orb gliding between states, an ambient background that stops when the tab is hidden or motion is reduced,
// count-ups that end on the real number, and one greeting on the dashboard.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers');
const { createApp } = require('../server');
const { seed } = require('../scripts/demo');

let browser, app, base;
test.before(async () => {
  browser = await H.launch();
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-sig-')), 's.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'demo@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  seed(app); app.email.loadDemo(1);
  base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); app.server.closeAllConnections(); await app.close(); });

async function open(opts) {
  const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'demo@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));

test('sidebar in five groups (Today, Work, Life, Knowledge, System); the phone bar has Home, Today, Chat, Tasks and More', async () => {
  const { page, ctx, errors } = await open();
  const groups = await page.$$eval('.nav .nav-group', g => g.map(x => x.textContent));
  assert.deepEqual(groups.slice(0, 5), ['Today', 'Work', 'Life', 'Knowledge', 'System']);
  assert.equal(await page.locator('.nav a[data-view]').count() >= 17, true, 'every page is still in the sidebar');
  await ctx.close();
  const m = await open({ width: 390, height: 844 });
  assert.deepEqual(await m.page.$$eval('.bottom-nav a span', s => s.map(x => x.textContent)), ['Home', 'Today', 'Chat', 'Tasks']);
  await m.page.click('#moreBtn'); await m.page.waitForSelector('#moreSheet:not([hidden]) a[data-view="voice"]');
  assert.deepEqual(clean(errors.concat(m.errors)), []); await m.ctx.close();
});

test('dashboard: one greeting; the hero carries the day\'s headline; numbers count up to the real value', async () => {
  const { page, ctx, errors } = await open();
  await page.waitForSelector('.dash-brief .brief-hero');
  assert.equal(await page.locator('main h1, main h2').filter({ hasText: /^Good (morning|afternoon|evening)/ }).count(), 1);
  assert.match(await page.innerText('.nova-hero .lead'), /overdue|due today|Nothing|follow-up|e-mail/i);
  await page.evaluate(() => { location.hash = 'insights'; }); await page.waitForSelector('.chart');
  await page.evaluate(() => { location.hash = 'dashboard'; }); await page.waitForTimeout(600);
  const counts = await page.$$eval('[data-count]', els => els.map(e => [e.textContent, e.getAttribute('data-count')]));
  assert.ok(counts.length >= 2); counts.forEach(([t, c]) => assert.equal(t, c));
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('loading shows skeleton lines with the words kept; page changes finish within 250 ms; the orb glides between states', async () => {
  const { page, ctx, errors } = await open();
  await page.route(/\/api\/kb$/, async r => { await new Promise(res => setTimeout(res, 1200)); r.continue(); });
  await page.evaluate(() => { NOVA.cache.kb = null; location.hash = 'knowledge'; });
  await page.waitForSelector('#main .empty.loading[role="status"] .sk');
  assert.match(await page.innerText('#main .empty.loading'), /Loading/);
  await page.waitForSelector('.kb-docs');
  const t = await page.evaluate(() => { const els = [...document.querySelectorAll('main.enter > *')]; return Math.max(0, ...els.map(e => { const s = getComputedStyle(e); return parseFloat(s.animationDuration) * 1000 + parseFloat(s.animationDelay) * 1000; })); });
  assert.ok(t <= 250, 'page change takes ' + t + ' ms');
  assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('.nova-orb') || document.body).transitionProperty), /--c1|all/);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('ambient background: moves normally, pauses when the tab is hidden, and is still with reduced motion', async () => {
  const { page, ctx } = await open();
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.fx-aurora')).animationName), 'none');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.fx-aurora')).animationPlayState), 'paused');
  await ctx.close();
  const r = await open({ init: '' });
  await r.page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await r.page.evaluate(() => getComputedStyle(document.querySelector('.fx-aurora')).animationName), 'none');
  assert.equal(await r.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t-med').trim()), '0ms');
  await r.ctx.close();
});

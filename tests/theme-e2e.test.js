// Themes: Deep Space by default; Daylight chosen in Security and Settings, applied at once, remembered after a reload
// (before the first paint, so the page never flashes dark), keyboard-operable, and switchable back.
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
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-theme-')), 't.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'demo@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  seed(app);
  base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); app.server.closeAllConnections(); await app.close(); });

const bg = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const token = (page, n) => page.evaluate(k => getComputedStyle(document.documentElement).getPropertyValue(k).trim(), n);

test('Deep Space by default; Daylight from Security and Settings, remembered after reload, and back again', async () => {
  const { page, ctx, errors } = await H.openApp(browser, { base, hash: '' });
  await page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await page.fill('#novaDevEmail', 'demo@nova.local'); await page.click('#novaDevForm button');
  await page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  assert.equal(await page.getAttribute('html', 'data-theme'), null);
  assert.equal(await token(page, '--text'), '#e8f3ff');
  await page.evaluate(() => { location.hash = 'security'; }); await page.waitForSelector('#themePanel');
  assert.equal(await page.getAttribute('.theme-opt.t-dark', 'aria-checked'), 'true');
  await page.focus('.theme-opt.t-light'); await page.keyboard.press('Enter');          // keyboard works
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
  assert.equal(await token(page, '--text'), '#0b1a2e');
  assert.equal(await page.getAttribute('.theme-opt.t-light', 'aria-checked'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('t-light')), true, 'focus stays on the choice');
  assert.equal(await page.getAttribute('meta[name="theme-color"]', 'content'), '#f5f8fc');
  await page.reload(); await page.waitForFunction(() => window.NOVA && NOVA.user && window.J);
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light', 'remembered');
  const light = await bg(page);
  await page.evaluate(() => { location.hash = 'security'; }); await page.waitForSelector('#themePanel');
  await page.click('.theme-opt.t-dark'); await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme'));
  assert.notEqual(await bg(page), light);
  assert.equal(await page.evaluate(() => localStorage.getItem('nova.theme')), 'dark');
  assert.deepEqual(errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e)), []);
  await ctx.close();
});

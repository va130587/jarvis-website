// The GitHub Pages version has no NOVA server: it must say so plainly and point to START_HERE.md; with the server it must not appear.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers');
const { checkLayout } = require('./layout-check');
const { createApp } = require('../server');

let browser;
test.before(async () => { browser = await H.launch(); });
test.after(async () => { await browser.close(); });

for (const width of [390, 1440]) {
  test('static site (no NOVA server) at ' + width + ' px: the Classic-tools note shows, links to START_HERE.md, and nothing overflows', async () => {
    const { page, ctx, errors } = await H.openApp(browser, { hash: 'today', width, height: 900 });
    await page.waitForFunction(() => window.NOVA && NOVA.mode === 'standalone');
    await page.waitForSelector('#staticBanner:not([hidden])');
    assert.match(await page.innerText('#staticBanner'), /You are seeing the Classic tools only[\s\S]*npm run demo/);
    assert.match(await page.getAttribute('#staticBanner a', 'href'), /START_HERE\.md$/);
    assert.deepEqual(await page.evaluate(checkLayout), []);
    assert.deepEqual(errors.filter(e => !/Failed to load resource|ERR_|preload assets|404/.test(e)), []);
    await ctx.close();
  });
}

test('with the NOVA server the note stays hidden', async () => {
  const app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-sb-')), 's.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0' });
  const base = 'http://127.0.0.1:' + await app.listen();
  const { page, ctx } = await H.openApp(browser, { base, hash: '' });
  await page.waitForFunction(() => window.NOVA && NOVA.mode === 'server'); await page.waitForTimeout(300);
  assert.equal(await page.locator('#staticBanner:not([hidden])').count(), 0);
  await ctx.close(); app.server.closeAllConnections(); await app.close();
});

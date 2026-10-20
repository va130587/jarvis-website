// Error states on Dashboard, Chat, Smart Email, Knowledge Base, Life Tracker and Automation: a server error (500),
// too many requests (429), no network, an expired session (401) and a slow server (3 s). Each page must say what happened
// and what to do, offer "Try again", recover by itself when the network returns, and never show a blank or stuck page.
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
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-err-')), 'e.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'demo@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  seed(app); app.email.loadDemo(1);
  base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); app.server.closeAllConnections(); await app.close(); });

async function open() {
  const o = await H.openApp(browser, { base, hash: '' });
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'demo@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  return o;
}
// page -> the API its first load needs, the cache key to forget (so the page really loads again) and a sign that it loaded
const PAGES = {
  dashboard: { api: /\/api\/memories(\?|$)/, cache: 'memories', ready: '.mini-list, .stats' },        // the parts that did load stay visible
  email: { api: /\/api\/email\?filter=/, cache: 'email', ready: '.mail-filters, .conn' },
  knowledge: { api: /\/api\/kb$/, cache: 'kb', ready: '.kb-docs, .kb-side .empty' },
  life: { api: /\/api\/life$/, cache: 'life', ready: '.life-grid' },
  automation: { api: /\/api\/schedules$/, cache: 'schedules', ready: '.sched' }
};
const goFresh = (page, hash, cache) => page.evaluate(([h, k]) => { NOVA.cache[k] = null; if (k === 'memories') { NOVA.cache.usage = NOVA.cache.activity = null; } location.hash = 'chat'; setTimeout(() => { location.hash = h; }, 50); }, [hash, cache]);

for (const [hash, p] of Object.entries(PAGES)) {
  test(hash + ': 500 and 429 show a clear message with "Try again", and Try again recovers', async () => {
    const { page, ctx, errors } = await open();
    await page.waitForFunction(() => NOVA.pending() === 0);          // the first page load has finished
    let mode = 500;
    await page.route(p.api, r => mode ? r.fulfill({ status: mode, contentType: 'application/json', headers: mode === 429 ? { 'Retry-After': '12' } : {}, body: JSON.stringify({ error: { code: mode === 429 ? 'rate_limited' : 'server_error', message: '' } }) }) : r.continue());
    await goFresh(page, hash, p.cache);
    {
      await page.waitForSelector('.load-error[role="alert"]');
      assert.match(await page.innerText('.load-error'), /This page could not load[\s\S]*Something went wrong on the server\. Nothing was changed\. Try again in a moment\./);
      mode = 429; await page.click('.load-error button[data-act="novaRetry"]');
      await page.waitForSelector('.load-error:has-text("Too many requests")'); assert.match(await page.innerText('.load-error'), /Wait 12 seconds, then try again/);
      mode = 0; await page.click('.load-error button[data-act="novaRetry"]');
      await page.waitForSelector(p.ready); assert.equal(await page.locator('.load-error').count(), 0);
    }
    assert.deepEqual(errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e)), []);
    await ctx.close();
  });
}

test('offline: pages say there is no connection, typing in Chat keeps your message, and everything reloads when the network is back', async () => {
  const { page, ctx } = await open();
  await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg');
  await ctx.setOffline(true);
  await page.fill('#novaMsg', 'what time is it'); await page.click('#novaChatForm button');
  await page.waitForSelector('.msg.bot:last-child .text:has-text("You are offline")');
  assert.match(await page.innerText('.msg.bot:last-child .text'), /Your message is back in the box below/);
  assert.equal(await page.inputValue('#novaMsg'), 'what time is it', 'the message is not lost');
  for (const [hash, p] of Object.entries(PAGES).filter(([h]) => h !== 'dashboard')) {
    await goFresh(page, hash, p.cache);
    await page.waitForSelector('.load-error:has-text("No connection")');
    assert.match(await page.innerText('.load-error'), /You are offline\. NOVA will reload this when your connection is back\./);
  }
  await ctx.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForSelector('.toast:has-text("Back online")'); await page.waitForSelector(PAGES.automation.ready);
  assert.equal(await page.locator('.load-error').count(), 0);
  await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg');
  await page.click('#novaChatForm button'); await page.waitForSelector('.msg.bot:last-child .text:has-text("Dubai")');
  await ctx.close();
});

test('session expired (401): the sign-in screen explains it; after signing in again the page works', async () => {
  const { page, ctx } = await open();
  await page.route(/\/api\/life$/, r => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unauthenticated', message: 'Please sign in.' } }) }));
  await goFresh(page, 'life', 'life');
  await page.waitForSelector('#novaLogin:has-text("Your session ended. Please sign in again.")');
  await page.unroute(/\/api\/life$/);
  await page.fill('#novaDevEmail', 'demo@nova.local'); await page.click('#novaDevForm button');
  await page.waitForFunction(() => window.NOVA && NOVA.user && window.J);
  await page.evaluate(() => { location.hash = 'life'; }); await page.waitForSelector('.life-grid');
  await ctx.close();
});

test('slow server (3 s): a loading state first, then the page, with no error and no double request', async () => {
  const { page, ctx, errors } = await open();
  let calls = 0;
  await page.route(/\/api\/kb$/, async r => { calls++; await new Promise(res => setTimeout(res, 3000)); r.continue(); });
  await goFresh(page, 'knowledge', 'kb');
  await page.waitForSelector('#main .empty:has-text("Loading")');
  const t0 = Date.now(); await page.waitForSelector('.kb-docs', { timeout: 10000 });
  assert.ok(Date.now() - t0 >= 1500, 'it really waited for the slow answer');
  assert.equal(await page.locator('.load-error').count(), 0); assert.equal(calls, 1, 'no repeated requests while waiting');
  assert.deepEqual(errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e)), []);
  await ctx.close();
});

test('chat: a server error is shown in the conversation and the message is kept for sending again', async () => {
  const { page, ctx } = await open();
  await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg');
  await page.route(/\/api\/chat$/, r => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await page.fill('#novaMsg', 'brief me'); await page.click('#novaChatForm button');
  await page.waitForSelector('.msg.bot:last-child .text:has-text("Something went wrong on the server")');
  assert.equal(await page.inputValue('#novaMsg'), 'brief me');
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-nova')), 'error');
  await page.unroute(/\/api\/chat$/); await page.click('#novaChatForm button');
  await page.waitForSelector('.msg.bot:last-child .text:has-text("Good")');
  await ctx.close();
});

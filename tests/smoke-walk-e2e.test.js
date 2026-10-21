// SMOKE WALK: every NOVA page at 390 / 768 / 1024 / 1440 px in the Deep Space theme, and at 390 / 1440 px in Daylight, on the demo data. On each page the main interaction is used
// (a dialog opened, a preview shown, a search run...), then the page must have: no console errors, no failed requests,
// no layout problems (tests/layout-check.js) and no serious or critical accessibility issues (axe-core, WCAG 2.1 AA).
// Destructive actions are only opened to their preview and then rejected or cancelled.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers');
const { checkLayout } = require('./layout-check');
const { createApp } = require('../server');
const { seed } = require('../scripts/demo');

let browser, app, base;
const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
test.before(async () => {
  browser = await H.launch();
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-walk-')), 'w.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'demo@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  seed(app); app.email.loadDemo(1);
  base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); app.server.closeAllConnections(); await app.close(); });

// Noise that is not the app: axe-core reading cross-origin stylesheets, and third-party hosts the test browser blocks on purpose.
const ignoreConsole = e => /Couldn't load preload assets|Failed to load resource|net::ERR/.test(e);
const ignoreUrl = u => /fonts\.(googleapis|gstatic)\.com|boards-api|api\.lever|api\.ashby|open-meteo|accounts\.google\.com/.test(u);

// The main interaction on each page. Each must leave the page in a normal state.
const STEPS = {
  dashboard: async p => { await p.click('#novaBell'); await p.waitForSelector('#novaNotifs:not([hidden])'); await p.keyboard.press('Escape'); },
  briefing: async p => { await p.click('button[data-act="dRefreshBrief"]'); await p.waitForSelector('.brief-sec'); },
  chat: async p => { const n = await p.$$eval('.msg.bot', e => e.length); await p.fill('#novaMsg', 'what time is it'); await p.click('#novaChatForm button'); await p.waitForFunction(k => document.querySelectorAll('.msg.bot').length > k, n); },
  voice: async p => { await p.click('button[data-act="vTest"]'); },
  email: async p => { await p.locator('.mail-btn').first().click(); await p.waitForSelector('.mail-detail h2'); },
  hub: async p => { await p.locator('button[data-act="novaTaskDone"]').first().click(); await p.waitForSelector('#hubPreview .preview'); await p.click('#hubPreview button[data-act="novaRejectRun"]'); await p.waitForFunction(() => !document.querySelector('#hubPreview .preview')); },
  focus: async p => { await p.waitForSelector('.timeline-plan .blk, .plan .empty'); },
  life: async p => { await p.fill('#lifeQ', 'how much did I spend this month'); await p.press('#lifeQ', 'Enter'); await p.waitForSelector('.cap-reply'); },
  proofloop: async p => { await p.locator('button[data-act="plOpen"]').first().click(); await p.waitForSelector('#formDialog[open]'); await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('#formDialog[open]')); },
  insights: async p => { await p.waitForSelector('.chart'); await p.focus('#chDone .bm'); await p.waitForSelector('#chDone .tip:not([hidden])'); },
  replay: async p => { await p.waitForSelector('#rpTime'); await p.focus('#rpTime'); await p.keyboard.press('Home'); await p.waitForSelector('#rpReadout'); },
  automation: async p => { await p.waitForSelector('.sched'); },
  identity: async p => { await p.waitForSelector('main h1'); },
  memory: async p => { await p.waitForSelector('main h1'); },
  knowledge: async p => { await p.fill('#kbQ', 'when should I renew my visa'); await p.press('#kbQ', 'Enter'); await p.waitForSelector('.kb-answer'); },
  usage: async p => { await p.waitForSelector('main h1'); },
  connections: async p => { await p.waitForFunction(() => !/Checking…/.test(document.querySelector('main').textContent)); },
  support: async p => { await p.click('button[data-act="hpCheck"]'); await p.waitForSelector('.hp-checks li'); },
  security: async p => { await p.waitForSelector('#installPanel'); await p.keyboard.press('Control+k'); await p.waitForSelector('#novaPalette:not([hidden])'); await p.keyboard.type('visa'); await p.waitForTimeout(400); await p.keyboard.press('Escape'); }
};

for (const [width, theme] of [[390, 'dark'], [768, 'dark'], [1024, 'dark'], [1440, 'dark'], [390, 'light'], [1440, 'light']]) {
  test('smoke walk at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ' theme: all 19 pages are clean after their main interaction', async () => {
    const init = theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined;
    const { page, ctx, errors } = await H.openApp(browser, { base, hash: '', width, height: width === 390 ? 844 : 900, init });
    const failed = [];
    page.on('requestfailed', r => { if (!ignoreUrl(r.url())) failed.push('failed ' + r.url()); });
    page.on('response', r => { if (r.status() >= 400 && !ignoreUrl(r.url())) failed.push(r.status() + ' ' + r.url()); });
    await page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
    await page.fill('#novaDevEmail', 'demo@nova.local'); await page.click('#novaDevForm button');
    await page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'dark'), theme);
    await page.evaluate(src => (0, eval)(src), AXE);
    const problems = [];
    for (const [hash, step] of Object.entries(STEPS)) {
      errors.length = 0; failed.length = 0;
      await page.evaluate(h => { location.hash = h; }, hash); await page.waitForFunction(h => J.current() === h, hash);
      await page.waitForFunction(() => !/^\s*(Loading|Planning)…/.test((document.querySelector('#main .empty') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => problems.push(hash + ': still loading after 8 s'));
      try { await step(page); } catch (e) { problems.push(hash + ': interaction failed: ' + e.message.split('\n')[0]); }
      await page.waitForTimeout(250);
      (await page.evaluate(checkLayout)).forEach(x => problems.push(hash + ' layout: ' + x));
      const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
      ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').forEach(v => problems.push(hash + ' axe ' + v.id + ': ' + v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')));
      errors.filter(e => !ignoreConsole(e)).forEach(e => problems.push(hash + ' console: ' + e));
      failed.forEach(f => problems.push(hash + ' request: ' + f));
    }
    assert.deepEqual(problems, [], problems.join('\n'));
    await ctx.close();
  });
}

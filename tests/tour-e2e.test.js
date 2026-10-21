// First-run tour in the browser: shown once per account, six steps, Next/Back/Skip, keyboard only, Escape, focus returns,
// remembered in the database, can be shown again, never covers what it explains, clean at four widths in both themes.
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
let browser, app, base, n = 0;
test.before(async () => {
  browser = await H.launch();
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-tour-')), 't.db'), AUTH_MODE: 'dev', OWNER_EMAILS: Array.from({ length: 40 }, (_, i) => 'u' + i + '@nova.local').join(','), NOVA_TOUR: 'on', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); app.server.closeAllConnections(); await app.close(); });

// every test uses its own new account, because the tour is shown once per account
async function open(opts, email) {
  const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {}));
  o.email = email || ('u' + (n++) + '@nova.local');
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', o.email); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const done = email => app.db.prepare('SELECT tour_done_at FROM users WHERE email = ?').get(email).tour_done_at;
const text = p => p.evaluate(() => ({ count: document.querySelector('#tourCount').textContent, title: document.querySelector('#tourTitle').textContent }));

test('a new account sees the tour once: six steps with Next and Back; Finish remembers it in the database', async () => {
  const { page, ctx, errors, email } = await open();
  await page.waitForSelector('dialog#novaTour[open]');
  assert.equal(await page.getAttribute('#novaTour', 'role'), 'dialog'); assert.equal(await page.getAttribute('#novaTour', 'aria-modal'), 'true'); assert.equal(await page.getAttribute('.tour-body', 'aria-live'), 'polite');
  assert.equal(await page.getAttribute('#novaTour', 'aria-labelledby'), 'tourTitle');
  const titles = [];
  for (let i = 0; i < 6; i++) { const t = await text(page); assert.equal(t.count, 'Step ' + (i + 1) + ' of 6'); titles.push(t.title); if (i < 5) await page.click('[data-tour="next"]'); }
  assert.deepEqual(titles, ['The orb', 'The menu', 'Chat and approvals', 'Promise Orbit', 'Search with Ctrl+K', 'Settings and themes']);
  assert.equal(await page.innerText('[data-tour="next"]'), 'Finish'); await page.click('[data-tour="back"]'); assert.equal((await text(page)).title, 'Search with Ctrl+K');
  assert.equal(await page.innerText('[data-tour="next"]'), 'Next'); await page.click('[data-tour="next"]'); await page.click('[data-tour="next"]');
  await page.waitForFunction(() => !document.querySelector('dialog#novaTour[open]'));
  await page.waitForFunction(e => true, 0); await page.waitForTimeout(300); assert.ok(done(email) > 0, 'remembered in the database');
  await page.reload(); await page.waitForFunction(() => window.NOVA && NOVA.user && J.current() === 'dashboard'); await page.waitForTimeout(1200);
  assert.equal(await page.locator('dialog#novaTour[open]').count(), 0, 'not shown again after a reload');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('Skip ends it for good, and a second account on the same server still sees it', async () => {
  const a = await open(); await a.page.waitForSelector('dialog#novaTour[open]'); await a.page.click('[data-tour="skip"]');
  await a.page.waitForFunction(() => !document.querySelector('dialog#novaTour[open]')); await a.page.waitForTimeout(300); assert.ok(done(a.email) > 0);
  const b = await open(); await b.page.waitForSelector('dialog#novaTour[open]'); assert.equal(done(b.email), null, 'not remembered until it is finished or skipped');
  await a.ctx.close(); await b.ctx.close();
});

test('keyboard only: focus goes into the tour and stays there, Enter moves on, Escape skips, focus returns to the page', async () => {
  const { page, ctx, email } = await open();
  await page.waitForSelector('dialog#novaTour[open]');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-tour')), 'next', 'focus starts on Next');
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => !!document.activeElement.closest('#novaTour')), 'Tab ' + i + ' stays inside the tour'); }
  await page.focus('[data-tour="next"]'); await page.keyboard.press('Enter'); assert.equal((await text(page)).title, 'The menu');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog#novaTour[open]'));
  await page.waitForTimeout(300); assert.ok(done(email) > 0, 'Escape counts as skipping');
  assert.ok(await page.evaluate(() => document.activeElement && document.activeElement !== document.body), 'focus is back on the page, not lost');
  await ctx.close();
});

test('"Show the tour again" in Security and Settings starts it; it never covers the thing it explains', async () => {
  const { page, ctx, email } = await open({ width: 1440, height: 900 });
  await page.waitForSelector('dialog#novaTour[open]'); await page.click('[data-tour="skip"]'); await page.waitForFunction(() => !document.querySelector('dialog#novaTour[open]'));
  await page.evaluate(() => { location.hash = 'security'; }); await page.waitForSelector('#tourPanel button[data-act="tourStart"]');
  await page.click('#tourPanel button[data-act="tourStart"]'); await page.waitForSelector('dialog#novaTour[open]');
  assert.equal(await page.evaluate(() => J.current()), 'dashboard'); assert.equal((await text(page)).count, 'Step 1 of 6');
  for (let i = 0; i < 6; i++) {
    const r = await page.evaluate(() => { const g = e => e && e.getBoundingClientRect(), a = g(document.querySelector('.tour-ring')), c = g(document.querySelector('.tour-card')), vis = getComputedStyle(document.querySelector('.tour-ring')).display !== 'none';
      return { vis, hit: vis && !(a.right <= c.left || a.left >= c.right || a.bottom <= c.top || a.top >= c.bottom) }; });
    assert.equal(r.hit, false, 'step ' + (i + 1) + ': the card does not cover what it points at');
    if (i < 5) await page.click('[data-tour="next"]');
  }
  await ctx.close();
});

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1024, 1440]) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': the tour on its first and last step', async () => {
    const { page, ctx, errors } = await open({ width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await page.waitForSelector('dialog#novaTour[open]');
    for (const step of [0, 5]) {
      if (step) for (let i = 0; i < 5; i++) await page.click('[data-tour="next"]');
      await page.waitForTimeout(250);
      const box = await page.evaluate(() => { const r = document.querySelector('.tour-card').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight }; });
      assert.ok(box.l >= 0 && box.r <= box.w && box.t >= 0 && box.b <= box.h, 'card is fully on screen: ' + JSON.stringify(box));
      await page.evaluate(src => { if (!window.axe) (0, eval)(src); }, AXE);
      const ax = await page.evaluate(() => axe.run(document.querySelector('#novaTour'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }));
      const bad = ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | '));
      assert.deepEqual(bad, [], 'step ' + (step + 1) + ' ' + bad.join('\n'));
    }
    await page.click('[data-tour="next"]'); await page.waitForFunction(() => !document.querySelector('dialog#novaTour[open]'));
    assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

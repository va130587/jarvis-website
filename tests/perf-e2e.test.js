// Performance budget, measured in the browser: first content under 1 second, no layout shift, no task over 100 ms while
// opening and switching pages (also with 200 tasks), and animation frames that cost well under 16.7 ms (60 fps).
// The browser runs without its frame-rate cap: a capped headless browser reports 30 fps as soon as two animations run, which
// measures its own frame scheduling, not NOVA's work. Uncapped, the time between frames is the real cost of a frame.
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
  let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/node-tools/node_modules/playwright'); }
  const opts = { args: ['--disable-frame-rate-limit', '--disable-gpu-vsync'] };
  if (fs.existsSync('/opt/pw-browsers/chromium') && !process.env.PLAYWRIGHT_BROWSERS_PATH) opts.executablePath = '/opt/pw-browsers/chromium';
  browser = await pw.chromium.launch(opts);
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-perf-')), 'p.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'demo@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  seed(app); app.email.loadDemo(1);
  const now = Date.now(); app.db.exec('BEGIN');
  for (let i = 0; i < 200; i++) app.db.prepare("INSERT INTO tasks (user_id, title, due, status, created_at) VALUES (1, ?, NULL, 'open', ?)").run('Perf task ' + i + ' with a reasonably long title', now);
  app.db.exec('COMMIT');
  base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); app.server.closeAllConnections(); await app.close(); });

// Collects paint, layout-shift and long-task entries from the very start of the page.
const OBSERVE = `window.__perf = { shifts: 0, long: [] };
  try { new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) window.__perf.shifts += e.value; })).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__perf.long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) {}`;

for (const width of [390, 1440]) {
  test('performance at ' + width + ' px: first content under 1 s, no layout shift, no long task, smooth frames', async t => {
    const { page, ctx } = await H.openApp(browser, { base, hash: '', width, height: width === 390 ? 844 : 900, init: OBSERVE });
    await page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
    const fcp = await page.evaluate(() => (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime);
    assert.ok(fcp > 0 && fcp < 1000, 'first content after ' + fcp + ' ms');
    await page.fill('#novaDevEmail', 'demo@nova.local'); await page.click('#novaDevForm button');
    await page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
    await page.waitForFunction(() => NOVA.pending() === 0); await page.waitForTimeout(500);
    await page.evaluate(() => { window.__perf.long.length = 0; });
    for (const h of ['hub', 'email', 'knowledge', 'life', 'insights', 'focus', 'briefing', 'dashboard']) {
      await page.evaluate(v => { location.hash = v; }, h);
      await page.waitForFunction(v => J.current() === v && NOVA.pending() === 0, h); await page.waitForTimeout(250);
    }
    const p = await page.evaluate(() => window.__perf);
    assert.ok(p.shifts < 0.1, 'cumulative layout shift ' + p.shifts.toFixed(3) + ' (good is under 0.1)');
    assert.deepEqual(p.long.filter(d => d > 100), [], 'tasks over 100 ms while switching pages');
    // frames while the page animates (ambient light, orb, page change)
    const gaps = await page.evaluate(() => new Promise(res => { const t = []; let last = 0; location.hash = 'chat'; requestAnimationFrame(function f(ts) { if (last) t.push(ts - last); last = ts; if (t.length < 90) requestAnimationFrame(f); else res(t); }); }));
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)], p95 = gaps[Math.floor(gaps.length * 0.95)];
    assert.ok(median <= 8, 'a typical frame costs ' + median.toFixed(1) + ' ms (60 fps allows 16.7)');
    assert.ok(p95 <= 16.7, '95% of frames cost at most ' + p95.toFixed(1) + ' ms');
    t.diagnostic('first content ' + Math.round(fcp) + ' ms; layout shift ' + p.shifts.toFixed(3) + '; longest task ' + Math.max(0, ...p.long) + ' ms; frame cost median ' + median.toFixed(1) + ' ms, p95 ' + p95.toFixed(1) + ' ms');
    await ctx.close();
  });
}

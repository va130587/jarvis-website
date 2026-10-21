// Captures every NOVA page at several widths on fresh demo data and reports problems found on each:
// console errors, failed requests, layout problems (tests/layout-check.js) and serious axe issues.
//   node scripts/snapshot-pages.js <out-dir> [--theme light]
// Needs the test tools (npm install). Writes <out-dir>/<width>-<page>.jpg and <out-dir>/report.json.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('../tests/helpers');
const { checkLayout } = require('../tests/layout-check');
const { createApp } = require('../server');
const { seed } = require('./demo');

const PAGES = ['dashboard', 'briefing', 'chat', 'voice', 'email', 'hub', 'focus', 'life', 'proofloop', 'insights', 'replay', 'automation', 'identity', 'memory', 'knowledge', 'usage', 'connections', 'security'];
const WIDTHS = [390, 768, 1024, 1440];

(async () => {
  const out = path.resolve(process.argv[2] || 'docs/screenshots/after'), theme = process.argv.includes('--theme') ? process.argv[process.argv.indexOf('--theme') + 1] : null;
  const shotWidths = process.argv.includes('--all-widths') ? WIDTHS : [390, 768, 1440];
  fs.mkdirSync(out, { recursive: true });
  const app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-snap-')), 's.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'demo@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  seed(app); app.email.loadDemo(1);
  const base = 'http://127.0.0.1:' + await app.listen();
  const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
  const browser = await H.launch(), report = {};
  for (const width of WIDTHS) {
    const { page, ctx, errors } = await H.openApp(browser, { base, hash: '', width, height: width === 390 ? 844 : 900, init: theme ? 'try { localStorage.setItem("nova.theme", "' + theme + '"); } catch (e) {}' : undefined });
    const failed = []; page.on('requestfailed', r => failed.push(r.url())); page.on('response', r => { if (r.status() >= 400 && !/\/api\/session/.test(r.url())) failed.push(r.status() + ' ' + r.url()); });
    await page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
    await page.fill('#novaDevEmail', 'demo@nova.local'); await page.click('#novaDevForm button');
    await page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
    await page.evaluate(src => (0, eval)(src), AXE);
    for (const p of PAGES) {
      errors.length = 0; failed.length = 0;
      await page.evaluate(h => { location.hash = h; }, p); await page.waitForTimeout(1300);
      const layout = await page.evaluate(checkLayout);
      const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
      const serious = ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | '));
      const cons = errors.filter(e => !/Failed to load resource|ERR_|fonts\.googleapis/.test(e));
      const key = width + '-' + p; report[key] = { layout, axe: serious, console: cons, failedRequests: failed.filter(u => !/fonts\.(googleapis|gstatic)|boards-api|lever|ashby|open-meteo/.test(u)) };
      if (shotWidths.includes(width)) await page.screenshot({ path: path.join(out, key + '.jpg'), type: 'jpeg', quality: 62, fullPage: true });
      const bad = Object.values(report[key]).reduce((a, x) => a + x.length, 0);
      console.log((bad ? 'PROBLEMS ' : 'ok       ') + key + (bad ? ' ' + JSON.stringify(report[key]) : ''));
    }
    await ctx.close();
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); app.server.closeAllConnections(); await app.close();
})().catch(e => { console.error(e); process.exit(1); });

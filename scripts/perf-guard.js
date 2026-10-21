// Speed and size guard: fails (exit 1) when NOVA gets slower or heavier without anyone noticing.
//   node scripts/perf-guard.js                   run all checks (what CI runs)
//   node scripts/perf-guard.js --update-budget   measure the first page now and save it as the new size baseline (do this on purpose, in its own commit)
// Checks, each with a plain message:
//   1. first content under 1 second          2. layout shift at most 0.1          3. no task blocking the page for more than 100 ms
//   4. the first page (everything the browser downloads before sign-in) at most 15% bigger than the saved baseline
//   5. no file over 200 KB added outside docs/ and fonts/ (the few older ones are listed in scripts/perf-budget.json)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..'), BUDGET = path.join(__dirname, 'perf-budget.json');
const LIMITS = { firstContentMs: 1000, layoutShift: 0.1, longTaskMs: 100, sizeGrowth: 1.15, bigFileBytes: 200 * 1024, allowedDirs: ['docs/', 'fonts/'] };

// ---- the checks (pure, so they can be tested without a browser) ----
function checkFiles(files, allowed) {
  const ok = new Set(allowed || []), bad = [];
  for (const f of files) if (f.size > LIMITS.bigFileBytes && !LIMITS.allowedDirs.some(d => f.path.startsWith(d)) && !ok.has(f.path))
    bad.push('The file ' + f.path + ' is ' + Math.round(f.size / 1024) + ' KB. Files over 200 KB are not allowed outside docs/ and fonts/, because everyone has to download them. Make it smaller, or put it in docs/.');
  return bad;
}
function checkSize(bytes, baseline) {
  if (!baseline) return ['There is no saved size baseline. Run: node scripts/perf-guard.js --update-budget'];
  const limit = Math.ceil(baseline * LIMITS.sizeGrowth);
  return bytes > limit ? ['The first page is now ' + Math.round(bytes / 1024) + ' KB, which is more than 15% above the saved ' + Math.round(baseline / 1024) + ' KB (the limit is ' + Math.round(limit / 1024) + ' KB). Find out what grew (check that gzip still works), or update the baseline on purpose.'] : [];
}
function checkTiming(m) {
  const bad = [];
  if (!(m.firstContentMs > 0 && m.firstContentMs < LIMITS.firstContentMs)) bad.push('First content took ' + Math.round(m.firstContentMs) + ' ms at ' + m.width + ' px. It must be under ' + LIMITS.firstContentMs + ' ms.');
  if (m.layoutShift > LIMITS.layoutShift) bad.push('The page jumped around while loading at ' + m.width + ' px (layout shift ' + m.layoutShift.toFixed(3) + '). It must be at most ' + LIMITS.layoutShift + '.');
  const slow = (m.longTasks || []).filter(d => d > LIMITS.longTaskMs);
  if (slow.length) bad.push('The page was blocked for ' + Math.max.apply(null, slow) + ' ms at ' + m.width + ' px. No task may take longer than ' + LIMITS.longTaskMs + ' ms.');
  return bad;
}

function trackedFiles(root) {
  root = root || ROOT;
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString().split('\0').filter(Boolean);
  return out.filter(f => fs.existsSync(path.join(root, f))).map(f => ({ path: f, size: fs.statSync(path.join(root, f)).size }));
}
const loadBudget = () => { try { return JSON.parse(fs.readFileSync(BUDGET, 'utf8')); } catch (e) { return {}; } };

// ---- measuring (a real browser against a real NOVA server, nothing mocked) ----
const OBSERVE = `window.__perf = { shifts: 0, long: [] };
  try { new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) window.__perf.shifts += e.value; })).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__perf.long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) {}`;
async function measure() {
  let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/node-tools/node_modules/playwright'); }
  const { createApp } = require('../server');
  const opts = {}; if (fs.existsSync('/opt/pw-browsers/chromium') && !process.env.PLAYWRIGHT_BROWSERS_PATH) opts.executablePath = '/opt/pw-browsers/chromium';
  const browser = await pw.chromium.launch(opts);
  const app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-guard-')), 'g.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'demo@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_TOUR: 'off', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000' });
  require('./demo').seed(app); const base = 'http://127.0.0.1:' + await app.listen(), results = [];
  try {
    for (const width of [390, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, serviceWorkers: 'block' }); await ctx.addInitScript(OBSERVE);
      const page = await ctx.newPage(); await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await page.goto(base + '/'); await page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown'); await page.waitForTimeout(500);
      const first = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] || {}, res = performance.getEntriesByType('resource');
        return { fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime, bytes: (nav.encodedBodySize || 0) + res.reduce((a, r) => a + (r.encodedBodySize || 0), 0), files: res.length + 1 };
      });
      await page.fill('#novaDevEmail', 'demo@nova.local'); await page.click('#novaDevForm button'); await page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
      for (const v of ['chat', 'insights', 'replay', 'dashboard']) { await page.evaluate(x => { location.hash = x; }, v); await page.waitForTimeout(450); }
      const p = await page.evaluate(() => window.__perf);
      results.push({ width, firstContentMs: first.fcp, layoutShift: p.shifts, longTasks: p.long, bytes: first.bytes, files: first.files }); await ctx.close();
    }
  } finally { await browser.close(); app.server.closeAllConnections(); await app.close(); }
  return results;
}

async function main() {
  const update = process.argv.includes('--update-budget'), budget = loadBudget(), problems = [];
  const files = trackedFiles(), big = files.filter(f => f.size > LIMITS.bigFileBytes && !LIMITS.allowedDirs.some(d => f.path.startsWith(d))).map(f => f.path);
  if (update) { budget.allowLargeFiles = big.sort(); }
  problems.push(...checkFiles(files, budget.allowLargeFiles));
  const runs = await measure(), bytes = Math.max.apply(null, runs.map(r => r.bytes));
  for (const r of runs) { console.log('  ' + r.width + ' px: first content ' + Math.round(r.firstContentMs) + ' ms, layout shift ' + r.layoutShift.toFixed(3) + ', longest task ' + (r.longTasks.length ? Math.max.apply(null, r.longTasks) : 0) + ' ms, first page ' + Math.round(r.bytes / 1024) + ' KB in ' + r.files + ' files'); problems.push(...checkTiming(r)); }
  if (update) { budget.firstPageBytes = bytes; budget.measuredOn = new Date().toISOString().slice(0, 10); budget.note = 'The first page is everything the browser downloads before sign-in, as sent (gzip). The guard fails if it grows more than 15% above this.'; fs.writeFileSync(BUDGET, JSON.stringify(budget, null, 2) + '\n'); console.log('  Saved the baseline: ' + Math.round(bytes / 1024) + ' KB (limit ' + Math.round(bytes * LIMITS.sizeGrowth / 1024) + ' KB).'); }
  else problems.push(...checkSize(bytes, budget.firstPageBytes));
  if (problems.length) { console.error('\nSpeed and size guard FAILED:\n' + problems.map(p => '  - ' + p).join('\n') + '\n'); process.exit(1); }
  console.log('Speed and size guard passed (first page ' + Math.round(bytes / 1024) + ' KB' + (budget.firstPageBytes ? ' of a ' + Math.round(budget.firstPageBytes * LIMITS.sizeGrowth / 1024) + ' KB limit' : '') + ').');
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { checkFiles, checkSize, checkTiming, trackedFiles, measure, loadBudget, LIMITS };

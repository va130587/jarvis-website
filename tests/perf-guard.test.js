// The speed and size guard: each rule fails when it should and passes when it should, a big file added on purpose is caught, the saved
// baseline is real, and gzip keeps the first page inside its size limit (without gzip it would not be).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const G = require('../scripts/perf-guard');

const ROOT = path.join(__dirname, '..');

test('files: over 200 KB is refused outside docs/ and fonts/, with a message that names the file', () => {
  const KB = 1024;
  const bad = G.checkFiles([{ path: 'big.bin', size: 300 * KB }, { path: 'src/new-library.js', size: 201 * KB }]); assert.equal(bad.length, 2);
  assert.match(bad[0], /big\.bin is 300 KB.*not allowed outside docs\/ and fonts\//); assert.match(bad[1], /new-library\.js is 201 KB/);
  assert.deepEqual(G.checkFiles([{ path: 'a.js', size: 200 * KB }, { path: 'docs/screenshots/x.png', size: 900 * KB }, { path: 'fonts/f.woff2', size: 500 * KB }, { path: 'vendor/old.js', size: 332 * KB }], ['vendor/old.js']), []);
  assert.equal(G.checkFiles([{ path: 'vendor/old.js', size: 332 * KB }]).length, 1, 'an older big file is only allowed when it is listed');
});

test('a big file added on purpose to a repository makes the guard fail, and removing it makes it pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-guard-test-')), git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, stdio: 'pipe' });
  git('init', '-q'); fs.writeFileSync(path.join(dir, 'small.js'), 'x'); fs.mkdirSync(path.join(dir, 'docs')); fs.writeFileSync(path.join(dir, 'docs', 'big.png'), Buffer.alloc(400 * 1024)); git('add', '-A'); git('commit', '-q', '-m', 'first');
  assert.deepEqual(G.checkFiles(G.trackedFiles(dir), []), [], 'a big file in docs/ is fine');
  fs.writeFileSync(path.join(dir, 'huge-library.js'), Buffer.alloc(300 * 1024)); git('add', '-A'); git('commit', '-q', '-m', 'oops');
  const bad = G.checkFiles(G.trackedFiles(dir), []); assert.equal(bad.length, 1); assert.match(bad[0], /huge-library\.js is 300 KB/);
  git('rm', '-q', 'huge-library.js'); git('commit', '-q', '-m', 'removed'); assert.deepEqual(G.checkFiles(G.trackedFiles(dir), []), []); fs.rmSync(dir, { recursive: true, force: true });
});

test('this repository has no file over 200 KB outside docs/ and fonts/ other than the listed older ones', () => {
  const b = G.loadBudget(); assert.deepEqual(G.checkFiles(G.trackedFiles(), b.allowLargeFiles), []); assert.deepEqual(b.allowLargeFiles, ['vendor/msal-browser-4.30.0.min.js']);
});

test('size: 15% above the saved baseline fails, up to it passes, no baseline says what to do', () => {
  assert.deepEqual(G.checkSize(115000, 100000), []); assert.deepEqual(G.checkSize(50000, 100000), []);
  const bad = G.checkSize(115001, 100000); assert.equal(bad.length, 1); assert.match(bad[0], /more than 15% above the saved/); assert.match(bad[0], /gzip still works/);
  assert.match(G.checkSize(1, undefined)[0], /--update-budget/);
});

test('timing: slow first content, layout shift and a long task each fail on their own', () => {
  const ok = { width: 390, firstContentMs: 400, layoutShift: 0, longTasks: [60, 99, 100] };
  assert.deepEqual(G.checkTiming(ok), []);
  assert.match(G.checkTiming(Object.assign({}, ok, { firstContentMs: 1000 }))[0], /First content took 1000 ms at 390 px/); assert.equal(G.checkTiming(Object.assign({}, ok, { firstContentMs: 999 })).length, 0);
  assert.match(G.checkTiming(Object.assign({}, ok, { firstContentMs: NaN }))[0], /First content/); assert.match(G.checkTiming(Object.assign({}, ok, { firstContentMs: undefined }))[0], /First content/);
  assert.match(G.checkTiming(Object.assign({}, ok, { layoutShift: 0.101 }))[0], /jumped around.*0\.101/); assert.deepEqual(G.checkTiming(Object.assign({}, ok, { layoutShift: 0.1 })), []);
  assert.match(G.checkTiming(Object.assign({}, ok, { longTasks: [30, 101, 250] }))[0], /blocked for 250 ms/); assert.equal(G.checkTiming({ width: 1, firstContentMs: 5000, layoutShift: 1, longTasks: [500] }).length, 3);
});

test('the saved baseline is real, and gzip is what keeps the first page inside the limit', () => {
  const b = G.loadBudget(); assert.ok(b.firstPageBytes > 100 * 1024 && b.firstPageBytes < 3 * 1024 * 1024, 'baseline ' + b.firstPageBytes); assert.match(b.measuredOn, /^\d{4}-\d{2}-\d{2}$/);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), assets = [...html.matchAll(/(?:src|href)="([a-z0-9-]+\.(?:js|css))"/g)].map(m => m[1]); assert.ok(assets.length > 20, 'assets found: ' + assets.length);
  const fonts = fs.readdirSync(path.join(ROOT, 'fonts')).filter(f => f.endsWith('.woff2')).map(f => path.join('fonts', f));
  let plain = fs.statSync(path.join(ROOT, 'index.html')).size, gz = zlib.gzipSync(fs.readFileSync(path.join(ROOT, 'index.html')), { level: 9 }).length;
  for (const a of assets) { const buf = fs.readFileSync(path.join(ROOT, a)); plain += buf.length; gz += zlib.gzipSync(buf, { level: 9 }).length; }
  assert.ok(plain > G.LIMITS.sizeGrowth * b.firstPageBytes - fonts.length * 0, 'without gzip the scripts and styles alone (' + Math.round(plain / 1024) + ' KB) would be over the limit (' + Math.round(G.LIMITS.sizeGrowth * b.firstPageBytes / 1024) + ' KB)');
  assert.ok(gz < b.firstPageBytes, 'with gzip they are ' + Math.round(gz / 1024) + ' KB, well inside the baseline');
});

test('measured in a real browser: the first page is within 15% of its saved size', async () => {
  const runs = await G.measure(), b = G.loadBudget(), bytes = Math.max.apply(null, runs.map(r => r.bytes));
  assert.deepEqual(G.checkSize(bytes, b.firstPageBytes), [], 'first page: ' + Math.round(bytes / 1024) + ' KB');
  assert.ok(bytes > b.firstPageBytes * 0.5, 'it measured something real: ' + bytes + ' vs ' + b.firstPageBytes);
});

// The public receipt check page in a browser: paste a receipt (matches), change one character (does not match), paste only a
// fingerprint, arrive from a QR link (?f=), and see plain errors; clean under the strict CSP at four widths in both themes.
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
let browser, app, base, md, fp, html;
test.before(async () => {
  browser = await H.launch();
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-verify-')), 'v.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000', NOVA_RATE_VERIFY_MAX: '100000' });
  base = 'http://127.0.0.1:' + await app.listen();
  const o = await H.openApp(browser, { base, hash: '' });                                    // an owner makes a receipt, as in the app
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown'); await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J);
  const r = await o.page.evaluate(async () => { const h = { 'Content-Type': 'application/json', 'X-NOVA-CSRF': NOVA.csrf }; const c = await fetch('/api/commitments', { method: 'POST', headers: h, body: JSON.stringify({ title: 'مراجعة الطلب 🚀 <b>x</b>', direction: 'i_owe', deadline: '2026-12-01' }) }).then(x => x.json()); const id = c.commitment.id;
    return { md: await fetch('/api/commitments/' + id + '/receipt?format=md').then(x => x.text()), html: await fetch('/api/commitments/' + id + '/receipt?format=html').then(x => x.text()) }; });
  md = r.md; html = r.html; fp = /`([0-9a-f]{64})`/.exec(md)[1]; await o.ctx.close();
});
test.after(async () => { await browser.close(); app.server.closeAllConnections(); await app.close(); });
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
async function openVerify(opts, q) { const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {})); await o.page.goto(base + '/verify' + (q || '')); await o.page.waitForSelector('#verifyForm'); return o; }

test('paste the receipt: matches; change one character: does not match; the answer never repeats what was pasted', async () => {
  const { page, ctx, errors } = await openVerify();
  assert.match(await page.innerText('h1'), /Check a receipt/);
  await page.fill('#receipt', md); await page.click('#check'); await page.waitForSelector('#result:not([hidden])');
  assert.match(await page.innerText('#verdict'), /Matches/); assert.match(await page.innerText('#message'), /exactly the receipt this NOVA issued on \d{4}-\d{2}-\d{2}/); assert.equal(await page.evaluate(() => document.activeElement.id), 'result', 'focus moves to the answer');
  await page.fill('#receipt', md.replace('Request Understood', 'Request Understoo')); await page.click('#check'); await page.waitForFunction(() => /Does not match/.test(document.getElementById('verdict').textContent));
  assert.match(await page.innerText('#message'), /something in the receipt was changed/);
  assert.ok(!(await page.innerText('#result')).includes('مراجعة'), 'nothing pasted is shown back');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('just a fingerprint; a made-up one; empty; the QR link (?f=) checks by itself; the printable receipt\'s own text checks out', async () => {
  const { page, ctx } = await openVerify();
  await page.fill('#receipt', fp); await page.press('#receipt', 'Tab'); await page.click('#check'); await page.waitForFunction(() => /Matches/.test(document.getElementById('verdict').textContent));
  await page.fill('#receipt', '0'.repeat(64)); await page.click('#check'); await page.waitForFunction(() => /Does not match/.test(document.getElementById('verdict').textContent)); assert.match(await page.innerText('#message'), /did not issue/);
  await page.fill('#receipt', '  '); await page.click('#check'); await page.waitForSelector('#err:not([hidden])'); assert.match(await page.innerText('#err'), /Paste a receipt or a fingerprint first/);
  await ctx.close();
  const q = await openVerify({}, '?f=' + fp); await q.page.waitForFunction(() => /Matches/.test(document.getElementById('verdict').textContent)); assert.equal(await q.page.inputValue('#receipt'), fp); await q.ctx.close();
  const text = /<pre id="receipt-text">([\s\S]*?)<\/pre>/.exec(html)[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const h = await openVerify(); await h.page.fill('#receipt', text); await h.page.click('#check'); await h.page.waitForFunction(() => /Matches/.test(document.getElementById('verdict').textContent)); await h.ctx.close();
});

test('errors are plain: too many checks and a server error say what to do', async () => {
  const { page, ctx } = await openVerify();
  await page.route(/\/api\/verify$/, r => r.fulfill({ status: 429, headers: { 'Retry-After': '17', 'content-type': 'application/json' }, body: '{}' }));
  await page.fill('#receipt', fp); await page.click('#check'); await page.waitForSelector('#err:not([hidden])'); assert.match(await page.innerText('#err'), /Wait 17 seconds/);
  await page.unroute(/\/api\/verify$/); await page.route(/\/api\/verify$/, r => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await page.click('#check'); await page.waitForFunction(() => /could not run \(500\)/.test(document.getElementById('err').textContent)); assert.equal(await page.isDisabled('#check'), false, 'the button works again');
  await ctx.close();
});

test('the printable receipt is clean: escaped title, the fingerprint, a QR image with a text alternative', async () => {
  const { page, ctx, errors } = await openVerify(); await page.setContent(html);
  assert.equal(await page.locator('.qr svg[role="img"]').count(), 1); assert.match(await page.getAttribute('.qr svg', 'aria-label'), /QR code/); assert.equal(await page.locator('h1 b, h1 script').count(), 0, 'the title is escaped');
  assert.match(await page.innerText('h1'), /<b>x<\/b>/); assert.equal(await page.innerText('code'), fp); assert.deepEqual(clean(errors), []); await ctx.close();
});

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1024, 1440]) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': empty, with a result, with an error', async () => {
    const { page, ctx, errors } = await openVerify({ width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    const run = async name => { await page.evaluate(src => (0, eval)(src), AXE); const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }));
      const bad = ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => name + ' ' + v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')); assert.deepEqual(bad, [], bad.join('\n')); assert.deepEqual(await page.evaluate(checkLayout), [], name); };
    await run('empty');
    await page.fill('#receipt', md); await page.click('#check'); await page.waitForSelector('#result.ok'); await run('match');
    await page.fill('#receipt', '0'.repeat(64)); await page.click('#check'); await page.waitForSelector('#result.bad'); await run('no match');
    await page.fill('#receipt', ' '); await page.click('#check'); await page.waitForSelector('#err:not([hidden])'); await run('error');
    assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

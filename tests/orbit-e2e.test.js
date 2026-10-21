// Promise Orbit in the browser: dots match the data, overdue ones are red AND marked with a "!" and words, keyboard opens an item,
// 200 items show 12 dots and "+188 more", the list view has the same rows, motion stops when hidden or reduced, and the page stays clean.
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

const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
let browser, app, base, empty, emptyBase; const extra = [];   // servers a test starts itself: always closed, even when the test fails
const mk = () => createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-orbit-')), 'o.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'demo@nova.local,empty@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
test.before(async () => {
  browser = await H.launch(); app = mk(); seed(app); app.email.loadDemo(1); base = 'http://127.0.0.1:' + await app.listen();
  empty = mk(); emptyBase = 'http://127.0.0.1:' + await empty.listen();
});
test.after(async () => { await browser.close(); for (const a of [app, empty].concat(extra)) { a.server.closeAllConnections(); await a.close(); } });

async function open(b, email, opts) {
  const o = await H.openApp(browser, Object.assign({ base: b, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', email); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const api = (page, p) => page.evaluate(u => fetch(u).then(r => r.json()), p);

test('dots match the data; overdue dots are red, show "!" and say "overdue" in words; the caption and list say the same', async () => {
  const { page, ctx, errors } = await open(base, 'demo@nova.local');
  await page.waitForSelector('.odot');
  const data = await api(page, '/api/orbit');
  assert.equal(await page.locator('.odot').count(), data.shown.length);
  assert.ok(data.shown.length > 0 && data.overdue > 0);
  assert.deepEqual(await page.$$eval('.odot', d => d.map(x => x.getAttribute('aria-label'))), data.shown.map(i => i.label));
  const od = page.locator('.odot.s-overdue').first();
  assert.match(await od.getAttribute('aria-label'), /overdue \d+ days?/); assert.equal(await od.innerText(), '!');
  assert.match(await od.evaluate(e => getComputedStyle(e).borderTopColor), /rgb\(2[0-9]{2}, 1[0-9]{2}, 1[0-9]{2}\)|rgb\(255, 10[0-9], 10[0-9]\)/, 'red border');
  assert.match(await page.innerText('#orbitCaption'), new RegExp(data.total + ' open · ' + data.overdue + ' overdue'));
  await od.focus(); assert.equal(await page.innerText('#orbitCaption'), await od.getAttribute('data-cap'), 'the caption tells the focused item in words');
  await page.click('.orbit-list summary');
  assert.equal(await page.locator('.orbit-list tbody tr').count(), data.shown.length);
  assert.match(await page.innerText('.orbit-list'), /Overdue[\s\S]*Waiting for proof/);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('keyboard: Tab to a dot, Enter opens the commitment, Escape closes and focus returns; a task dot goes to Tasks and Calendar', async () => {
  const { page, ctx } = await open(base, 'demo@nova.local');
  await page.waitForSelector('.odot'); await page.waitForTimeout(300);
  const commit = page.locator('.odot[data-id^="commitment:"]').first();
  await commit.focus(); await page.keyboard.press('Enter');
  await page.waitForSelector('#formDialog[open]');
  assert.match(await page.innerText('#formDialog'), /evidence chain/i);
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#formDialog[open]'));
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('odot')), true, 'focus returns to the dot');
  const task = page.locator('.odot[data-id^="task:"]').first();
  if (await task.count()) { await task.focus(); await page.keyboard.press('Enter'); await page.waitForFunction(() => J.current() === 'hub'); }
  await ctx.close();
});

test('200 items: 12 dots and "+N more"; the list view shows the same 12 and points to the rest', async () => {
  const a = mk(); extra.push(a); const b = 'http://127.0.0.1:' + await a.listen();
  a.db.prepare("INSERT INTO users (email, display_name, created_at) VALUES ('empty@nova.local', 'Big', ?)").run(Date.now());
  a.db.exec('BEGIN'); for (let i = 0; i < 200; i++) a.db.prepare("INSERT INTO tasks (user_id, title, due, status, created_at) VALUES (1, ?, ?, 'open', ?)").run((i % 9 ? 'Task ' : 'مراجعة الطلب ') + i + ' 🚀', i % 3 ? '2026-12-' + String(1 + (i % 28)).padStart(2, '0') : null, Date.now()); a.db.exec('COMMIT');
  const { page, ctx, errors } = await open(b, 'empty@nova.local');
  await page.waitForSelector('.odot');
  assert.equal(await page.locator('.odot').count(), 12); assert.equal((await page.innerText('.orbit-more')).trim().toLowerCase(), '+188 more');
  assert.match(await page.innerText('#orbitCaption'), /200 open/);
  await page.click('.orbit-list summary'); assert.equal(await page.locator('.orbit-list tbody tr').count(), 12);
  assert.match(await page.innerText('.orbit-list'), /\+188 more in ProofLoop and Tasks and Calendar/);
  assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('nothing open: a plain "clear orbit" message and no dots', async () => {
  const { page, ctx } = await open(emptyBase, 'empty@nova.local');
  await page.waitForFunction(() => /clear orbit/.test((document.getElementById('orbitCaption') || {}).textContent || ''));
  assert.equal(await page.locator('.odot').count(), 0); assert.equal(await page.locator('.orbit-list').count(), 0);
  await ctx.close();
});

test('motion: the orbit turns slowly, pauses when you hover or focus it and when the tab is hidden, and stays still with reduced motion', async () => {
  const { page, ctx } = await open(base, 'demo@nova.local');
  await page.waitForSelector('.odot');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.orbit')).animationName), 'none');
  await page.locator('.odot').first().focus();
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.orbit')).animationPlayState), 'paused');
  await page.evaluate(() => document.activeElement.blur());
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.orbit')).animationPlayState), 'paused');
  await ctx.close();
  const r = await open(base, 'demo@nova.local'); await r.page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await r.page.evaluate(() => getComputedStyle(document.querySelector('.orbit')).animationName), 'none');
  await r.ctx.close();
});

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1024, 1440]) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': nothing overflows, no serious axe issues, the list opens', async () => {
    const { page, ctx, errors } = await open(base, 'demo@nova.local', { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await page.waitForSelector('.odot'); await page.click('.orbit-list summary'); await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(checkLayout), []);
    await page.evaluate(src => (0, eval)(src), AXE);
    const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }));
    const bad = ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | '));
    assert.deepEqual(bad, [], bad.join('\n')); assert.deepEqual(clean(errors), []);
    await ctx.close();
  });
}

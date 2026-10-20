// Race conditions: a double-clicked or doubled Approve runs the change once; fast page switching ends on the right page with
// no stale content and no errors; the hub's Done and Delete buttons go through the preview; the focus timer chip never
// duplicates however often you switch pages; a second focus session cannot start while one runs.
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
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-race-')), 'r.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'demo@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
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
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const post = (page, url, body) => page.evaluate(([u, b]) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NOVA-CSRF': NOVA.csrf }, body: JSON.stringify(b) }).then(r => r.json().then(j => ({ status: r.status, body: j }))), [url, body]);

test('hub Done: preview first, a double-clicked Approve runs once, the task is done; Delete can be rejected', async () => {
  const { page, ctx, errors } = await open();
  await page.evaluate(() => { location.hash = 'hub'; }); await page.waitForSelector('button[data-act="novaTaskDone"]');
  const id = +(await page.locator('button[data-act="novaTaskDone"]').first().getAttribute('data-id'));
  await page.locator('button[data-act="novaTaskDone"]').first().click();
  await page.waitForSelector('#hubPreview .preview');
  assert.equal(app.db.prepare('SELECT status FROM tasks WHERE id = ?').get(id).status, 'open', 'nothing changes before approval');
  await page.dblclick('#hubPreview button[data-act="novaApproveRun"]');
  await page.waitForFunction(() => !document.querySelector('#hubPreview .preview'));
  await page.waitForFunction(i => !document.querySelector('button[data-act="novaTaskDone"][data-id="' + i + '"]'), id);
  assert.equal(app.db.prepare('SELECT status FROM tasks WHERE id = ?').get(id).status, 'done');
  assert.equal(app.db.prepare("SELECT count(*) n FROM tool_executions WHERE tool = 'tasks.complete' AND input LIKE ?").get('%' + id + '%').n, 1, 'executed exactly once');
  // Delete -> Reject: the task stays
  const del = +(await page.locator('button[data-act="novaTaskDelete"]').first().getAttribute('data-id'));
  await page.locator('button[data-act="novaTaskDelete"]').first().click(); await page.waitForSelector('#hubPreview .preview');
  await page.click('#hubPreview button[data-act="novaRejectRun"]'); await page.waitForFunction(() => !document.querySelector('#hubPreview .preview'));
  assert.equal(app.db.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get(del).deleted_at, null, 'rejected delete changes nothing');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('two Approve requests at the same moment: one execution, the second is told it already ran', async () => {
  const { page, ctx } = await open();
  const r = await post(page, '/api/chat', { message: 'add a task to race check the approvals' });
  const approval = r.body.run.approvals.find(a => a.status === 'pending');
  const [a, b] = await page.evaluate(id => Promise.all([1, 2].map(() => fetch('/api/approvals/' + id + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NOVA-CSRF': NOVA.csrf }, body: '{}' }).then(x => x.status))), approval.id);
  assert.ok([a, b].includes(200), 'one approval succeeds');
  assert.ok([a, b].every(s => s === 200 || s === 409), 'the other is either "already executed" or a clear conflict, never a second run: ' + a + ' ' + b);
  assert.equal(app.db.prepare('SELECT count(*) n FROM tasks WHERE title LIKE ?').get('%race check the approvals%').n, 1, 'one task, not two');
  assert.equal(app.db.prepare('SELECT count(*) n FROM tool_executions WHERE approval_id = ?').get(approval.id).n, 1);
  await ctx.close();
});

test('fast page switching: 40 switches in a row end on the last page, fully drawn, with no stale content or errors', async () => {
  const { page, ctx, errors } = await open();
  const order = ['knowledge', 'email', 'life', 'insights', 'focus', 'briefing', 'automation', 'hub', 'proofloop', 'dashboard'];
  await page.evaluate(o => new Promise(res => { let i = 0; (function next() { location.hash = o[i % o.length]; if (++i < 40) setTimeout(next, 15); else res(); })(); }), order);
  await page.evaluate(() => { location.hash = 'life'; });
  await page.waitForSelector('.life-grid', { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('#main .empty') || !/Loading/.test(document.querySelector('#main').textContent)); await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => J.current()), 'life');
  assert.equal(await page.locator('.kb-docs, .mail-filters, .brief-sec, .sched, .timeline-plan').count(), 0, 'no content from other pages');
  assert.equal(await page.locator('.load-error').count(), 0);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('focus: a second start is refused while one runs; the top-bar timer stays single across many page switches', async () => {
  const { page, ctx, errors } = await open();
  const first = await post(page, '/api/focus/start', { minutes: 25, title: 'Race focus' });
  assert.equal(first.status, 201);
  const [x, y] = await page.evaluate(() => Promise.all([1, 2].map(() => fetch('/api/focus/start', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NOVA-CSRF': NOVA.csrf }, body: '{"minutes":25}' }).then(r => r.status))));
  assert.deepEqual([x, y], [409, 409]);
  await page.evaluate(() => { location.hash = 'focus'; }); await page.waitForSelector('.focus-card.running');
  for (const h of ['insights', 'life', 'focus', 'hub', 'chat', 'insights']) { await page.evaluate(v => { location.hash = v; }, h); await page.waitForFunction(v => J.current() === v, h); }
  await page.waitForSelector('#focusChip'); await page.waitForTimeout(1200);
  assert.equal(await page.locator('#focusChip').count(), 1);
  assert.match(await page.innerText('#focusChip'), /\d\d:\d\d/);
  await post(page, '/api/focus/' + first.body.session.id + '/stop', {});
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('a background redraw keeps keyboard focus on the same button (buttons without an id too)', async () => {
  const { page, ctx, errors } = await open();
  await page.evaluate(() => { location.hash = 'hub'; }); await page.waitForSelector('button[data-act="novaTaskDelete"]');
  const id = await page.locator('button[data-act="novaTaskDelete"]').nth(1).getAttribute('data-id');
  await page.locator('button[data-act="novaTaskDelete"]').nth(1).focus();
  await page.evaluate(() => J.render(false));                                   // what a refresh arriving in the background does
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-act') + '#' + document.activeElement.getAttribute('data-id')), 'novaTaskDelete#' + id);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

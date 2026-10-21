// The Undo list in the browser: under Day Replay and linked from the bell menu; Undo opens a preview with "what happens if" and runs only
// on approval; plain reasons where undoing is impossible; double click safe; only your own changes; clean at four widths in both themes.
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
let browser; const apps = [];
test.before(async () => { browser = await H.launch(); });
test.after(async () => { await browser.close(); for (const a of apps) { a.server.closeAllConnections(); await a.close(); } });

async function server() {
  const app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-undo-')), 'u.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local,b@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  apps.push(app); return { app, base: 'http://127.0.0.1:' + await app.listen() };
}
async function open(base, email, opts) {
  const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {}));
  const posts = []; o.page.on('request', q => { if (q.method() !== 'GET') posts.push(q.method() + ' ' + new URL(q.url()).pathname); });
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', email || 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  posts.length = 0; o.posts = posts; return o;
}
const doIt = (page, text) => page.evaluate(async t => { const r = await NOVA.api('POST', '/api/chat', { message: t }); await NOVA.api('POST', '/api/approvals/' + r.run.pendingApproval.id + '/approve', {}); }, text);
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const goReplay = async page => { await page.evaluate(() => { location.hash = 'replay'; }); await page.waitForSelector('#undoPanel .un-row'); };
const seedMemoryDelete = (app, uid) => { const r = Number(app.db.prepare("INSERT INTO runs (user_id, request, status, planner, created_at, updated_at) VALUES (?, 'x', 'completed', 'rules', 1, 1)").run(uid).lastInsertRowid); app.db.prepare("INSERT INTO tool_executions (user_id, run_id, tool, input, status, output, undoable, started_at, finished_at) VALUES (?, ?, 'memory.delete', '{}', 'succeeded', '{}', 0, ?, ?)").run(uid, r, Date.now(), Date.now()); };

test('the list under Day Replay: newest first, plain words, an Undo button, and a plain reason where undoing is impossible', async () => {
  const { app, base } = await server(); const { page, ctx, errors } = await open(base);
  await doIt(page, 'add a task to send the proposal by 2026-12-30'); await doIt(page, 'note that the gate code is on the fridge'); seedMemoryDelete(app, 1);
  await goReplay(page);
  const rows = await page.$$eval('#undoPanel .un-row', r => r.map(x => x.innerText.replace(/\s+/g, ' ')));
  assert.equal(rows.length, 3); assert.match(rows[0], /Deleted a memory.*gone for good/i); assert.match(rows[1], /Save a note.*gate code.*Undo/i); assert.match(rows[2], /Create a task.*send the proposal.*Undo/i);
  assert.equal(await page.locator('#undoPanel button[data-act="undoOpen"]').count(), 2);
  assert.match(await page.getAttribute('#undoPanel button[data-act="undoOpen"]', 'aria-label'), /^Undo: Save a note/);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('Undo shows a preview first (what changes, what happens if); Cancel changes nothing; Approve undoes it, by keyboard', async () => {
  const { app, base } = await server(); const { page, ctx, errors, posts } = await open(base);
  await doIt(page, 'add a task to send the proposal by 2026-12-30'); await goReplay(page);
  const tasks = () => app.db.prepare('SELECT COUNT(*) n FROM tasks WHERE user_id = 1 AND deleted_at IS NULL').get().n, commits = () => app.db.prepare("SELECT status FROM commitments WHERE user_id = 1").get().status;
  assert.equal(tasks(), 1); posts.length = 0;
  await page.click('#undoPanel button[data-act="undoOpen"]'); await page.waitForSelector('#formDialog[open]');
  assert.equal(await page.innerText('#formTitle'), 'Undo: Create a task');
  const t = await page.innerText('#dialogFields'); assert.match(t, /What changes[\s\S]*The task is removed\./); assert.match(t, /What happens if[\s\S]*ProofLoop commitment .*send the proposal.* will be cancelled too/i); assert.match(t, /Afterwards/);
  assert.equal(await page.innerText('#dialogSave'), 'Approve undo'); assert.equal(tasks(), 1, 'the preview changes nothing'); assert.deepEqual(posts, ['POST /api/undo/1/preview']);
  await page.click('#dialogCancel'); await page.waitForFunction(() => !document.querySelector('#formDialog[open]')); assert.equal(tasks(), 1); assert.ok(!posts.some(p => /apply/.test(p)));
  await page.focus('#undoPanel button[data-act="undoOpen"]'); await page.keyboard.press('Enter'); await page.waitForSelector('#formDialog[open]');
  await page.focus('#dialogSave'); await page.keyboard.press('Enter'); await page.waitForSelector('#undoPanel .un-row.s-undone');
  assert.equal(tasks(), 0); assert.equal(commits(), 'cancelled'); assert.match(await page.innerText('#undoPanel .un-row'), /Undone/i); assert.equal(await page.locator('#undoPanel button[data-act="undoOpen"]').count(), 0);
  assert.match(await page.innerText('#toast, .toast, [role="status"]:has-text("removed")'), /removed/i);
  await page.evaluate(() => { location.hash = 'hub'; }); await page.waitForFunction(() => document.querySelector('main') && !/send the proposal/i.test(document.querySelector('main').innerText) && !/Loading/.test(document.querySelector('main').innerText));
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('double click on Approve undoes once; a stale list refreshes with a plain message', async () => {
  const { app, base } = await server(); const { page, ctx } = await open(base);
  await doIt(page, 'note that the gate code is on the fridge'); await goReplay(page);
  await page.click('#undoPanel button[data-act="undoOpen"]'); await page.waitForSelector('#formDialog[open]'); await page.dblclick('#dialogSave'); await page.waitForSelector('#undoPanel .un-row.s-undone');
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'undo'").get().n, 1);
  await ctx.close();
});

test('the bell menu links to the list with the number of changes you can undo', async () => {
  const { base } = await server(); const { page, ctx } = await open(base);
  await doIt(page, 'note that parking is on level 2'); await doIt(page, 'add a task to call HR');
  await page.click('#novaBell'); await page.waitForSelector('#novaNotifs:not([hidden]) a[data-undo-link]');
  assert.equal((await page.innerText('#novaNotifs a[data-undo-link]')).trim(), 'Changes you can undo (2)');
  await page.click('#novaNotifs a[data-undo-link]'); await page.waitForSelector('#undoPanel .un-row'); assert.equal(await page.evaluate(() => J.current()), 'replay'); await ctx.close();
});

test("only your own changes: another account's changes never appear", async () => {
  const { base } = await server(); const a = await open(base, 'a@nova.local'); await doIt(a.page, 'note that A secret plan');
  const b = await open(base, 'b@nova.local'); await doIt(b.page, 'note that B private note'); await goReplay(b.page);
  const text = await b.page.innerText('#undoPanel'); assert.match(text, /B private note/); assert.doesNotMatch(text, /A secret plan/);
  await a.ctx.close(); await b.ctx.close();
});

test('an empty list says so in plain words', async () => {
  const { base } = await server(); const { page, ctx } = await open(base); await page.evaluate(() => { location.hash = 'replay'; }); await page.waitForSelector('#undoPanel .empty:has-text("has not changed anything")'); await ctx.close();
});

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1024, 1440]) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': the Undo list and its preview', async () => {
    const { app, base } = await server(); const { page, ctx, errors } = await open(base, 'a@nova.local', { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await doIt(page, 'add a task to send the proposal by 2026-12-30'); await doIt(page, 'note that مراجعة طلب التأشيرة 🚀 is due'); seedMemoryDelete(app, 1);
    for (let i = 0; i < 12; i++) await doIt(page, 'note that item number ' + i);
    await goReplay(page); await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(checkLayout), []);
    const axeRun = async () => { await page.evaluate(src => { if (!window.axe) (0, eval)(src); }, AXE); const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })); return ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')); };
    assert.deepEqual(await axeRun(), []);
    await page.locator('#undoPanel .un-row:has-text("Create a task") button[data-act="undoOpen"]').click(); await page.waitForSelector('#formDialog[open]'); await page.waitForTimeout(300);
    assert.deepEqual(await axeRun(), []); assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

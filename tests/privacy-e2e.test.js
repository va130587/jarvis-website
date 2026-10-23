// "What NOVA knows about me" in the browser: real counts, accounts and permissions, what is encrypted, what NOVA never does, export, and deleting one kind
// with a preview, a typed word and an approval, by keyboard; clean at four widths in both themes with axe, also at 150% text.
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
  const app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-pv-')), 'p.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', BASE_URL: '', NOVA_SECRET_KEY: 'a-long-random-test-key-0123456789', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  apps.push(app); return { app, base: 'http://127.0.0.1:' + await app.listen() };
}
function fixture(db) {
  const T = Date.now(); db.exec('BEGIN');
  for (let i = 0; i < 12; i++) db.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (1, ?, 'open', ?)").run('Task ' + i + ' مراجعة 🚀', T);
  for (let i = 0; i < 3; i++) db.prepare('INSERT INTO notes (user_id, text, created_at) VALUES (1, ?, ?)').run('Note ' + i, T);
  db.prepare("INSERT INTO connections (user_id, provider, account, scope, token_enc, status, last_sync_at, created_at, updated_at) VALUES (1, 'gmail', 'me@gmail.example', 'https://www.googleapis.com/auth/gmail.readonly', 'ENC', 'connected', ?, ?, ?)").run(T, T, T); db.exec('COMMIT');
}
async function open(srv, opts) {
  const o = await H.openApp(browser, Object.assign({ base: srv.base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  if (srv.seed) srv.seed(srv.app.db);
  await o.page.evaluate(() => { location.hash = 'privacy'; }); await o.page.waitForSelector('#pv-counts'); return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const axeRun = async page => { await page.evaluate(src => { if (!window.axe) (0, eval)(src); }, AXE); const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })); return ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')); };

test('the page tells the truth: counts, the connected Gmail and what it may do, what is encrypted, and what NOVA never does', async () => {
  const srv = await server(); srv.seed = fixture; const { page, ctx, errors } = await open(srv); const t = await page.textContent('main');
  assert.match(t, /Real counts from your account, signed in as a@nova\.local/); assert.match(await page.innerText('#pv-counts ~ ul li:first-child'), /Tasks[\s\S]*12/); assert.match(t, /Notes[\s\S]*3/);
  assert.match(t, /Gmail: me@gmail\.example/); assert.match(t, /Read only: can read headers and a short preview\. Cannot send, delete or change anything\./); assert.match(t, /access is stored encrypted/); assert.match(t, /Encrypted with your NOVA_SECRET_KEY/);
  assert.match(t, /NOVA never sends e-mail/); assert.match(t, /NOVA never uses a paid service on its own/); assert.match(t, /built-in rules on this computer/); assert.equal(await page.locator('button[data-act="pvDelete"][disabled]').count() > 0, true, 'kinds with nothing stored cannot be deleted');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button[data-act="pvExport"][data-id="json"]')]); assert.equal(dl.suggestedFilename(), 'nova-export.json'); assert.match(fs.readFileSync(await dl.path(), 'utf8'), /Task 0/);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('delete one kind by keyboard: preview with the exact count, a typed word, approval, and a re-check; Cancel keeps everything', async () => {
  const srv = await server(); srv.seed = fixture; const { page, ctx, errors } = await open(srv); const db = srv.app.db;
  await page.focus('button[data-act="pvDelete"][data-id="notes"]'); await page.keyboard.press('Enter'); await page.waitForSelector('#pvDel'); assert.equal(await page.evaluate(() => document.activeElement.id), 'pvDelH');
  const t = await page.innerText('#pvDel'); assert.match(t, /Delete 3 notes from your NOVA account\./); assert.match(t, /Cannot be undone/i); assert.match(t, /Everything else you have stays as it is\./); assert.equal(db.prepare('SELECT COUNT(*) n FROM notes').get().n, 3, 'a preview deletes nothing');
  await page.click('button[data-act="pvCancel"]'); await page.waitForSelector('#pvDel', { state: 'detached' }); assert.equal(db.prepare('SELECT COUNT(*) n FROM notes').get().n, 3);
  await page.click('button[data-act="pvDelete"][data-id="notes"]'); await page.waitForSelector('#pvDel'); await page.fill('#pvWord', 'delete'); await page.keyboard.press('Enter'); await page.waitForSelector('#pvDel .load-error'); assert.match(await page.innerText('#pvDel .load-error'), /^Type DELETE to confirm\. Nothing was deleted\./); assert.equal(db.prepare('SELECT COUNT(*) n FROM notes').get().n, 3);
  await page.fill('#pvWord', 'DELETE'); await page.keyboard.press('Enter'); await page.waitForSelector('.gmail-msg:has-text("Deleted 3 notes. Checked afterwards: 0 left.")'); assert.equal(db.prepare('SELECT COUNT(*) n FROM notes').get().n, 0); assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks').get().n, 12);
  await page.waitForFunction(() => /Notes[\s\S]*\b0\b/.test(document.querySelector('#pv-counts ~ ul').innerText)); assert.equal(await page.locator('button[data-act="pvDelete"][data-id="notes"][disabled]').count(), 1);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

for (const width of [390, 768, 1024, 1440]) for (const theme of ['dark', 'light']) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': the page and the delete preview, also at 150% text', async () => {
    const srv = await server(); srv.seed = fixture; const { page, ctx, errors } = await open(srv, { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined }); await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    await page.click('button[data-act="pvDelete"][data-id="tasks"]'); await page.waitForSelector('#pvDel'); await page.waitForTimeout(250); assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    await page.evaluate(() => document.documentElement.setAttribute('data-text', '150')); await page.waitForTimeout(250); assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

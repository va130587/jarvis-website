// Export and import in the browser (Security and Settings): the readable copy, preview before approval, Approve/Cancel by keyboard,
// plain refusals for wrong, unreadable and oversized files, and clean at four widths in both themes.
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-data-e2e-'));
let browser, app, base;
test.before(async () => {
  browser = await H.launch();
  app = createApp({ NOVA_DB: path.join(TMP, 'd.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local,b@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  const db = app.db, t = Date.now();
  db.prepare("INSERT INTO users (email, display_name, created_at) VALUES ('a@nova.local', 'Ayla', 1)").run();
  db.prepare("INSERT INTO tasks (user_id, title, due, status, created_at) VALUES (1, 'Pay the electricity bill', '2026-12-25', 'open', ?)").run(t);
  db.prepare("INSERT INTO tasks (user_id, title, created_at) VALUES (1, 'مراجعة طلب التأشيرة 🚀', ?)").run(t);
  db.prepare("INSERT INTO notes (user_id, text, created_at) VALUES (1, 'Visa photos need a white background', ?)").run(t);
  db.prepare("INSERT INTO memories (user_id, kind, text, source, status, sensitive, created_at, updated_at) VALUES (1, 'preference', 'I like short answers', 'user', 'active', 0, ?, ?)").run(t, t);
  db.prepare("INSERT INTO commitments (user_id, title, direction, counterparty, deadline, source_type, status, created_at, updated_at) VALUES (1, 'Send the proposal', 'i_owe', 'Alex', '2026-12-30', 'manual', 'awaiting_confirmation', ?, ?)").run(t, t);
  base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); app.server.closeAllConnections(); await app.close(); });

async function open(opts, email) {
  const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {}));
  const posts = []; o.page.on('request', q => { if (q.method() !== 'GET') posts.push(q.method() + ' ' + new URL(q.url()).pathname); });
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', email || 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  await o.page.evaluate(() => { location.hash = 'security'; }); await o.page.waitForSelector('#importPanel');
  posts.length = 0; o.posts = posts; return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const exportFile = async (page, name) => { const f = path.join(TMP, name); const j = await page.evaluate(() => fetch('/api/export').then(r => r.json())); fs.writeFileSync(f, JSON.stringify(j)); return f; };
const counts = () => ['tasks', 'notes', 'memories', 'commitments'].map(t => app.db.prepare('SELECT COUNT(*) n FROM ' + t + ' WHERE user_id = 1').get().n).join(',');

test('readable copy: downloads a Markdown file with your tasks, notes, memories and commitments', async () => {
  const { page, ctx, errors } = await open();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button[data-act="dataMd"]')]);
  assert.equal(dl.suggestedFilename(), 'nova-export.md'); const md = fs.readFileSync(await dl.path(), 'utf8');
  for (const t of ['# NOVA export for Ayla', '- [ ] Pay the electricity bill (due 2026-12-25)', '- [ ] مراجعة طلب التأشيرة 🚀', 'Visa photos need a white background', 'I like short answers', 'Proof receipt: Send the proposal']) assert.ok(md.includes(t), t);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('import: choose a file, see the preview, nothing changes until Approve; Cancel leaves everything as it was', async () => {
  const { page, ctx, errors, posts } = await open();
  const file = await exportFile(page, 'mine.json'); const before = counts();
  app.db.prepare('DELETE FROM tasks WHERE user_id = 1').run(); app.db.prepare('DELETE FROM notes WHERE user_id = 1').run();
  const wiped = counts();
  await page.setInputFiles('#importFile', file); await page.waitForSelector('#impPreview');
  assert.match(await page.innerText('#impPreview'), /Ready to import: mine\.json/);
  const rows = await page.$$eval('.imp-table tbody tr', r => r.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
  assert.ok(rows.some(r => /^Tasks 2 0 0$/i.test(r)), rows.join(' | ')); assert.ok(rows.some(r => /^Notes 1 0 0$/i.test(r))); assert.ok(rows.some(r => /^Memories 0 1 0$/i.test(r)), 'memories and commitments are already there'); assert.ok(rows.some(r => /^ProofLoop commitments 0 1 0$/i.test(r)));
  assert.match(await page.innerText('#impPreview'), /3 new items will be added to your account/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'impPreview', 'focus moves to the preview');
  assert.deepEqual(posts, ['POST /api/import/preview'], 'only the preview was requested'); assert.equal(counts(), wiped, 'a preview changes nothing');
  await page.click('button[data-act="dataCancel"]'); await page.waitForFunction(() => !document.querySelector('#impPreview'));
  assert.equal(counts(), wiped); assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-act')), 'dataPick', 'focus returns to the Import button');
  await page.setInputFiles('#importFile', file); await page.waitForSelector('#impPreview');
  await page.focus('button[data-act="dataApprove"]'); await page.keyboard.press('Enter'); await page.waitForSelector('#impDone');
  assert.match(await page.innerText('#impDone'), /Imported 3 items\./); assert.equal(counts(), before);
  assert.ok(posts.includes('POST /api/import/apply'));
  await page.evaluate(() => { location.hash = 'hub'; }); await page.waitForFunction(() => /Pay the electricity bill/.test(document.querySelector('main').innerText));
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('importing the same file again says there is nothing new', async () => {
  const { page, ctx } = await open(); const file = await exportFile(page, 'same.json');
  await page.setInputFiles('#importFile', file); await page.waitForSelector('#impPreview');
  assert.match(await page.innerText('#impPreview'), /Nothing new to import/); assert.equal(await page.locator('button[data-act="dataApprove"]').count(), 0); await ctx.close();
});

test('wrong files are refused in plain words: not JSON, not a NOVA export, damaged, and too big', async () => {
  const { page, ctx, errors, posts } = await open(); const before = counts();
  const put = async (name, content) => { const f = path.join(TMP, name); fs.writeFileSync(f, content); await page.setInputFiles('#importFile', f); await page.waitForSelector('#importBody .load-error'); return page.innerText('#importBody .load-error'); };
  assert.match(await put('words.json', 'this is not json at all'), /cannot be read/);
  assert.match(await put('other.json', JSON.stringify({ hello: 'world' })), /does not recognise|nothing NOVA can import/);
  assert.match(await put('sessions.json', JSON.stringify({ format: 'nova-export', tasks: [], sessions: [{ id: 'x' }] })), /does not recognise/);
  assert.match(await put('damaged.json', JSON.stringify({ format: 'nova-export', tasks: 'abc' })), /damaged/);
  assert.match(await put('huge.json', '{"notes":[{"text":"' + 'x'.repeat(7 * 1024 * 1024) + '"}]}'), /too big/);
  for (const t of await page.$$eval('#importBody .load-error', e => e.map(x => x.innerText))) assert.doesNotMatch(t, /undefined|\[object|Error:|SyntaxError|JSON\.parse/);
  assert.equal(counts(), before); assert.deepEqual(posts.filter(p => p.includes('apply')), []); assert.deepEqual(clean(errors), []); await ctx.close();
});

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1024, 1440]) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': the import preview', async () => {
    const { page, ctx, errors } = await open({ width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined }, 'b@nova.local');
    app.db.prepare("INSERT OR IGNORE INTO users (email, display_name, created_at) VALUES ('b@nova.local', 'Bo', 1)").run();
    const file = path.join(TMP, 'big-' + width + theme + '.json');
    fs.writeFileSync(file, JSON.stringify({ format: 'nova-export', version: 1, user: { email: 'a@nova.local' }, tasks: Array.from({ length: 30 }, (_, i) => ({ title: 'Task ' + i + ' مهمة 🚀', due: '2026-12-01', status: 'open' })), notes: [{ text: 'A note' }], email: { messages: [] } }));
    await page.setInputFiles('#importFile', file); await page.waitForSelector('#impPreview'); await page.waitForTimeout(250);
    assert.match(await page.innerText('#impPreview'), /different account/);
    assert.deepEqual(await page.evaluate(checkLayout), []);
    await page.evaluate(src => (0, eval)(src), AXE);
    const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }));
    const bad = ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | '));
    assert.deepEqual(bad, [], bad.join('\n')); assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

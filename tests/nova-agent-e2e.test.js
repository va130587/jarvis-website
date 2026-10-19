// The agent in the browser: Future Preview, approve / reject / edit, verification text, undo, auto-approve, dashboard approvals, orb states, a11y and layout of the preview card.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const { boot, closeAll } = require('./server-helpers');

let browser, srv;
test.before(async () => { browser = await H.launch(); srv = await boot({ NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }); });
test.after(async () => { await browser.close(); await closeAll(); });
// (axe-core itself fetches the page's cross-origin stylesheets, which the CSP rightly refuses; that is noise from the checker, not the app.)
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets|fonts\.googleapis/.test(e));

async function open(email, opts) {
  const o = await H.openApp(browser, Object.assign({ base: srv.base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.waitForSelector('#novaDevEmail'); await o.page.fill('#novaDevEmail', email); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && J.current() === 'dashboard');
  return o;
}
async function toChat(page) { await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg'); }
async function say(page, t) { const n = await page.$$eval('.msg.bot', e => e.length); await page.fill('#novaMsg', t); await page.click('#novaChatForm button'); await page.waitForFunction(k => document.querySelectorAll('.msg.bot').length > k && !document.querySelector('.typing'), n); }
const api = (page, p) => page.evaluate(u => fetch(u).then(r => r.json()), p);

test('Future Preview: nothing changes until Approve; the result says it was verified; Undo reverses it; orb goes through executing and completed', async () => {
  const { page, ctx, errors } = await open('roshan@example.com'); await toChat(page);
  await page.evaluate(() => { window.__o = []; new MutationObserver(() => { const s = document.body.getAttribute('data-nova'); if (window.__o[window.__o.length - 1] !== s) window.__o.push(s); }).observe(document.body, { attributes: true, attributeFilter: ['data-nova'] }); });
  await say(page, 'add a task to call HR by friday');
  const card = page.locator('.preview'); await card.waitFor();
  const t = await card.innerText();
  for (const label of ['Proposed action', 'Why', 'Where', 'What will change', 'Possible consequences', 'Can it be undone?']) assert.match(t, new RegExp(label, 'i'), label);
  assert.match(t, /Create a task/); assert.match(t, /You asked: "add a task to call HR by friday"/); assert.match(t, /New task: "call HR", due 20\d\d-\d\d-\d\d/); assert.match(t, /Nothing is sent to anyone/); assert.match(t, /Yes\. You can undo this/);
  assert.deepEqual((await api(page, '/api/tasks')).tasks, []);                                                // nothing changed yet
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-nova')), 'waiting_approval');
  await page.click('.preview button:has-text("Approve")');
  await page.waitForSelector('.msg.bot:last-child .text:has-text("Created the task")');
  assert.match(await page.innerText('.msg.bot:last-child .text'), /Created the task "call HR".*Read back from the database: task #\d+ "call HR" exists/);
  assert.ok((await page.evaluate(() => window.__o)).includes('executing')); assert.ok((await page.evaluate(() => window.__o)).includes('completed'));
  assert.equal(await page.locator('.preview').count(), 0);
  await page.click('.msg.bot:last-child .steps summary');
  const steps = await page.innerText('.msg.bot:last-child .steps');
  for (const k of ['Understood as a built-in action', 'Waiting for your approval', 'You approved', 'Running tasks.create', 'Verified:']) assert.match(steps, new RegExp(k), k);
  assert.equal((await api(page, '/api/tasks')).tasks.length, 1);
  await page.evaluate(() => { location.hash = 'hub'; }); await page.waitForSelector('.item:has-text("call HR")');
  await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg'); await page.waitForSelector('button:has-text("Undo this")');
  await page.click('button:has-text("Undo this")'); await page.waitForFunction(() => /removed/.test(document.getElementById('toast').textContent));
  assert.deepEqual((await api(page, '/api/tasks')).tasks, []);
  assert.equal(await page.locator('button:has-text("Undo this")').count(), 0);
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('Reject changes nothing; Edit lets you change the details before approving', async () => {
  const { page, ctx, errors } = await open('roshan@example.com'); await toChat(page);
  await say(page, 'add a task to water plants');
  await page.click('.preview button:has-text("Reject")'); await page.waitForSelector('.msg.bot:last-child .text:has-text("did not do it")');
  assert.deepEqual((await api(page, '/api/tasks')).tasks, []);
  await say(page, 'add a task to renew passport');
  await page.click('.preview button:has-text("Edit")'); await page.waitForSelector('#formDialog[open]');
  await page.fill('#f_title', 'renew passport at the embassy'); await page.fill('#f_due', '2026-12-01'); await page.click('#dialogSave');
  await page.waitForSelector('.msg.bot:last-child .text:has-text("Created the task")');
  const tasks = (await api(page, '/api/tasks')).tasks; assert.deepEqual(tasks.map(x => [x.title, x.due]), [['renew passport at the embassy', '2026-12-01']]);
  await say(page, 'add a task to book flights'); await page.click('.preview button:has-text("Cancel request")');
  await page.waitForFunction(() => /cancelled/i.test(document.querySelector('.msg.bot:last-child .steps summary').textContent));
  assert.equal((await api(page, '/api/tasks')).tasks.length, 1);
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('destructive and irreversible actions: always ask; a forgotten memory says plainly it cannot be undone', async () => {
  const { page, ctx, errors } = await open('roshan@example.com'); await toChat(page);
  await page.evaluate(() => fetch('/api/memories', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nova-csrf': NOVA.csrf }, body: JSON.stringify({ text: 'I enjoy hiking on weekends' }) }));
  await say(page, 'forget hiking on weekends');
  assert.match(await page.innerText('.preview'), /Delete a memory/); assert.match(await page.innerText('.preview'), /Can it be undone\?\s*No\./i);
  assert.equal((await api(page, '/api/memories')).memories.filter(m => /hiking/.test(m.text)).length, 1);
  await page.click('.preview button:has-text("Approve")'); await page.waitForSelector('.msg.bot:last-child .text:has-text("Deleted the memory")');
  assert.match(await page.innerText('.msg.bot:last-child'), /Read back from the Memory Vault: memory #\d+ is gone/); assert.match(await page.innerText('.msg.bot:last-child'), /cannot be undone/);
  assert.equal(await page.locator('.msg.bot:last-child button:has-text("Undo")').count(), 0);
  assert.equal((await api(page, '/api/memories')).memories.filter(m => /hiking/.test(m.text)).length, 0);
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('auto-approve for low-risk changes (Identity switch): tasks and notes run without asking, deleting still asks', async () => {
  const { page, ctx, errors } = await open('mallory@example.com');
  await page.evaluate(() => { location.hash = 'identity'; }); await page.waitForSelector('#novaAuto');
  assert.equal(await page.isChecked('#novaAuto'), false);                                                   // off by default
  assert.match(await page.innerText('#novaProfileForm'), /Deleting, forgetting and anything that affects another system always asks/);
  await page.check('#novaAuto', { force: true }); await page.click('#novaProfileForm button'); await page.waitForFunction(() => NOVA.user.autoLowRisk === true);
  await toChat(page);
  await say(page, 'add a note that the lab opens at nine');
  assert.equal(await page.locator('.preview').count(), 0); assert.match(await page.innerText('.msg.bot:last-child .text'), /Saved the note.*Read back/);
  await page.click('.msg.bot:last-child .steps summary'); assert.match(await page.innerText('.msg.bot:last-child .steps'), /Approved automatically because you turned on auto-approve/);
  await say(page, 'add a task to tidy the desk'); assert.equal(await page.locator('.preview').count(), 0);
  await say(page, 'delete task tidy the desk'); await page.waitForSelector('.preview'); assert.match(await page.innerText('.preview'), /Delete a task/);
  await page.click('.preview button:has-text("Reject")');
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('Dashboard lists waiting approvals (real) and you can decide there; Security lists every tool and whether it asks first', async () => {
  const { page, ctx, errors } = await open('roshan@example.com'); await toChat(page);
  await say(page, 'add a task to pay the bill');
  await page.evaluate(() => { location.hash = 'dashboard'; }); await page.waitForSelector('#approvalsPanel');
  assert.match(await page.innerText('#approvalsPanel'), /pay the bill/);
  assert.ok(+(await page.innerText('.stats .stat:nth-child(2) .num')) >= 1);                                  // the tile counts real pending items
  await page.click('#approvalsPanel .preview:has-text("pay the bill") button:has-text("Approve")'); await page.waitForFunction(() => !(document.querySelector('#approvalsPanel') || { textContent: '' }).textContent.includes('pay the bill'));
  assert.equal((await api(page, '/api/tasks')).tasks.some(t => t.title === 'pay the bill'), true);
  await page.evaluate(() => { location.hash = 'security'; }); await page.waitForSelector('text=What NOVA is allowed to do');
  const tbl = await page.innerText('main table.cmds');
  for (const n of ['tasks.create', 'tasks.delete', 'memory.delete', 'notes.create', 'time.now']) assert.match(tbl, new RegExp(n.replace('.', '\\.'), 'i'));
  assert.match(await page.innerText('main'), /NOVA can only use tools on this list/);
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('voice: a spoken task request gets a real approval request (nothing happens without approval)', async () => {
  const { page, ctx, errors } = await open('roshan@example.com');
  const before = (await api(page, '/api/tasks')).tasks.length;
  const r = await H.ask(page, 'add a task to book flights by tomorrow');
  assert.match(r, /need your approval before I do this: Create a task/);
  assert.equal((await api(page, '/api/tasks')).tasks.length, before);
  assert.equal((await api(page, '/api/approvals')).approvals.filter(a => /book flights/.test(JSON.stringify(a.input))).length, 1);
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

for (const width of [1440, 768, 390]) {
  test('layout at ' + width + ' px with the Future Preview card, the dashboard approval panel and the tools table', async () => {
    const { checkLayout } = require('./layout-check');
    const { page, ctx, errors } = await open('roshan@example.com', { width, height: width === 390 ? 844 : 900 }); await toChat(page);
    await say(page, 'add a task to check the layout');
    const problems = []; const check = async n => (await page.evaluate(checkLayout)).forEach(x => problems.push(n + ': ' + x));
    await page.waitForTimeout(500); await check('chat');
    await page.screenshot({ path: path.join(__dirname, 'screenshots', width + '-nova-preview.png'), fullPage: true }).catch(() => {});
    for (const v of ['dashboard', 'hub', 'security', 'identity']) { await page.evaluate(h => { location.hash = h; }, v); await page.waitForTimeout(700); await check(v); }
    assert.deepEqual(problems, [], problems.join('\n')); assert.deepEqual(clean(errors), []);
    await ctx.close();
  });
}

test('axe-core on the approval card and the new tables; keyboard-only approve', async () => {
  const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
  const { page, ctx, errors } = await open('roshan@example.com'); await toChat(page);
  await say(page, 'add a task to be accessible');
  await page.evaluate(src => (0, eval)(src), AXE);
  for (const v of ['chat', 'dashboard', 'hub', 'security']) {
    await page.evaluate(h => { location.hash = h; }, v); await page.waitForTimeout(700);
    const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
    const bad = res.violations.filter(x => x.impact === 'serious' || x.impact === 'critical').map(x => v + ' ' + x.id + ': ' + x.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | '));
    assert.deepEqual(bad, [], bad.join('\n'));
  }
  await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('.preview');
  await page.focus('#novaMsg'); let found = false;
  for (let i = 0; i < 30 && !found; i++) { await page.keyboard.press('Shift+Tab'); found = await page.evaluate(() => document.activeElement.tagName === 'BUTTON' && document.activeElement.textContent === 'Approve'); }
  assert.ok(found, 'Approve is reachable by keyboard'); await page.keyboard.press('Enter');
  await page.waitForSelector('.msg.bot:last-child .text:has-text("Created the task")');
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

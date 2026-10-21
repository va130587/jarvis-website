// Backups in the browser: the Backups panel in the Automation Centre (latest backup, health, "Test my latest backup"),
// the dashboard warning after 7 days, a damaged backup, and clean at four widths in both themes.
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
const DAY = 86400e3, shift = { ms: 0 };
let browser; const apps = [];
test.before(async () => { browser = await H.launch(); });
test.after(async () => { await browser.close(); for (const a of apps) { a.server.closeAllConnections(); await a.close(); } });

async function server() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-bk-e2e-')); shift.ms = 0;
  const app = createApp({ NOVA_DB: path.join(root, 'n.db'), NOVA_BACKUP_DIR: path.join(root, 'bk'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }, { now: () => Date.now() + shift.ms });
  apps.push(app); app.db.prepare("INSERT INTO users (email, display_name, created_at) VALUES ('a@nova.local', 'Ayla', ?)").run(Date.now());
  app.db.prepare("INSERT INTO tasks (user_id, title, created_at) VALUES (1, 'Pay the bill', 1)").run();
  return { app, base: 'http://127.0.0.1:' + await app.listen(), bk: path.join(root, 'bk') };
}
async function open(base, opts) {
  const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {}));
  const posts = []; o.page.on('request', q => { if (q.method() !== 'GET') posts.push(q.method() + ' ' + new URL(q.url()).pathname); });
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  posts.length = 0; o.posts = posts; return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const goAuto = async page => { await page.evaluate(() => { location.hash = 'automation'; }); await page.waitForSelector('#bkPanel .label'); };

test('before any backup: the panel says so and the test button waits; "Run now" on the Backup job makes one; the test then works', async () => {
  const { base } = await server(); const { page, ctx, errors, posts } = await open(base);
  await goAuto(page); await page.waitForSelector('#bkPanel:has-text("No backup yet")');
  assert.equal(await page.locator('button[data-act="bkTest"]').isDisabled(), true); assert.match(await page.innerText('#bkPanel'), /NOVA_SECRET_KEY/); assert.match(await page.innerText('#bkPanel'), /USB stick/);
  await page.locator('.sched[data-kind="backup"] button[data-act="dRunNow"]').click(); await page.waitForSelector('#bkPanel:has-text("Checked, good")');
  assert.match(await page.innerText('#bkPanel'), /today.*KB.*1 kept of up to 14/s);
  await page.focus('button[data-act="bkTest"]'); await page.keyboard.press('Enter'); await page.waitForSelector('.bk-result.ok');
  assert.match(await page.innerText('.bk-result'), /This backup works\..*restores correctly.*Your live data was not touched.*Your items in it: 1 tasks/s);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-act')), 'bkTest', 'focus stays on the button');
  assert.ok(posts.includes('POST /api/backup/test')); assert.deepEqual(posts.filter(p => !/schedules|backup/.test(p)), [], 'nothing else changed'); assert.deepEqual(clean(errors), []); await ctx.close();
});

test('a damaged backup is shown as damaged, and the test says it did not pass', async () => {
  const { app, base, bk } = await server(); app.backups.job({ id: 1 }, { trigger: 'manual' });
  const f = path.join(bk, fs.readdirSync(bk).find(x => x.endsWith('.db'))); const buf = fs.readFileSync(f); buf.fill(0x41, 2000, 6000); fs.writeFileSync(f, buf);
  const { page, ctx } = await open(base); await goAuto(page); await page.waitForSelector('#bkPanel:has-text("Damaged")');
  assert.match(await page.innerText('#bkPanel'), /Problem: /); await page.click('button[data-act="bkTest"]'); await page.waitForSelector('.bk-result.bad');
  assert.match(await page.innerText('.bk-result'), /did not pass.*cannot be restored.*Run now/s); assert.match(await page.innerText('main'), /damaged/i); await ctx.close();
});

test('the dashboard warns when there is no backup after 7 days, or the last one is over 7 days old, and not before', async () => {
  const { app, base } = await server();
  let o = await open(base); await o.page.waitForTimeout(800); assert.equal(await o.page.locator('.bk-warn').count(), 0, 'a new NOVA is not nagged'); await o.ctx.close();
  shift.ms = 8 * DAY; o = await open(base); await o.page.waitForSelector('.bk-warn');
  assert.match(await o.page.innerText('.bk-warn'), /no backup yet/); await o.page.click('.bk-warn a'); await o.page.waitForSelector('#bkPanel'); assert.equal(await o.page.evaluate(() => J.current()), 'automation'); await o.ctx.close();
  app.backups.job({ id: 1 }, { trigger: 'manual' });
  o = await open(base); await o.page.waitForTimeout(800); assert.equal(await o.page.locator('.bk-warn').count(), 0, 'a fresh backup clears it'); await o.ctx.close();
  shift.ms = 17 * DAY; o = await open(base); await o.page.waitForSelector('.bk-warn'); assert.match(await o.page.innerText('.bk-warn'), /9 days old/); await o.ctx.close();
});

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1024, 1440]) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': the Backups panel with a result', async () => {
    const { app, base } = await server(); app.backups.job({ id: 1 }, { trigger: 'manual' });
    const { page, ctx, errors } = await open(base, { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await goAuto(page); await page.waitForSelector('#bkPanel:has-text("Checked, good")'); await page.click('button[data-act="bkTest"]'); await page.waitForSelector('.bk-result.ok'); await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(checkLayout), []);
    await page.evaluate(src => (0, eval)(src), AXE);
    const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }));
    const bad = ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | '));
    assert.deepEqual(bad, [], bad.join('\n')); assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

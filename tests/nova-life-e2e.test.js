// Life Tracker in a real browser on the demo data: capture bar with inline approval, reminders, habits, money, layout and axe.
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
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-life-')), 'l.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'demo@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  seed(app); base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); app.server.closeAllConnections(); await app.close(); });
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets|fonts\.googleapis/.test(e));
async function open(opts) {
  const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'demo@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  await o.page.evaluate(() => { location.hash = 'life'; }); await o.page.waitForSelector('.life-grid');
  return o;
}
const life = page => page.evaluate(() => fetch('/api/life').then(r => r.json()));

test('capture bar: a sentence becomes a preview; Approve sets the reminder; an expense; spending question; reject changes nothing', async () => {
  const { page, ctx, errors } = await open();
  await page.fill('#lifeQ', 'remind me at 11pm to lock the door'); await page.press('#lifeQ', 'Enter');
  await page.waitForSelector('.cap-out .tag:has-text("Review before NOVA acts")');
  assert.match(await page.innerText('.cap-out'), /Set a reminder: Remind you "lock the door" at .*23:00 \(Dubai\)/);
  assert.ok(!(await life(page)).reminders.some(r => r.text === 'lock the door'), 'nothing until approved');
  await page.click('button[data-act="lifeApprove"]'); await page.waitForSelector('.cap-reply:has-text("Read back from the database")');
  await page.waitForSelector('.rem-list li:has-text("lock the door")');
  await page.fill('#lifeQ', 'spent 25 dirhams on karak and samosa'); await page.press('#lifeQ', 'Enter');
  await page.waitForSelector('.cap-out:has-text("category: food")'); await page.click('button[data-act="lifeReject"]');
  await page.waitForSelector('.cap-reply:has-text("nothing was changed")');
  assert.ok(!(await life(page)).money.recent.some(e => /karak and samosa/.test(e.note || '')));
  await page.fill('#lifeQ', 'how much did I spend this month'); await page.press('#lifeQ', 'Enter');
  await page.waitForSelector('.cap-reply:has-text("This month you spent AED")');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('reminders form, cancel; habits: add, check in today (streak), undo the check; money: add with automatic category, budget, delete', async () => {
  const { page, ctx, errors } = await open();
  await page.fill('#remText', 'stretch'); await page.fill('#remWhen', 'in 45 minutes'); await page.click('#remForm button');
  await page.waitForSelector('.rem-list li:has-text("stretch")');
  await page.fill('#remWhen', 'whenever'); await page.fill('#remText', 'x'); await page.click('#remForm button'); await page.waitForSelector('.toast:has-text("could not understand that time")');
  await page.locator('.rem-list li', { hasText: 'stretch' }).locator('button[data-act="remCancel"]').click();
  await page.waitForFunction(() => !/stretch/.test(document.querySelector('.life-rem').textContent));
  // habits
  await page.fill('#habName', 'Drink water'); await page.click('#habForm button'); await page.waitForSelector('.hab:has-text("Drink water")');
  const hab = page.locator('.hab', { hasText: 'Drink water' });
  await hab.locator('.hab-check').click(); await page.waitForSelector('.hab.done:has-text("Drink water") .hab-check[aria-pressed="true"]');
  assert.match(await page.locator('.hab', { hasText: 'Drink water' }).locator('.streak').innerText(), /^1\s+day streak/);
  assert.equal(await page.locator('.hab', { hasText: 'Drink water' }).locator('.heat i.on').count(), 1);
  await page.locator('.hab', { hasText: 'Drink water' }).locator('.hab-check').click(); await page.waitForSelector('.hab:not(.done):has-text("Drink water")');
  assert.ok(await page.locator('.hab', { hasText: 'Read 10 pages' }).locator('.heat i.on').count() > 20, 'demo history is shown');
  // money
  const before = (await life(page)).money.total;
  await page.fill('#expAmt', '12.5'); await page.fill('#expNote', 'Metro top-up'); await page.click('#expForm button');
  await page.waitForSelector('.toast:has-text("Recorded AED 12.50 (Transport)")');
  assert.equal((await life(page)).money.total, before + 1250);
  await page.fill('#budAmt', '800'); await page.click('button[data-act="budSave"]'); await page.waitForSelector('.budget:has-text("of AED 800 used")');
  assert.match(await page.innerText('.budget'), /of AED 800 used/);
  await page.click('.life-money summary'); await page.locator('.exp-list li', { hasText: 'Metro top-up' }).first().locator('button[data-act="expDelete"]').click();
  await page.waitForFunction(b => fetch('/api/life').then(r => r.json()).then(j => j.money.total === b), before);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('voice phrases reach the same tools; reminders arrive as notifications when due', async () => {
  const { page, ctx, errors } = await open();
  const r = await page.evaluate(() => J.voice.command('how much did I spend this month').then(o => typeof o === 'string' ? o : o.text));
  assert.match(r, /This month you spent AED/);
  await page.evaluate(() => fetch('/api/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NOVA-CSRF': NOVA.csrf }, body: JSON.stringify({ text: 'tea time', dueAt: Date.now() + 1500 }) }));
  await new Promise(res => setTimeout(res, 1700)); await app.scheduler.tick();
  await page.evaluate(() => NOVA.daily.poll(false));
  await page.waitForFunction(() => NOVA.daily.list.some(n => n.title === 'Reminder: tea time'));
  assert.ok((await page.evaluate(() => window.__notes)).some(n => /Reminder: tea time/.test(n)), 'browser pop-up');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

for (const width of [1440, 768, 390]) {
  test('layout and axe at ' + width + ' px: Life Tracker with a preview open', async () => {
    const { checkLayout } = require('./layout-check');
    const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
    const { page, ctx, errors } = await open({ width, height: width === 390 ? 844 : 900 });
    await page.fill('#lifeQ', 'remind me tomorrow at 7am to pack the gym bag'); await page.press('#lifeQ', 'Enter'); await page.waitForSelector('.cap-out');
    await page.click('.life-money summary'); await page.waitForTimeout(400);
    const problems = (await page.evaluate(checkLayout)).map(x => 'life: ' + x);
    await page.evaluate(src => (0, eval)(src), AXE);
    const r = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
    r.violations.filter(x => x.impact === 'serious' || x.impact === 'critical').forEach(x => problems.push('axe ' + x.id + ': ' + x.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')));
    await page.screenshot({ path: path.join(__dirname, 'screenshots', width + '-nova-life.png'), fullPage: true }).catch(() => {});
    await page.click('button[data-act="lifeReject"]');
    assert.deepEqual(problems, [], problems.join('\n')); assert.deepEqual(clean(errors), []);
    await ctx.close();
  });
}

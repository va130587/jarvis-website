// Focus and Planner + Weekly Insights in a real browser, on the demo data (scripts/demo.js seed).
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
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-focus-')), 'f.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'demo@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  seed(app); base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); app.server.closeAllConnections(); await app.close(); });
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets|fonts\.googleapis/.test(e));
async function open(opts) {
  const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'demo@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  return o;
}
const stopAll = page => page.evaluate(() => fetch('/api/focus').then(r => r.json()).then(s => s.running && fetch('/api/focus/' + s.running.id + '/stop', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NOVA-CSRF': NOVA.csrf }, body: '{}' })));

test('planner: a timeline with reasons and lunch; change hours; set an estimate; save; focus on a block', async () => {
  const { page, ctx, errors } = await open();
  await page.evaluate(() => { location.hash = 'focus'; }); await page.waitForSelector('.timeline-plan .blk');
  const text = await page.innerText('.plan');
  assert.match(text, /Update CV with the data project/); assert.match(text, /Overdue/); assert.match(text, /estimated/);
  assert.match(text, /Submit the scholarship form/, 'promises are planned too');
  // the working hours change the plan
  await page.fill('#pEnd', '11:00'); await page.dispatchEvent('#pEnd', 'change');
  await page.waitForFunction(() => /Does not fit/i.test(document.querySelector('.plan').textContent));
  await page.fill('#pEnd', '18:00'); await page.dispatchEvent('#pEnd', 'change');
  await page.waitForFunction(() => !/Does not fit/i.test(document.querySelector('.plan').textContent));
  // set an estimate for a guessed block
  const setBtn = page.locator('button[data-act="fEstimate"]', { hasText: 'Set time' }).first();
  const title = await setBtn.getAttribute('data-title');
  await setBtn.click(); await page.fill('#formDialog input', '45'); await page.click('#formDialog button[type="submit"]');
  await page.waitForFunction(t => [...document.querySelectorAll('.blk')].some(b => b.textContent.includes(t) && /45m(?! \(estimated\))/.test(b.textContent)), title);
  await page.click('button[data-act="fSavePlan"]'); await page.waitForSelector('text=/Saved at/');
  // focus on the first block: timer, orb, top-bar chip
  await page.locator('button[data-act="fBlock"]').first().click();
  await page.waitForSelector('.focus-card.running #focusTime');
  assert.match(await page.innerText('#focusTime'), /^\d\d:\d\d$/);
  await page.waitForFunction(() => document.body.getAttribute('data-nova') === 'focusing');
  await page.evaluate(() => { location.hash = 'insights'; }); await page.waitForSelector('#focusChip');
  assert.match(await page.innerText('#focusChip'), /\d\d:\d\d/);
  await page.click('#focusChip'); await page.waitForFunction(() => J.current() === 'focus');
  await page.click('button[data-act="fStop"]'); await page.waitForSelector('.focus-last:has-text("Stopped")');
  assert.equal(await page.locator('#focusChip').count(), 0);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('focus timer end: told by toast, voice and pop-up; recorded as completed; marking the task done still asks for approval', async () => {
  const { page, ctx, errors } = await open();
  await stopAll(page);
  await page.evaluate(() => { location.hash = 'focus'; }); await page.waitForSelector('#fTask');
  const opt = await page.$$eval('#fTask option', o => o.filter(x => x.value).map(x => ({ v: x.value, t: x.textContent })));
  await page.selectOption('#fTask', opt[0].v); await page.check('input[name="fMin"][value="15"]', { force: true });
  await page.click('button[data-act="fStart"]'); await page.waitForSelector('.focus-card.running');
  await page.waitForFunction(() => NOVA.pending() === 0);                                                    // no refresh on its way that would undo the jump below
  await page.evaluate(() => { window.__notes.length = 0; window.__said.length = 0; NOVA.focus.state.running.endsAt = Date.now() - 1; });   // jump to the end of the session
  await page.waitForSelector('.focus-last:has-text("Well done")');
  assert.ok((await page.evaluate(() => window.__notes)).some(n => /NOVA focus finished/.test(n)));
  assert.ok((await page.evaluate(() => window.__said.join(' '))).includes('Focus session finished'));
  const st = await page.evaluate(() => fetch('/api/focus').then(r => r.json()));
  assert.equal(st.running, null); assert.equal(st.today[0].status, 'completed');
  await page.click('button[data-act="fMarkDone"]'); await page.waitForFunction(() => J.current() === 'chat');
  await page.waitForSelector('.preview'); assert.match(await page.innerText('.preview'), /Complete|done/i);
  await page.click('.preview button:has-text("Reject")');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('weekly insights: reliability, tiles with comparisons, what stands out, two charts with hover, keyboard and table views, read aloud', async () => {
  const { page, ctx, errors } = await open();
  await page.evaluate(() => { location.hash = 'insights'; }); await page.waitForSelector('.chart');
  const t = await page.innerText('main');
  assert.match(t, /Reliability/i); assert.match(t, /promises kept on time/); assert.match(t, /Tasks done/i); assert.match(t, /Focus time/i); assert.match(t, /What stands out/i);
  assert.equal(await page.locator('.chart').count(), 2);
  assert.equal(await page.locator('#chDone .bm').count(), 7);
  await page.hover('#chDone .bm >> nth=0'); await page.waitForSelector('#chDone .tip:not([hidden])');
  assert.match(await page.innerText('#chDone .tip'), /^Mon: \d+ tasks/);
  await page.focus('#chFocus .bm >> nth=0'); await page.waitForSelector('#chFocus .tip:not([hidden])');
  assert.match(await page.getAttribute('#chFocus .bm >> nth=0', 'aria-label'), /^Mon: /);
  await page.click('#chDone summary'); assert.equal(await page.locator('#chDone table tbody tr').count(), 7);
  // numbers on the page match the API
  const api = await page.evaluate(() => fetch('/api/insights').then(r => r.json()));
  assert.ok(t.includes(String(api.totals.done)));
  await page.click('button[data-act="iSpeak"]'); await page.waitForFunction(() => window.__said.length > 0);
  assert.match(await page.evaluate(() => J.voice.command('how was my week').then(o => typeof o === 'string' ? o : o.text)), /tasks? this week|focus/i);
  assert.match(await page.evaluate(() => J.voice.command('plan my day').then(o => typeof o === 'string' ? o : o.text)), /Planned|plan for tomorrow|Nothing is due/);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

for (const width of [1440, 768, 390]) {
  test('layout and axe at ' + width + ' px: planner with a running timer, and insights', async () => {
    const { checkLayout } = require('./layout-check');
    const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
    const { page, ctx, errors } = await open({ width, height: width === 390 ? 844 : 900 });
    await stopAll(page);
    const problems = [], check = async n => (await page.evaluate(checkLayout)).forEach(x => problems.push(n + ': ' + x));
    await page.evaluate(src => (0, eval)(src), AXE);
    const axe = async n => { const r = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
      r.violations.filter(x => x.impact === 'serious' || x.impact === 'critical').forEach(x => problems.push(n + ' axe ' + x.id + ': ' + x.nodes.slice(0, 2).map(nd => nd.target.join(' ')).join(' | '))); };
    await page.evaluate(() => { location.hash = 'focus'; }); await page.waitForSelector('.timeline-plan .blk');
    await page.locator('button[data-act="fBlock"]').first().click(); await page.waitForSelector('.focus-card.running');
    await page.waitForTimeout(400); await check('focus'); await axe('focus');
    await page.screenshot({ path: path.join(__dirname, 'screenshots', width + '-nova-focus.png'), fullPage: true }).catch(() => {});
    await page.evaluate(() => { location.hash = 'insights'; }); await page.waitForSelector('.chart'); await page.waitForTimeout(400);
    await check('insights'); await axe('insights');
    await page.screenshot({ path: path.join(__dirname, 'screenshots', width + '-nova-insights.png'), fullPage: true }).catch(() => {});
    await stopAll(page);
    assert.deepEqual(problems, [], problems.join('\n')); assert.deepEqual(clean(errors), []);
    await ctx.close();
  });
}

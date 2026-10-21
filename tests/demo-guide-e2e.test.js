// The guided demo in the browser: five numbered steps on the dashboard, each ticked when you have really done it, remembered for the account,
// by keyboard, hidden when you say so, absent outside demo mode, and clean at four widths in both themes.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers');
const { checkLayout } = require('./layout-check');
const { createApp } = require('../server');
const { seed, EMAIL } = require('../scripts/demo');

const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
let browser; const apps = [];
test.before(async () => { browser = await H.launch(); });
test.after(async () => { await browser.close(); for (const a of apps) { a.server.closeAllConnections(); await a.close(); } });

async function server(demoMode) {
  const app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-guide-')), 'g.db'), AUTH_MODE: 'dev', OWNER_EMAILS: EMAIL, HOST: '127.0.0.1', PORT: '0', NOVA_DEMO: demoMode === false ? '' : '1', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  apps.push(app); seed(app); return { app, base: 'http://127.0.0.1:' + await app.listen() };
}
async function open(base, opts) {
  const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown'); await o.page.fill('#novaDevEmail', EMAIL); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard'); return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const count = page => page.evaluate(() => document.getElementById('demoCount').textContent);
const saved = app => JSON.parse(app.db.prepare('SELECT demo_steps FROM users').get().demo_steps || '[]');

test('the guide shows five steps, none done; each ticks when you really do it, and it is remembered', async () => {
  const { app, base } = await server(); const { page, ctx, errors } = await open(base);
  await page.waitForSelector('#demoGuide'); assert.equal(await count(page), '0 of 5 done'); assert.equal(await page.locator('.demo-step').count(), 5);
  assert.deepEqual(await page.$$eval('.demo-step b', b => b.map(x => x.textContent)), ['Promise Orbit', 'Day Replay', 'Life Radar', 'Receipt check', '"What happens if"']);
  assert.match(await page.innerText('#demoGuide'), /Everything in this demo is fictional/);
  const done = () => page.$$eval('.demo-step.done b', b => b.map(x => x.textContent));
  // 1 Promise Orbit: show me the dots, then open one
  await page.click('button[data-act="demoOrbit"]'); assert.equal(await page.evaluate(() => document.activeElement.className.includes('odot')), true, 'focus moves to a dot'); assert.deepEqual(await done(), []);
  await page.keyboard.press('Enter'); await page.waitForSelector('.demo-step.done'); await page.waitForSelector('#formDialog[open]'); assert.deepEqual(await done(), ['Promise Orbit']); assert.equal(await count(page), '1 of 5 done');
  assert.match(await page.innerText('.demo-step.done'), /Done/i);                                  // a word, not only a colour or a glyph
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog[open]')); await page.waitForTimeout(400);       // let the page settle after the dot's details close
  // 2 Day Replay: open the page and move the slider
  await page.click('.demo-step a[href="#replay"]'); await page.waitForSelector('#rpTime'); assert.deepEqual(saved(app), ['orbit']);
  await page.focus('#rpTime'); await page.keyboard.press('ArrowLeft'); await page.waitForFunction(() => NOVA.user.demoSteps.includes('replay'));
  // 3 Life Radar: Tab (focus) to a spoke
  await page.evaluate(() => { location.hash = 'insights'; }); await page.waitForSelector('.rd-spoke'); await page.locator('.rd-spoke').first().focus(); await page.waitForFunction(() => NOVA.user.demoSteps.includes('radar'));
  // 4 Receipt check: press "Check a receipt" in ProofLoop (it opens the public page in a new tab)
  await page.evaluate(() => { location.hash = 'proofloop'; }); await page.waitForSelector('a[href="/verify"]');
  const [pop] = await Promise.all([ctx.waitForEvent('page'), page.click('a[href="/verify"]')]); await pop.close(); await page.waitForFunction(() => NOVA.user.demoSteps.includes('receipt'));
  // 5 "What happens if": a preview with an Effects row
  await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg'); await page.fill('#novaMsg', 'add a task to call HR by friday'); await page.click('#novaChatForm button'); await page.waitForSelector('.preview .fx li');
  await page.waitForFunction(() => NOVA.user.demoSteps.includes('effects'));
  await page.waitForTimeout(400); assert.deepEqual(saved(app).sort(), ['effects', 'orbit', 'radar', 'receipt', 'replay']);
  // back on the dashboard: all done, remembered after a reload
  await page.evaluate(() => { location.hash = 'dashboard'; }); await page.waitForSelector('#demoGuide'); assert.equal(await count(page), 'all 5 done'); assert.match(await page.innerText('.demo-all'), /You have seen all five/);
  await page.reload(); await page.waitForFunction(() => window.NOVA && NOVA.user && J.current() === 'dashboard'); await page.waitForSelector('#demoGuide'); assert.equal(await count(page), 'all 5 done');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('"Hide this guide" hides it for good (for this account)', async () => {
  const { app, base } = await server(); const a = await open(base); await a.page.waitForSelector('#demoGuide');
  await a.page.click('button[data-act="demoHide"]'); await a.page.waitForFunction(() => !document.querySelector('#demoGuide')); await a.page.waitForTimeout(300); assert.ok(saved(app).includes('hidden'));
  await a.page.reload(); await a.page.waitForFunction(() => window.NOVA && NOVA.user && J.current() === 'dashboard'); await a.page.waitForTimeout(700); assert.equal(await a.page.locator('#demoGuide').count(), 0); await a.ctx.close();
});

test('outside demo mode there is no guide', async () => {
  const { base } = await server(false); const { page, ctx } = await open(base); await page.waitForTimeout(900); assert.equal(await page.locator('#demoGuide').count(), 0); await ctx.close();
});

test('by keyboard: every step has a link or button you can reach with Tab and press with Enter', async () => {
  const { base } = await server(); const { page, ctx } = await open(base); await page.waitForSelector('#demoGuide');
  const targets = await page.$$eval('.demo-step a, .demo-step button', e => e.length); assert.equal(targets, 5);
  await page.focus('.demo-step:nth-child(3) a'); await page.keyboard.press('Enter'); await page.waitForFunction(() => J.current() === 'insights'); await ctx.close();
});

test('the demo data is alive: Day Replay for yesterday has events at several times of day, and the radar has numbers', async () => {
  const { base } = await server(); const { page, ctx } = await open(base);
  await page.evaluate(() => { location.hash = 'replay'; }); await page.waitForSelector('#rpTime'); await page.click('button[data-act="rpPrev"]'); await page.waitForSelector('.rp-ev');
  const times = await page.$$eval('.rp-time', t => t.map(x => x.textContent.slice(0, 2))); assert.ok(new Set(times).size >= 3, 'times of day: ' + times.join(' ')); assert.ok(times.length >= 5);
  await page.evaluate(() => { location.hash = 'insights'; }); await page.waitForSelector('.rd-svg'); assert.ok(await page.locator('.rd-spoke').count() >= 4); await ctx.close();
});

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1024, 1440]) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': the dashboard with the guide', async () => {
    const { app, base } = await server(); const { page, ctx, errors } = await open(base, { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await page.waitForSelector('#demoGuide'); await page.click('button[data-act="demoOrbit"]'); await page.keyboard.press('Enter'); await page.waitForSelector('.demo-step.done'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(checkLayout), []);
    await page.evaluate(src => (0, eval)(src), AXE);
    const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }));
    const bad = ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | '));
    assert.deepEqual(bad, [], bad.join('\n')); assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

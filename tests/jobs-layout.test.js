// "Jobs for you" at 1440, 768 and 390 px (layout, dialogs, keyboard-only use) and an axe-core accessibility scan.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const F = require('./fixtures/jobs-data');
const { checkLayout } = require('./layout-check');

const NOW = Date.parse('2026-10-15T08:00:00+04:00');
const SHOTS = path.join(__dirname, 'screenshots');
const PROFILE = { name: 'Roshan', degree: 'BSc Computer Science', field: 'Computer Science', university: 'Example University', skills: ['Python', 'SQL', 'Excel', 'Power BI'], titles: ['Data Analyst', 'Software Engineer'], languages: ['English', 'Arabic'], cities: ['Dubai', 'Abu Dhabi'], nationality: 'Indian', visa: 'resident', yearsExp: '0', gradDate: '2026-06' };
const DATA = () => ({ v: 3, profile: Object.assign({}, PROFILE), tasks: [], notes: [], skills: [], wins: [], apps: [], people: [], settings: { voice: true }, rules: [{ id: 'r1', name: 'Data Analyst', keywords: 'Data Analyst', city: 'Dubai', level: 'any', min: 70, notify: true }], alertsReady: true, alertsSeen: F.build().jobs.map(j => j.key) });
const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');

let browser, server;
test.before(async () => {
  if (!process.env.BASE_URL) { server = await H.startServer(); process.env.BASE_URL = server.url; }
  browser = await H.launch();
  fs.mkdirSync(SHOTS, { recursive: true });
});
test.after(async () => { await browser.close(); if (server) server.close(); });

async function open(width, hash) {
  const o = await H.openApp(browser, { now: NOW, data: DATA(), jobs: () => F.build(), width, height: width === 390 ? 844 : 900, hash: hash || 'matches' });
  await o.page.waitForFunction(() => J.jobs.cache());
  await o.page.waitForTimeout(700);
  return o;
}

for (const width of [1440, 768, 390]) {
  test('layout at ' + width + ' px: Jobs for you, tabs, dialogs, digest, settings', async () => {
    const { page, ctx, errors } = await open(width);
    const problems = [], check = async name => { (await page.evaluate(checkLayout)).forEach(x => problems.push(name + ': ' + x)); };
    for (const tab of ['Best matches', 'Stretch', 'New today', 'Closing soon', 'Not eligible']) {
      await page.click('.tab:has-text("' + tab + '")'); await page.waitForTimeout(150);
      await check('matches/' + tab);
      if (tab === 'Best matches') await page.screenshot({ path: path.join(SHOTS, width + '-matches.png'), fullPage: true });
    }
    await page.click('.tab:has-text("Best matches")');
    // dialogs fit the screen
    const fits = async name => { const ok = await page.evaluate(() => { const d = document.getElementById('formDialog').getBoundingClientRect(); return d.right <= innerWidth + 1 && d.left >= -1 && d.height <= innerHeight + 1; }); assert.ok(ok, name + ' dialog fits the screen'); };
    await page.locator('.match-card button:has-text("Why this job?")').first().click(); await page.waitForTimeout(300);
    await fits('why'); await page.screenshot({ path: path.join(SHOTS, width + '-why.png') });
    assert.deepEqual(await page.evaluate(() => { const d = document.querySelector('#formDialog .why'); return d.scrollWidth > d.clientWidth + 1 ? ['why overflows'] : []; }), []);
    await page.keyboard.press('Escape');
    await page.click('button:has-text("Job profile")'); await page.waitForTimeout(300);
    await fits('profile'); await page.keyboard.press('Escape');
    await page.click('button:has-text("Alerts & rules")'); await page.waitForTimeout(300);
    await fits('rules'); await page.keyboard.press('Escape');
    await page.locator('.match-card button:has-text("Save & prepare")').first().click(); await page.waitForTimeout(400);
    await fits('application pack'); await page.screenshot({ path: path.join(SHOTS, width + '-pack.png') }); await page.keyboard.press('Escape');
    for (const v of ['today', 'applications', 'profile', 'settings', 'review']) {
      await page.evaluate(h => { location.hash = h; }, v); await page.waitForTimeout(700);
      await check(v);
      await page.screenshot({ path: path.join(SHOTS, width + '-' + v + '-jobs.png'), fullPage: true });
    }
    assert.deepEqual(problems, [], problems.join('\n'));
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('keyboard only: tabs, filters, Why panel, save, close, all reachable with Tab / Enter / Space / Escape', async () => {
  const { page, ctx, errors } = await open(1440);
  const focusLabel = () => page.evaluate(() => { const e = document.activeElement; return e ? (e.getAttribute('aria-label') || e.textContent || e.id || e.tagName).trim().slice(0, 40) : ''; });
  // Tab until the "Stretch" tab has focus, press Enter
  let found = false;
  for (let i = 0; i < 60 && !found; i++) { await page.keyboard.press('Tab'); found = /^Stretch/.test(await focusLabel()); }
  assert.ok(found, 'Stretch tab is reachable by keyboard');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.querySelector('.tab[aria-pressed="true"]').textContent.trim().split(' ')[0]), 'Stretch');
  assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('tab')), 'focus stays on the tab after it is used');
  // Reach a "Why this job?" button
  found = false;
  for (let i = 0; i < 60 && !found; i++) { await page.keyboard.press('Tab'); found = /^Why this job\?/.test(await focusLabel()); }
  assert.ok(found, 'Why button is reachable by keyboard');
  await page.keyboard.press('Space');
  await page.waitForSelector('#formDialog[open]');
  assert.ok(await page.evaluate(() => document.getElementById('formDialog').contains(document.activeElement) || document.activeElement === document.getElementById('formDialog') || document.activeElement === document.body) );
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('formDialog').open), false);
  // every interactive control on the page has an accessible name
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('main button, main a[href], main select, main input')].filter(e => e.offsetParent && !(e.getAttribute('aria-label') || e.textContent.trim() || (e.id && document.querySelector('label[for="' + e.id + '"]')) || e.getAttribute('title'))).map(e => e.outerHTML.slice(0, 80)));
  assert.deepEqual(unnamed, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

for (const view of ['matches', 'today', 'profile', 'settings', 'applications', 'review']) {
  test('axe-core: no serious or critical issues on ' + view, async () => {
    const { page, ctx } = await open(1440, view);
    if (view === 'applications') { await page.evaluate(() => J.jobs.save(J.matches.sections().best[0])); await page.evaluate(() => J.render(false)); }
    await page.evaluate(src => (0, eval)(src), AXE);
    const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
    const bad = res.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ' (' + v.impact + '): ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ') + ' — ' + (v.nodes[0].failureSummary || '').split('\n')[1]);
    assert.deepEqual(bad, [], bad.join('\n'));
    if (view === 'matches') { // the dialogs too
      await page.locator('.match-card button:has-text("Why this job?")').first().click(); await page.waitForTimeout(300);
      const r2 = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, resultTypes: ['violations'] }));
      const bad2 = r2.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes[0].target.join(' '));
      assert.deepEqual(bad2, [], 'why dialog: ' + bad2.join('\n'));
    }
    await ctx.close();
  });
}

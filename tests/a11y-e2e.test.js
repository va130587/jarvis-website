// Accessibility beyond the automatic checks: one h1 and no skipped heading levels on every page, landmarks, axe "best-practice" rules too,
// a skip link on every page that really works, focus on the page title after every page change (announced politely),
// and the high-contrast and larger-text options (125%, 150%): remembered, effective, and no broken layout at any width.
// Real screen readers (NVDA, VoiceOver) are UNVERIFIED here: see docs/ACCESSIBILITY_CHECKLIST.md.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers');
const { checkLayout } = require('./layout-check');
const { createApp } = require('../server');
const { seed } = require('../scripts/demo');

const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const PAGES = ['dashboard', 'briefing', 'chat', 'voice', 'email', 'hub', 'focus', 'life', 'proofloop', 'whatif', 'insights', 'replay', 'automation', 'identity', 'memory', 'knowledge', 'usage', 'connections', 'security', 'support'];
const TITLES = { dashboard: 'Dashboard', briefing: 'Daily Briefing', chat: 'NOVA Chat', voice: 'Voice Assistant', email: 'Smart Email', hub: 'Tasks and Calendar', focus: 'Focus and Planner', life: 'Life Tracker', proofloop: 'ProofLoop', whatif: 'What if I say yes?', insights: 'Weekly Insights', replay: 'Day Replay', automation: 'Automation Centre', identity: 'Personal Identity', memory: 'Memory Vault', knowledge: 'Knowledge Base', usage: 'AI Usage and Cost', connections: 'Connected Apps', security: 'Security and Settings', support: 'Help' };
let browser, app, base;
test.before(async () => {
  browser = await H.launch();
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-a11y-')), 'a.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'demo@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  seed(app); base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); app.server.closeAllConnections(); await app.close(); });
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const initFor = (theme, extra) => (theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : '') + (extra || '');

async function open(opts) {
  const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown'); await o.page.fill('#novaDevEmail', 'demo@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard'); return o;
}
const goto = async (page, p) => { await page.evaluate(x => { location.hash = x; }, p); await page.waitForFunction(x => J.current() === x, p); await page.waitForFunction(() => !document.querySelector('#main .loading')); await page.waitForTimeout(350); };
const runAxe = async (page, tags) => { await page.evaluate(src => { if (!window.axe) (0, eval)(src); }, AXE); return page.evaluate(t => axe.run(document, { runOnly: { type: 'tag', values: t }, resultTypes: ['violations'] }), tags); };
const brief = v => v.map(x => x.id + ': ' + x.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | '));
const BEST = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

for (const width of [1280, 390]) for (const theme of ['dark', 'light']) {
  test('structure and axe best-practice at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': every page has one h1, no skipped levels, one main landmark, and no axe violations', async () => {
    const { page, ctx, errors } = await open({ width, height: 900, init: initFor(theme) });
    for (const p of PAGES) {
      await goto(page, p);
      const s = await page.evaluate(() => {
        const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(h => h.getClientRects().length).map(h => +h.tagName[1]), jumps = []; let prev = 0; hs.forEach(l => { if (prev && l > prev + 1) jumps.push(prev + '->' + l); prev = l; });
        return { h1: hs.filter(x => x === 1).length, first: hs[0], jumps, main: document.querySelectorAll('main').length, banner: document.querySelectorAll('body > .app header, header.topbar').length > 0, nav: [...document.querySelectorAll('nav')].filter(n => n.getClientRects().length).map(n => n.getAttribute('aria-label')) };
      });
      assert.equal(s.h1, 1, p + ': one h1'); assert.equal(s.first, 1, p + ': the first heading is the h1'); assert.deepEqual(s.jumps, [], p + ': no skipped heading levels'); assert.equal(s.main, 1, p + ': one main landmark');
      assert.ok(s.nav.length >= 1 && s.nav.every(Boolean), p + ': navigation landmarks are named: ' + JSON.stringify(s.nav));
      const bad = brief((await runAxe(page, BEST)).violations); assert.deepEqual(bad, [], p + ': ' + bad.join(' ; '));
    }
    assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

test('the skip link is the first stop on every page, shows itself, and moves focus to the content', async () => {
  const { page, ctx } = await open({ width: 1024, height: 800 });
  for (const p of PAGES) {
    await page.evaluate(x => { location.hash = x; }, p); await page.reload(); await page.waitForFunction(x => window.NOVA && NOVA.user && window.J && J.current() === x, p); await page.waitForTimeout(500);       // a fresh load: the first Tab starts at the top
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'skipLink', p + ': the skip link is the first Tab stop');
    const r = await page.evaluate(() => { const b = document.getElementById('skipLink').getBoundingClientRect(); return { top: b.top, w: b.width, h: b.height }; }); assert.ok(r.top >= 0 && r.w > 40 && r.h > 20, p + ': it is visible when focused: ' + JSON.stringify(r));
    await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => document.activeElement.id), 'main', p + ': Enter moves focus to the content');
    await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => !document.querySelector('aside.side').contains(document.activeElement)), p + ': the next Tab is past the menu (in the content, or after it when the page has nothing to press)');
  }
  await ctx.close();
});

test('the public pages have a skip link, a main landmark and one h1; the setup page too', async () => {
  const { page, ctx } = await open({ width: 800, height: 700 });
  const v = await ctx.newPage(); await v.goto(base + '/verify'); await v.keyboard.press('Tab'); assert.equal(await v.evaluate(() => document.activeElement.className), 'skip-link'); await v.keyboard.press('Enter'); assert.equal(await v.evaluate(() => document.activeElement.id), 'main');
  assert.equal(await v.evaluate(() => [document.querySelectorAll('main').length, document.querySelectorAll('h1').length].join()), '1,1'); assert.deepEqual(brief((await runAxe(v, BEST)).violations), []);
  const setup = fs.readFileSync(path.join(__dirname, '..', 'setup.html'), 'utf8'); assert.match(setup, /<a class="skip-link" href="#main">/); assert.equal((setup.match(/<main /g) || []).length, 1); assert.equal((setup.match(/<h1>/g) || []).length, 1);
  await ctx.close();
});

test('after every page change focus is on the page title and the page is announced politely; redraws do not move focus', async () => {
  const { page, ctx } = await open({ width: 1280, height: 900 });
  assert.equal(await page.getAttribute('#navAnnounce', 'aria-live'), 'polite'); assert.equal(await page.getAttribute('#navAnnounce', 'role'), 'status');
  for (const p of PAGES.slice(1)) {
    await page.evaluate(x => { location.hash = x; }, p); await page.waitForFunction(x => J.current() === x, p); await page.waitForTimeout(700);
    const f = await page.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, inMain: !!a.closest('main'), isH1: a === document.querySelector('main h1'), say: document.getElementById('navAnnounce').textContent }; });
    assert.equal(f.isH1, true, p + ': focus is on the h1 (' + f.tag + ')'); assert.equal(f.say, TITLES[p] + ' page', p);
  }
  // by keyboard: a menu link and Enter
  await page.evaluate(() => { location.hash = 'dashboard'; }); await page.waitForFunction(() => J.current() === 'dashboard'); await page.focus('.nav a[data-view="memory"]'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => J.current() === 'memory'); await page.waitForTimeout(600); assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('main h1')), true); assert.equal(await page.innerText('#navAnnounce'), 'Memory Vault page');
  // a redraw keeps the focus where it was (typing in the Chat box is not interrupted)
  await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg'); await page.waitForTimeout(600); await page.focus('#novaMsg'); await page.keyboard.type('hello'); await page.evaluate(() => J.render(false)); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'novaMsg'); assert.equal(await page.inputValue('#novaMsg'), 'hello');
  await ctx.close();
});

test('contrast and text size options: next to the theme, by keyboard, remembered, applied before the page shows, and they really change the look', async () => {
  const { page, ctx, errors } = await open({ width: 1280, height: 900 }); await goto(page, 'security');
  assert.ok(await page.locator('#themePanel').count() && await page.locator('#accessPanel').count()); assert.equal(await page.evaluate(() => document.querySelector('#themePanel').nextElementSibling.id), 'accessPanel', 'right next to the theme');
  assert.deepEqual(await page.$$eval('#accessPanel [role="radiogroup"]', g => g.map(x => x.getAttribute('aria-labelledby'))), ['contrastLabel', 'textLabel']);
  assert.equal(await page.$$eval('#accessPanel button[data-act="novaText"]', b => b.map(x => x.getAttribute('aria-checked')).join()), 'true,false,false');
  const fs0 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#accessPanel .small-text')).fontSize));
  await page.focus('#accessPanel button[data-act="novaText"][data-id="150"]'); await page.keyboard.press('Enter'); await page.waitForFunction(() => document.documentElement.getAttribute('data-text') === '150');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-id')), '150', 'focus stays on the choice'); assert.equal(await page.getAttribute('#accessPanel button[data-id="150"]', 'aria-checked'), 'true');
  assert.ok(Math.abs(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#accessPanel .small-text')).fontSize)) - fs0 * 1.5) < 0.6, 'text is 150%');
  await page.click('#accessPanel button[data-act="novaText"][data-id="125"]'); assert.ok(Math.abs(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#accessPanel .small-text')).fontSize)) - fs0 * 1.25) < 0.6, 'text is 125%');
  await page.click('#accessPanel button[data-act="novaContrast"][data-id="high"]'); await page.waitForFunction(() => document.documentElement.getAttribute('data-contrast') === 'high');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).color), 'rgb(255, 255, 255)', 'high contrast in Deep Space: white text');
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('nova.contrast'), localStorage.getItem('nova.text')]), ['high', '125']);
  await page.reload(); await page.waitForFunction(() => window.NOVA && NOVA.user); assert.deepEqual(await page.evaluate(() => [document.documentElement.getAttribute('data-contrast'), document.documentElement.getAttribute('data-text')]), ['high', '125'], 'remembered after a reload');
  assert.match(await page.evaluate(() => document.querySelector('script[src="boot.js"]').outerHTML), /boot\.js/); assert.match(fs.readFileSync(path.join(__dirname, '..', 'boot.js'), 'utf8'), /nova\.contrast[\s\S]*nova\.text/, 'boot.js applies them before the first paint');
  await goto(page, 'security'); await page.click('#themePanel button[data-id="light"]'); assert.equal(await page.evaluate(() => getComputedStyle(document.body).color), 'rgb(0, 0, 0)', 'high contrast in Daylight: black text');
  await page.click('#accessPanel button[data-act="novaContrast"][data-id="standard"]'); await page.click('#accessPanel button[data-act="novaText"][data-id="100"]'); await page.click('#themePanel button[data-id="dark"]');
  assert.deepEqual(await page.evaluate(() => [document.documentElement.getAttribute('data-contrast'), document.documentElement.getAttribute('data-text')]), [null, null]); assert.deepEqual(clean(errors), []); await ctx.close();
});

for (const theme of ['dark', 'light']) {
  test('high contrast reaches the strictest text contrast (7:1) on every page in ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ' at 390 px', async () => {
    const { page, ctx } = await open({ width: 390, height: 844, init: initFor(theme, "localStorage.setItem('nova.contrast', 'high');") });
    for (const p of PAGES) { await goto(page, p); const bad = brief((await runAxe(page, ['wcag2aaa'])).violations.filter(v => v.id === 'color-contrast-enhanced')); assert.deepEqual(bad, [], p + ': ' + bad.join(' ; ')); }
    await ctx.close();
  });
  test('150% text on a phone in ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': no page breaks its layout', async () => {
    const { page, ctx, errors } = await open({ width: 390, height: 844, init: initFor(theme, "localStorage.setItem('nova.text', '150');") });
    for (const p of PAGES) { await goto(page, p); assert.deepEqual(await page.evaluate(checkLayout), [], p); }
    assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

for (const text of ['125', '150']) for (const theme of ['dark', 'light']) for (const width of [390, 768, 1024, 1440]) {
  test('text ' + text + '% (and high contrast) at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': key pages keep their layout and pass axe', async () => {
    const { page, ctx, errors } = await open({ width, height: 900, init: initFor(theme, "localStorage.setItem('nova.text', '" + text + "'); localStorage.setItem('nova.contrast', 'high');") });
    for (const p of ['dashboard', 'focus', 'life', 'proofloop', 'usage', 'security']) {
      await goto(page, p); assert.deepEqual(await page.evaluate(checkLayout), [], p);
      const bad = brief((await runAxe(page, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])).violations.filter(v => v.impact === 'serious' || v.impact === 'critical')); assert.deepEqual(bad, [], p + ': ' + bad.join(' ; '));
    }
    assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

test('the public receipt page follows the options too: 150% text and high contrast, no broken layout, strictest contrast', async () => {
  const { ctx } = await open({ width: 390, height: 800 });
  for (const theme of ['dark', 'light']) { const v = await ctx.newPage(); await v.setViewportSize({ width: 390, height: 800 }); await v.addInitScript(initFor(theme, "localStorage.setItem('nova.text', '150'); localStorage.setItem('nova.contrast', 'high');")); await v.goto(base + '/verify');
    assert.deepEqual(await v.evaluate(checkLayout), [], theme); assert.deepEqual(brief((await runAxe(v, ['wcag2aaa'])).violations.filter(x => x.id === 'color-contrast-enhanced')), [], theme); await v.close(); }
  await ctx.close();
});

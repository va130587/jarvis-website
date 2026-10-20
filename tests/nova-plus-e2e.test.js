// Knowledge Base page, the Ctrl+K command palette, and installing NOVA (manifest + service worker, offline shell) in a real browser.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers');
const { boot, closeAll } = require('./server-helpers');

let browser, srv;
test.before(async () => { browser = await H.launch(); srv = await boot({ NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }); });
test.after(async () => { await browser.close(); await closeAll(); });
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets|fonts\.googleapis/.test(e));
async function open(opts) {
  const o = await H.openApp(browser, Object.assign({ base: srv.base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'roshan@example.com'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  return o;
}
const post = (page, p, b) => page.evaluate(([u, body]) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NOVA-CSRF': NOVA.csrf }, body: JSON.stringify(body || {}) }).then(r => r.json()), [p, b]);

test('Knowledge Base: add by typing and by file, ask, cited answer with highlighted source, open, delete; honest when nothing matches', async () => {
  const { page, ctx, errors } = await open();
  await page.evaluate(() => { location.hash = 'knowledge'; }); await page.waitForSelector('#kbQ');
  assert.match(await page.innerText('main'), /answers only from them and shows the exact passage/);
  await page.fill('#kbTitle', 'Gym membership'); await page.fill('#kbText', '# Membership\nThe gym membership renews on 1 December and costs AED 199 per month.\n\n# Classes\nYoga is on Tuesday at 7 pm.');
  await page.click('#kbAddForm button[type="submit"]'); await page.waitForSelector('.kb-docs li:has-text("Gym membership")');
  // a file
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-')), f = path.join(dir, 'library-rules.md');
  fs.writeFileSync(f, '# Borrowing\nYou can borrow up to six books for three weeks. Late returns cost AED 2 per day.');
  await page.setInputFiles('#kbFile', f); await page.waitForFunction(() => document.getElementById('kbTitle').value === 'library-rules');
  await page.click('#kbAddForm button[type="submit"]'); await page.waitForSelector('.kb-docs li:has-text("library-rules")');
  // ask
  await page.fill('#kbQ', 'how much does the gym cost'); await page.press('#kbQ', 'Enter');
  await page.waitForSelector('.kb-answer:not(.none)');
  assert.match(await page.innerText('.kb-answer-text'), /From "Gym membership", section "Membership": The gym membership renews on 1 December and costs AED 199 per month/);
  assert.ok(await page.locator('.kb-sources mark').count() > 0, 'matched words are highlighted');
  assert.match(await page.innerText('.kb-sources'), /\[1\] Gym membership · Membership · passage 1/);
  await page.fill('#kbQ', 'how many books can I borrow'); await page.press('#kbQ', 'Enter');
  await page.waitForFunction(() => /six books/.test(document.querySelector('.kb-answer-text').textContent));
  await page.fill('#kbQ', 'who won the football match'); await page.press('#kbQ', 'Enter');
  await page.waitForSelector('.kb-answer.none'); assert.match(await page.innerText('.kb-answer'), /found nothing/);
  // open the document, then delete it
  await page.locator('.kb-docs li', { hasText: 'Gym membership' }).locator('button[data-act="kbOpenDoc"]').click();
  await page.waitForSelector('.kb-doc .kb-passage'); assert.equal(await page.locator('.kb-doc .kb-passage').count(), 2);
  await page.locator('.kb-docs li', { hasText: 'Gym membership' }).locator('button[data-act="kbDelete"]').click();
  await page.click('#confirmYes'); await page.waitForFunction(() => !/Gym membership/.test(document.querySelector('.kb-docs') ? document.querySelector('.kb-docs').textContent : ''));
  // samples
  await page.click('button[data-act="kbDemoOn"]'); await page.waitForSelector('.kb-docs li:has-text("(demo)")');
  assert.match(await page.evaluate(() => J.voice.command('what do my notes say about the visa renewal').then(o => typeof o === 'string' ? o : o.text)), /30 days before expiry/);
  await page.click('button[data-act="kbDemoOff"]'); await page.waitForFunction(() => !/\(demo\)/.test(document.querySelector('main').textContent));
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('command palette: Ctrl+K anywhere, search across your data, keyboard only, pages and actions, "> ask NOVA", Escape returns focus', async () => {
  const { page, ctx, errors } = await open();
  await post(page, '/api/kb/demo'); await post(page, '/api/email/demo');
  await page.evaluate(() => fetch('/api/memories', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NOVA-CSRF': NOVA.csrf }, body: JSON.stringify({ text: 'My visa expires in March' }) }));
  await page.focus('#palBtn'); await page.keyboard.press('Control+k');
  await page.waitForSelector('#novaPalette:not([hidden])'); assert.equal(await page.evaluate(() => document.activeElement.id), 'palQ');
  assert.equal(await page.getAttribute('#novaPalette .palette', 'role'), 'dialog');
  await page.keyboard.type('visa');
  await page.waitForFunction(() => document.querySelectorAll('#palList li .pk').length && [...document.querySelectorAll('#palList .pk')].some(e => /Document/.test(e.textContent)));
  const kinds = await page.$$eval('#palList .pk', e => e.map(x => x.textContent));
  assert.ok(kinds.includes('Document') && kinds.includes('Memory'), kinds.join());
  await page.keyboard.press('ArrowDown'); assert.equal(await page.getAttribute('#palList li.on', 'id'), 'pal1');
  assert.equal(await page.getAttribute('#palQ', 'aria-activedescendant'), 'pal1');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => J.current() !== 'dashboard');
  // pages
  await page.keyboard.press('Control+k'); await page.keyboard.type('automation'); await page.waitForSelector('#palList li.on:has-text("Automation Centre")');
  await page.keyboard.press('Enter'); await page.waitForFunction(() => J.current() === 'automation');
  // ask NOVA with ">"
  await page.keyboard.press('Control+k'); await page.keyboard.type('> what time is it'); await page.waitForSelector('#palList li.on:has-text("Ask NOVA")');
  await page.keyboard.press('Enter'); await page.waitForFunction(() => J.current() === 'chat');
  await page.waitForSelector('.msg.bot:last-child .text:has-text("Dubai")');
  // escape returns focus; clicking outside closes
  await page.focus('#palBtn'); await page.keyboard.press('Control+k'); await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('#novaPalette'), true); assert.equal(await page.evaluate(() => document.activeElement.id), 'palBtn');
  await page.click('#palBtn'); await page.mouse.click(5, 5); assert.equal(await page.isHidden('#novaPalette'), true);
  // nothing found
  await page.keyboard.press('Control+k'); await page.keyboard.type('zzqqxx'); await page.waitForTimeout(400);
  assert.deepEqual(await page.$$eval('#palList .pk', e => [...new Set(e.map(x => x.textContent))]), ['Action'], 'no data matches; only "ask" actions are offered'); await page.keyboard.press('Escape');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('install: manifest linked, Security explains how to install, the service worker caches the shell and NOVA still opens offline', async () => {
  const { page, ctx, errors } = await open({ init: 'window.__allowSW = true;' });
  await page.evaluate(() => { location.hash = 'security'; }); await page.waitForSelector('#installPanel');
  assert.match(await page.innerText('#installPanel'), /Install NOVA as an app/i); assert.match(await page.innerText('#installPanel'), /Add to Home Screen/);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller || false, null, { timeout: 15000 }).catch(() => null);
  const reg = await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => !!r && !!(r.active || r.installing || r.waiting)));
  assert.equal(reg, true, 'service worker registered');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.J && document.title.includes('NOVA'));
  assert.ok(await page.locator('#main').count(), 'the app shell opens without a network');
  await ctx.setOffline(false);
  assert.deepEqual(clean(errors).filter(e => !/fetch|network|offline/i.test(e)), []); await ctx.close();
});

for (const width of [1440, 768, 390]) {
  test('layout and axe at ' + width + ' px: Knowledge Base with an answer, and the palette', async () => {
    const { checkLayout } = require('./layout-check');
    const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
    const { page, ctx, errors } = await open({ width, height: width === 390 ? 844 : 900 });
    await post(page, '/api/kb/demo');
    await page.evaluate(() => { location.hash = 'knowledge'; }); await page.waitForSelector('#kbQ');
    await page.fill('#kbQ', 'when should I renew my visa'); await page.press('#kbQ', 'Enter'); await page.waitForSelector('.kb-answer');
    await page.locator('button[data-act="kbOpenDoc"]').first().click(); await page.waitForSelector('.kb-doc');
    const problems = [], check = async n => (await page.evaluate(checkLayout)).forEach(x => problems.push(n + ': ' + x));
    await page.evaluate(src => (0, eval)(src), AXE);
    const axe = async n => { const r = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
      r.violations.filter(x => x.impact === 'serious' || x.impact === 'critical').forEach(x => problems.push(n + ' axe ' + x.id + ': ' + x.nodes.slice(0, 2).map(nd => nd.target.join(' ')).join(' | '))); };
    await page.waitForTimeout(300); await check('knowledge'); await axe('knowledge');
    await page.screenshot({ path: path.join(__dirname, 'screenshots', width + '-nova-knowledge.png'), fullPage: true }).catch(() => {});
    await page.keyboard.press('Control+k'); await page.keyboard.type('visa'); await page.waitForTimeout(500);
    await check('palette'); await axe('palette');
    await page.screenshot({ path: path.join(__dirname, 'screenshots', width + '-nova-palette.png') }).catch(() => {});
    await page.keyboard.press('Escape');
    await page.evaluate(() => { location.hash = 'security'; }); await page.waitForSelector('#installPanel'); await check('security'); await axe('security');
    assert.deepEqual(problems, [], problems.join('\n')); assert.deepEqual(clean(errors), []);
    await post(page, '/api/kb/demo/remove'); await ctx.close();
  });
}

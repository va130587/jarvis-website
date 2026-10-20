// Stress: 200 tasks, 200 e-mails, 100 documents, 100 notifications, with long Arabic titles and emoji. Every page must stay
// fast (shown within 2 seconds), readable (no overflow at 390 and 1440 px), keep right-to-left text in its own direction,
// and produce no console errors.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers');
const { checkLayout } = require('./layout-check');
const { createApp } = require('../server');

const AR = 'مراجعة طلب التأشيرة وتجديد الإقامة قبل نهاية الشهر مع جميع المستندات المطلوبة';
const EMOJI = '🚀 Launch prep ✅ check 📅 dates 🎉';
let browser, app, base;
test.before(async () => {
  browser = await H.launch();
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-stress-')), 's.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'load@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  const db = app.db, now = Date.now();
  db.prepare("INSERT INTO users (email, display_name, created_at) VALUES ('load@nova.local', 'Roshan', ?)").run(now);
  db.exec('BEGIN');
  for (let i = 0; i < 200; i++) {
    const title = i % 10 === 0 ? AR + ' ' + i : i % 10 === 1 ? EMOJI + ' ' + i : 'Task number ' + i + ' with a fairly long title that keeps going to test wrapping in narrow layouts';
    db.prepare("INSERT INTO tasks (user_id, title, due, status, created_at) VALUES (1, ?, ?, ?, ?)").run(title, i % 3 ? null : new Date(now + (i - 100) * 86400e3).toISOString().slice(0, 10), i % 4 ? 'open' : 'done', now);
  }
  for (let i = 0; i < 100; i++) db.prepare("INSERT INTO notifications (user_id, kind, title, body, created_at) VALUES (1, 'test', ?, ?, ?)").run((i % 5 ? 'Notice ' : AR.slice(0, 30) + ' ') + i, 'Body ' + i + ' ' + EMOJI, now - i * 1000);
  db.exec('COMMIT');
  app.email.store(1, Array.from({ length: 200 }, (_, i) => ({ id: 'm' + i, fromName: i % 7 ? 'Sender ' + i : 'مرسل عربي ' + i, fromAddr: 's' + i + '@example.com', subject: (i % 7 ? 'Subject ' + i + ' could you confirm by tomorrow?' : AR), snippet: 'Snippet ' + i + ' ' + EMOJI, labels: [], unsubscribe: i % 5 === 0, receivedAt: now - i * 3600e3 })), true);
  for (let i = 0; i < 100; i++) app.kb.add(1, { title: (i % 9 ? 'Document ' + i : AR.slice(0, 40)), text: '# Part ' + i + '\nVisa renewal note ' + i + '. ' + 'Lorem ipsum text. '.repeat(30) + '\n\n# Other\n' + AR });
  base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); app.server.closeAllConnections(); await app.close(); });

for (const width of [390, 1440]) {
  test('large amounts of data at ' + width + ' px: pages stay fast, readable and error-free; Arabic keeps its direction', async () => {
    const { page, ctx, errors } = await H.openApp(browser, { base, hash: '', width, height: width === 390 ? 844 : 900 });
    await page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
    await page.fill('#novaDevEmail', 'load@nova.local'); await page.click('#novaDevForm button');
    await page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
    const problems = [];
    const visit = async (hash, ready) => {
      const t0 = Date.now(); await page.evaluate(h => { location.hash = h; }, hash); await page.waitForSelector(ready, { timeout: 10000 });
      const ms = Date.now() - t0; if (ms > 2000) problems.push(hash + ': took ' + ms + ' ms');
      await page.waitForTimeout(200); (await page.evaluate(checkLayout)).forEach(x => problems.push(hash + ' layout: ' + x));
    };
    await visit('hub', '#main .items .item'); assert.equal(await page.locator('#main .items .item').count(), 200);
    const dir = await page.evaluate(ar => { const el = [...document.querySelectorAll('.item-title')].find(e => e.textContent.startsWith(ar.slice(0, 10))); return el && getComputedStyle(el).unicodeBidi; }, AR);
    assert.equal(dir, 'plaintext', 'Arabic titles keep their own (right-to-left) direction');
    await visit('email', '.mail-btn'); assert.ok(await page.locator('.mail-btn').count() >= 50);
    await page.click('button[data-act="dFilter"][data-id="all"]'); await page.waitForFunction(() => document.querySelectorAll('.mail-btn').length === 200);
    await visit('knowledge', '.kb-docs li'); assert.equal(await page.locator('.kb-docs li').count(), 100);
    await page.fill('#kbQ', 'visa renewal note 42'); await page.press('#kbQ', 'Enter'); await page.waitForSelector('.kb-answer:not(.none)');
    await visit('briefing', '.brief-sec'); await visit('insights', '.chart'); await visit('life', '.life-grid'); await visit('focus', '.plan');
    await page.evaluate(() => NOVA.daily.poll(true)); await page.click('#novaBell'); await page.waitForSelector('#novaNotifs .notif-item');
    assert.equal(await page.locator('#novaNotifs .notif-item').count(), 40, 'the bell shows the newest 40');
    (await page.evaluate(checkLayout)).forEach(x => problems.push('bell layout: ' + x)); await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k'); await page.keyboard.type('Task number 1'); await page.waitForFunction(() => [...document.querySelectorAll('#palList .pk')].some(e => e.textContent === 'Task'));
    await page.keyboard.press('Escape');
    assert.deepEqual(problems, [], problems.join('\n'));
    assert.deepEqual(errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e)), []);
    await ctx.close();
  });
}

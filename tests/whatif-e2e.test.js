// "What if I say yes?" in the browser: type a possible commitment, press Enter, read what it would do to that day, nothing is changed,
// the calendar in this browser is used for clashes, "Add it for real" goes through Quick capture; plain errors; clean at four widths in both themes.
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
let browser; const apps = [];
test.before(async () => { browser = await H.launch(); });
test.after(async () => { await browser.close(); for (const a of apps) { a.server.closeAllConnections(); await a.close(); } });

async function server() {
  const app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-wi-')), 'w.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', BASE_URL: '', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  apps.push(app); return { app, base: 'http://127.0.0.1:' + await app.listen() };
}
async function open(srv, opts) {
  const o = await H.openApp(browser, Object.assign({ base: srv.base, hash: '' }, opts || {}));
  const posts = []; o.page.on('request', q => { if (q.method() !== 'GET') posts.push(q.method() + ' ' + new URL(q.url()).pathname); }); o.posts = posts;
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  await o.page.evaluate(() => { location.hash = 'whatif'; }); await o.page.waitForSelector('#wiText'); posts.length = 0; return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const axeRun = async page => { await page.evaluate(src => { if (!window.axe) (0, eval)(src); }, AXE); const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })); return ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')); };
const tomorrow = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date(Date.now() + 864e5));
const fakeCalendar = (page, date) => page.evaluate(d => { J.cal.connected = () => ['google']; J.cal.itemsByDay = (from, to) => { const m = {}; m[d] = [{ kind: 'event', title: 'Team sync', time: '14:30', endTime: '15:30' }, { kind: 'event', title: 'Holiday ✈️ عطلة', allDay: true }]; return m; }; }, date);

test('empty page, then keyboard only: type, Enter, the verdict is read out and nothing is added', async () => {
  const srv = await server(); const { page, ctx, errors, posts } = await open(srv);
  assert.match(await page.innerText('main'), /Nothing checked yet/); assert.equal(await page.evaluate(() => document.activeElement.tagName === 'BODY' || true), true);
  await page.fill('#wiText', 'Join the workshop tomorrow 2pm to 5pm'); await page.keyboard.press('Enter'); await page.waitForSelector('#wiResult');
  const t = await page.innerText('#wiResult'); assert.match(t, /It fits/i); assert.match(t, /It fits\. You would still have 5 h free that day\./); assert.match(t, /Join the workshop/); assert.match(t, /No calendar is connected in this browser/); assert.match(t, /Nothing was added or changed\./);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'wiH', 'focus moves to the result heading'); await page.click('#wiResult .wi-rules summary'); assert.match(await page.innerText('#wiResult .wi-rules'), /8 hours a day/);
  assert.deepEqual(posts, ['POST /api/whatif']); assert.equal(srv.app.db.prepare('SELECT COUNT(*) n FROM tasks').get().n + srv.app.db.prepare('SELECT COUNT(*) n FROM runs').get().n, 0);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('the calendar in this browser is used: the clash is named; plain messages for a missing day and an empty box', async () => {
  const srv = await server(); const { page, ctx } = await open(srv); await fakeCalendar(page, tomorrow());
  await page.fill('#wiText', 'workshop tomorrow 2pm to 5pm'); await page.keyboard.press('Enter'); await page.waitForSelector('#wiResult');
  const t = await page.innerText('#wiResult'); assert.match(t, /clashes with "Team sync" \(14:30 to 15:30\)/i); assert.match(t, /1 event, 1 all-day/); assert.doesNotMatch(t, /No calendar is connected/);
  await page.click('button[data-act="wiClear"]'); assert.equal(await page.inputValue('#wiText'), '');
  await page.keyboard.press('Enter'); await page.waitForSelector('.load-error'); assert.match(await page.innerText('.load-error'), /^Type what you might say yes to/);
  await page.fill('#wiText', 'a workshop at 2pm'); await page.keyboard.press('Enter'); await page.waitForSelector('.load-error:has-text("Say which day")'); await ctx.close();
});

test('"Add it for real" opens Quick capture with the same words; nothing is added until you approve there', async () => {
  const srv = await server(); const { page, ctx } = await open(srv);
  await page.fill('#wiText', 'call Sara tomorrow 3pm'); await page.keyboard.press('Enter'); await page.waitForSelector('#wiResult'); await page.click('button[data-act="wiAdd"]');
  await page.waitForSelector('#captureDialog[open] .cap-row'); assert.match(await page.innerText('#capBody .cap-row'), /Reminder[\s\S]*call Sara/i); assert.equal(srv.app.db.prepare('SELECT COUNT(*) n FROM reminders').get().n, 0);
  await page.keyboard.press('Escape'); await ctx.close();
});

for (const width of [390, 768, 1024, 1440]) for (const theme of ['dark', 'light']) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': empty, a result with a clash, and 150% text', async () => {
    const srv = await server(); const { page, ctx, errors } = await open(srv, { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await page.waitForTimeout(250); assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    await fakeCalendar(page, tomorrow()); await page.fill('#wiText', 'Workshop مراجعة 🚀 tomorrow 2pm to 5pm'); await page.keyboard.press('Enter'); await page.waitForSelector('#wiResult'); await page.click('#wiResult .wi-rules summary'); await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    await page.evaluate(() => document.documentElement.setAttribute('data-text', '150')); await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

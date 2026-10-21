// Planning around the calendar in the browser: with a calendar in this browser (an imported .ics file) the plan has fixed event blocks
// and tasks are planned around them; with none it says so and the plan is as before; only the planned day's events are sent;
// nothing about the calendar is changed or stored; clean at four widths in both themes.
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
let browser, app, base, T0, R0, DAY, TOMORROW;
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
test.before(async () => {
  browser = await H.launch();
  DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date()); TOMORROW = addDays(DAY, 1);
  T0 = Date.parse(DAY + 'T08:00:00+04:00'); R0 = Date.now(); const now = () => T0 + (Date.now() - R0);
  app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-plancal-')), 'p.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }, { now });
  const db = app.db; db.prepare("INSERT INTO users (email, display_name, created_at) VALUES ('a@nova.local', 'Ayla', 1)").run();
  const t = (title, due, est) => db.prepare("INSERT INTO tasks (user_id, title, due, status, created_at, estimate_min) VALUES (1, ?, ?, 'open', 1, ?)").run(title, due, est);
  t('Prepare the client presentation', DAY, 120); t('Call the bank', addDays(DAY, -3), 30); t('Write the project report', DAY, 60); t('Study for the exam', DAY, 45);
  base = 'http://127.0.0.1:' + await app.listen();
});
test.after(async () => { await browser.close(); app.server.closeAllConnections(); await app.close(); });
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets|fonts\.googleapis/.test(e));
async function open(opts) {
  const o = await H.openApp(browser, Object.assign({ base, hash: '', now: T0 + (Date.now() - R0) }, opts || {}));
  const sent = []; o.page.on('request', q => { if (q.method() !== 'GET') sent.push({ m: q.method(), p: new URL(q.url()).pathname, body: q.postData() }); }); o.sent = sent;
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  sent.length = 0; return o;
}
// Dubai local time on a day -> an .ics UTC stamp (Dubai is UTC+4)
const stamp = (day, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(day + 'T00:00:00Z'); d.setUTCHours(h - 4, m); return d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'; };
const ev = (uid, title, day, a, b) => 'BEGIN:VEVENT\r\nUID:' + uid + '@t\r\nDTSTAMP:20260101T000000Z\r\nDTSTART:' + stamp(day, a) + '\r\nDTEND:' + stamp(day, b) + '\r\nSUMMARY:' + title + '\r\nEND:VEVENT\r\n';
const ICS = () => 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//EN\r\n' + ev('1', 'Stand-up', DAY, '09:00', '09:30') + ev('2', 'Design review', DAY, '11:00', '12:00') + ev('3', 'Dentist مراجعة 🚀', DAY, '17:00', '18:00') + ev('4', 'Tomorrow only meeting', TOMORROW, '10:00', '11:00') +
  'BEGIN:VEVENT\r\nUID:5@t\r\nDTSTAMP:20260101T000000Z\r\nDTSTART;VALUE=DATE:' + DAY.replace(/-/g, '') + '\r\nDTEND;VALUE=DATE:' + addDays(DAY, 1).replace(/-/g, '') + '\r\nSUMMARY:Public holiday\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const importIcs = page => page.evaluate(t => J.cal.importIcs(t, 'work.ics'), ICS());
const goPlan = async page => { await page.evaluate(() => { location.hash = 'focus'; }); await page.waitForSelector('.timeline-plan .blk, .plan .empty'); };
const times = page => page.$$eval('.timeline-plan .blk', l => l.map(x => ({ k: x.className.replace(/.*k-(\w+).*/, '$1'), s: x.querySelector('.blk-time').childNodes[0].textContent.trim(), e: x.querySelector('.blk-time small').textContent.trim(), t: x.querySelector('.blk-body b').textContent })));
const mins = s => +s.slice(0, 2) * 60 + +s.slice(3);

test('no calendar in this browser: the plan says so, has no meetings, and the planner works as before', async () => {
  const { page, ctx, errors, sent } = await open(); await goPlan(page);
  assert.match(await page.innerText('.plan-cal'), /No calendar is connected, so this plan has no meetings in it/); assert.equal(await page.locator('.plan-cal a[href="#settings"]').count(), 1);
  assert.equal(await page.locator('.blk.k-event').count(), 0); assert.ok((await times(page)).some(b => b.t === 'Call the bank'));
  assert.deepEqual(sent.filter(s => /propose/.test(s.p)), [], 'nothing about a calendar was sent'); assert.deepEqual(clean(errors), []); await ctx.close();
});

test('with a calendar: events are fixed blocks, tasks are planned around them, only that day is sent, and nothing about the calendar changes', async () => {
  const { page, ctx, errors, sent } = await open();
  assert.equal((await importIcs(page)).count, 5); const before = await page.evaluate(() => JSON.stringify(J.data.extEvents)); sent.length = 0;
  await goPlan(page); await page.waitForSelector('.blk.k-event');
  const b = await times(page), evs = b.filter(x => x.k === 'event'), work = b.filter(x => x.k === 'task' || x.k === 'promise');
  assert.deepEqual(evs.map(x => [x.t, x.s, x.e]), [['Stand-up', '09:00', '09:30'], ['Design review', '11:00', '12:00'], ['Dentist مراجعة 🚀', '17:00', '18:00']]);
  assert.ok(work.length >= 4); for (const w of work) for (const e of evs) assert.ok(!(mins(w.s) < mins(e.e) && mins(e.s) < mins(w.e)), w.t + ' overlaps ' + e.t);
  assert.match(await page.innerText('.plan-sum'), /Planned around 3 calendar events/); assert.match(await page.innerText('.plan-cal'), /Planned around your calendar\. Events are fixed; NOVA never adds or changes calendar events/);
  assert.equal(await page.locator('.blk.k-event button').count(), 0, 'events cannot be started or edited');
  const prop = sent.filter(s => /\/api\/plan\/propose$/.test(s.p)); assert.ok(prop.length >= 1); const body = JSON.parse(prop[0].body);
  assert.equal(body.day, DAY); assert.deepEqual(body.events.map(e => e.title).sort(), ['Dentist مراجعة 🚀', 'Design review', 'Public holiday', 'Stand-up'], "tomorrow's meeting is not sent"); assert.equal(body.events.find(e => e.title === 'Public holiday').allDay, true);
  assert.ok(sent.every(s => /\/api\/plan(\/propose)?$/.test(s.p) || s.p === '/api/focus'), 'only the plan was requested: ' + JSON.stringify(sent.map(s => s.p)));
  assert.equal(await page.evaluate(() => JSON.stringify(J.data.extEvents)), before, 'the calendar data is untouched');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('saving the plan keeps only busy blocks (no event titles) on the server', async () => {
  const { page, ctx } = await open(); await importIcs(page); await goPlan(page); await page.waitForSelector('.blk.k-event');
  await page.click('button[data-act="fSavePlan"]'); await page.waitForSelector('text=/Saved at/');
  const row = app.db.prepare("SELECT data FROM day_plans WHERE day = ?").get(DAY); assert.ok(row); assert.doesNotMatch(row.data, /Stand-up|Design review|Dentist|Public holiday|مراجعة/); assert.match(row.data, /Busy \(calendar\)/);
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM tasks").get().n, 4, 'no task was created or changed'); await ctx.close();
});

test('if the calendar events cannot be used, the plan still shows, and says so', async () => {
  const { page, ctx } = await open(); await importIcs(page);
  await page.route('**/api/plan/propose', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await goPlan(page); await page.waitForSelector('.plan-cal:has-text("could not be used this time")'); assert.equal(await page.locator('.blk.k-event').count(), 0); assert.ok((await times(page)).length > 2); await ctx.close();
});

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1024, 1440]) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': the plan around calendar events', async () => {
    const { page, ctx, errors } = await open({ width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await importIcs(page); await goPlan(page); await page.waitForSelector('.blk.k-event'); await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(checkLayout), []);
    await page.evaluate(src => (0, eval)(src), AXE);
    const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }));
    const bad = ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | '));
    assert.deepEqual(bad, [], bad.join('\n')); assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

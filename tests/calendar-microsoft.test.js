// Outlook / Microsoft 365 connection, against a fake MSAL.js and an in-memory Microsoft Graph.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const NOW = Date.parse('2026-10-15T08:00:00+04:00'); // Thursday 15 Oct 2026, 8:00 am in Dubai
const CLIENT = '1a2b3c4d-1234-5678-9abc-1234567890ab';
const CLEAN = { v: 3, profile: { name: 'Roshan' }, tasks: [], notes: [], skills: [], wins: [], apps: [], people: [], settings: { voice: true, notify: true } };
// Graph returns times in UTC when asked with Prefer: outlook.timezone="UTC"
const utc = (d, hm) => ({ dateTime: d + 'T' + hm + ':00.0000000', timeZone: 'UTC' });

function graphState() {
  return {
    calendars: [
      { id: 'cal-main', name: 'Calendar', hexColor: '#0078d4', canEdit: true, isDefaultCalendar: true },
      { id: 'cal-shared', name: 'Team (shared)', hexColor: '', canEdit: false, isDefaultCalendar: false }
    ],
    events: {
      'cal-main': [
        { id: 'm-1', subject: 'HR screening call', start: utc('2026-10-15', '06:00'), end: utc('2026-10-15', '06:30'), isAllDay: false, webLink: 'https://outlook.live.com/calendar/item/m-1' },
        { id: 'm-2', subject: 'Company holiday', start: { dateTime: '2026-10-20T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-21T00:00:00.0000000', timeZone: 'UTC' }, isAllDay: true },
        { id: 'm-3', subject: 'Cancelled', start: utc('2026-10-15', '09:00'), end: utc('2026-10-15', '10:00'), isCancelled: true }
      ],
      'cal-shared': [
        { id: 's-1', subject: 'Team stand-up', start: utc('2026-10-16', '05:00'), end: utc('2026-10-16', '05:15'), isAllDay: false }
      ]
    }
  };
}

let browser, server;
test.before(async () => {
  if (!process.env.BASE_URL) { server = await H.startServer(); process.env.BASE_URL = server.url; }
  browser = await H.launch();
});
test.after(async () => { await browser.close(); if (server) server.close(); });

async function open() {
  const graph = graphState();
  const app = await H.openApp(browser, { now: NOW, data: CLEAN, graph, hash: 'settings' });
  return Object.assign(app, { graph });
}
async function connectMs(page) {
  await page.fill('#mClientId', CLIENT);
  await page.click('[data-act="calConnect"][data-id="microsoft"]');
  await page.waitForFunction(() => J.data.cal.microsoft.connected && J.data.cal.microsoft.lastSync > 0);
}
const toast = page => page.textContent('#toast');

test('connect: MSAL setup, scopes, redirect page, events in Dubai time', async () => {
  const { page, errors, ctx } = await open();
  await page.fill('#mClientId', 'abc');
  await page.click('[data-form="calClient"][data-prov="microsoft"] button');
  assert.match(await toast(page), /Application \(client\) ID/);
  await connectMs(page);
  const cfg = await page.evaluate(() => window.__msal.cfg);
  assert.equal(cfg.auth.clientId, CLIENT);
  assert.equal(cfg.auth.authority, 'https://login.microsoftonline.com/common');
  assert.match(cfg.auth.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/redirect\.html$/, 'pop-up returns to the blank redirect page');
  assert.deepEqual(await page.evaluate(() => window.__msal.scopes), ['Calendars.Read', 'User.Read']);
  assert.match(await page.textContent('#cal-microsoft'), /Signed in as roshan@outlook\.com/);
  const evs = await page.evaluate(() => J.data.extEvents.map(e => [e.title, e.allDay, e.date || '', e.start]));
  const hr = evs.find(e => e[0] === 'HR screening call');
  assert.equal(new Date(hr[3]).toISOString(), '2026-10-15T06:00:00.000Z', '06:00 UTC = 10:00 Dubai');
  assert.deepEqual(evs.find(e => e[0] === 'Company holiday').slice(1, 3), [true, '2026-10-20']);
  assert.ok(!evs.some(e => e[0] === 'Cancelled'), 'cancelled events skipped');
  assert.ok(evs.some(e => e[0] === 'Team stand-up'), 'shared calendar loaded');
  await page.evaluate(() => location.hash = 'calendar'); await page.waitForTimeout(250);
  const week = await page.$$eval('main .ev', els => els.map(e => e.textContent));
  assert.ok(week.some(t => /10 am – 10:30 am · Calendar\s*HR screening call/.test(t)));
  assert.ok(week.some(t => /9 am – 9:15 am · Team \(shared\)\s*Team stand-up/.test(t)));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('two-way: create, update, delete via Graph after confirmation; read-only shared calendar', async () => {
  const { page, graph, errors, ctx } = await open();
  await connectMs(page);
  await page.check('input[data-calmode="microsoft"][value="two-way"]');
  await page.waitForFunction(() => /Two-way sync is on/.test(document.getElementById('toast').textContent));
  assert.deepEqual(await page.evaluate(() => window.__msal.scopes), ['Calendars.ReadWrite', 'User.Read']);
  await page.evaluate(() => J.addTask({ title: 'Interview: Junior Developer at Noon', due: '2026-10-19', time: '14:00', kind: 'interview' }));
  await page.click('#calChip'); await H.confirmAndWait(page, /Sent 1 change to Outlook/);
  const ev = graph.events['cal-main'].find(e => /Junior Developer/.test(e.subject));
  assert.deepEqual(ev.start, { dateTime: '2026-10-19T14:00:00', timeZone: 'Arabian Standard Time' });
  assert.deepEqual(ev.end, { dateTime: '2026-10-19T15:00:00', timeZone: 'Arabian Standard Time' });
  const id = await page.evaluate(() => J.data.tasks[0].id);
  await page.evaluate(id => { J.byId(J.data.tasks, id).due = '2026-10-20'; J.commit(); }, id);
  await page.click('#calChip'); await H.confirmAndWait(page, /Sent 1 change/);
  assert.equal(graph.events['cal-main'].find(e => e.id === ev.id).start.dateTime, '2026-10-20T14:00:00');
  assert.ok(graph.calls.includes('PATCH /v1.0/me/events/' + ev.id));
  await page.evaluate(id => J.removeTask(id), id);
  await page.click('#calChip'); await H.confirmAndWait(page, /Sent 1 change/);
  assert.ok(graph.calls.includes('DELETE /v1.0/me/events/' + ev.id));
  // Edit an Outlook event
  await page.evaluate(() => location.hash = 'calendar'); await page.waitForTimeout(250);
  await page.click('.ev.ext >> text=HR screening call');
  await page.fill('#f_title', 'HR screening call (moved)');
  await page.click('#dialogSave'); await H.confirmAndWait(page, /Updated in Outlook/);
  assert.equal(graph.events['cal-main'].find(e => e.id === 'm-1').subject, 'HR screening call (moved)');
  await page.click('.ev.ext >> text=Team stand-up');
  assert.equal(await page.$('#formDialog [data-act="calDelEvent"]'), null, 'shared calendar without edit rights is read-only');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('silent renewal fails -> Reconnect; permission denied; offline; sign-in errors', async () => {
  const { page, graph, ctx } = await open();
  await connectMs(page);
  await page.evaluate(() => { window.__msal.silent = 'fail'; });
  await page.evaluate(() => J.cal.sync('microsoft').catch(e => e.message)).then(m => assert.match(m, /Outlook sign-in has expired/));
  await page.waitForFunction(() => document.getElementById('calChip').textContent === 'Reconnect Outlook');
  await page.click('#calChip');
  await page.waitForFunction(() => /Outlook reconnected/.test(document.getElementById('toast').textContent));
  assert.equal(await page.evaluate(() => window.__msal.logins), 2, 'renewed with a pop-up');
  graph.fail = 403;
  assert.match(await page.evaluate(() => J.cal.sync('microsoft').catch(e => e.message)), /did not give Jarvis permission/);
  graph.fail = 401;
  assert.match(await page.evaluate(() => J.cal.sync('microsoft').catch(e => e.message)), /sign-in has expired/);
  graph.fail = null;
  await ctx.setOffline(true);
  assert.match(await page.evaluate(() => J.cal.sync('microsoft').catch(e => e.message)), /You are offline/);
  await ctx.setOffline(false);
  // Sign-in problems explained with the fix
  const msgs = await page.evaluate(async () => {
    const out = {};
    for (const code of ['AADSTS700016: Application not found', 'AADSTS50011: redirect URI mismatch', 'AADSTS9002326: Cross-origin token redemption is permitted only for the Single-Page Application', 'user_cancelled: User closed the popup']) {
      await J.cal.disconnect('microsoft');
      window.__msal.popupError = code;
      out[code.split(':')[0]] = await J.cal.connect('microsoft').then(() => 'connected', e => e.message);
    }
    window.__msal.popupError = null;
    return out;
  });
  assert.match(msgs.AADSTS700016, /could not find that Application \(client\) ID/);
  assert.match(msgs.AADSTS50011, /redirect URI: http:\/\/127\.0\.0\.1:\d+\/redirect\.html/);
  assert.match(msgs.AADSTS9002326, /must be under "Single-page application"/);
  assert.match(msgs.user_cancelled, /closed before finishing/);
  await ctx.close();
});

test('disconnect clears the Microsoft sign-in and synced events', async () => {
  const { page, ctx } = await open();
  await connectMs(page);
  await page.click('[data-act="calDisconnect"][data-id="microsoft"]');
  assert.match(await page.textContent('#confirmText'), /sign out and remove the synced events/);
  await page.click('#confirmYes');
  await page.waitForFunction(() => !J.data.cal.microsoft.connected);
  assert.equal(await page.evaluate(() => window.__msal.cleared), 1);
  assert.equal(await page.evaluate(() => J.data.extEvents.filter(e => e.src === 'microsoft').length), 0);
  assert.match(await page.textContent('#cal-microsoft'), /Not connected/);
  await ctx.close();
});

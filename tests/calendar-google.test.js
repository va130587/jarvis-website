// Google Calendar connection, against a fake Google sign-in and an in-memory Calendar API.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const ICS = require('../ics.js');

const NOW = Date.parse('2026-10-15T08:00:00+04:00'); // Thursday 15 Oct 2026, 8:00 am in Dubai
const CLIENT = '123456789012-abcdefghijk.apps.googleusercontent.com';
const READ = 'https://www.googleapis.com/auth/calendar.readonly', WRITE = 'https://www.googleapis.com/auth/calendar.events';
const CLEAN = { v: 3, profile: { name: 'Roshan' }, tasks: [], notes: [], skills: [], wins: [], apps: [], people: [], settings: { voice: true, notify: true } };
const at = (d, hm) => ({ dateTime: d + 'T' + hm + ':00+04:00' });

function googleState() {
  return {
    calendars: [
      { id: 'roshan@gmail.com', summary: 'roshan@gmail.com', primary: true, accessRole: 'owner', backgroundColor: '#4285f4', selected: true },
      { id: 'uni@group.calendar.google.com', summary: 'University', accessRole: 'reader', backgroundColor: '#33b679', selected: true },
      { id: 'holidays@group.v.calendar.google.com', summary: 'Holidays in UAE', accessRole: 'reader', backgroundColor: '#ff8800', selected: false }
    ],
    events: {
      'roshan@gmail.com': [
        { id: 'e1', summary: 'Team sync', start: at('2026-10-15', '10:00'), end: at('2026-10-15', '11:00'), htmlLink: 'https://calendar.google.com/event?eid=e1' },
        { id: 'e2', summary: 'Interview with Careem', start: at('2026-10-16', '11:00'), end: at('2026-10-16', '12:00') },
        { id: 'e3', summary: 'Career fair', start: { date: '2026-10-18' }, end: { date: '2026-10-19' } },
        { id: 'e4', summary: 'Late study', start: at('2026-10-17', '22:00'), end: at('2026-10-18', '01:00') },
        { id: 'e5', summary: 'Cancelled thing', status: 'cancelled', start: at('2026-10-15', '12:00'), end: at('2026-10-15', '13:00') }
      ],
      'uni@group.calendar.google.com': [
        { id: 'u1', summary: 'Data Structures lecture', start: at('2026-10-15', '13:00'), end: at('2026-10-15', '14:30') }
      ],
      'holidays@group.v.calendar.google.com': [{ id: 'h1', summary: 'UAE National Day', start: { date: '2026-12-02' }, end: { date: '2026-12-03' } }]
    }
  };
}

let browser, server;
test.before(async () => {
  if (!process.env.BASE_URL) { server = await H.startServer(); process.env.BASE_URL = server.url; }
  browser = await H.launch();
});
test.after(async () => { await browser.close(); if (server) server.close(); });

async function open(extra) {
  const google = googleState();
  const app = await H.openApp(browser, Object.assign({ now: NOW, data: CLEAN, google, hash: 'settings' }, extra || {}));
  return Object.assign(app, { google });
}
async function connectGoogle(page) {
  await page.fill('#gClientId', CLIENT);
  await page.click('[data-act="calConnect"][data-id="google"]');
  await page.waitForFunction(() => J.data.cal.google.connected && J.data.cal.google.lastSync > 0);
}
const toast = page => page.textContent('#toast');
const confirmAndWait = H.confirmAndWait;
const evTitles = page => page.$$eval('main .ev', els => els.map(e => e.textContent));

test('connect (read-only): Client ID checks, scopes, events in week + month views, Today "Next"', async () => {
  const { page, errors, google, ctx } = await open();
  await page.click('[data-act="calConnect"][data-id="google"]');
  assert.match(await toast(page), /Paste your Google OAuth Client ID/);
  await page.fill('#gClientId', 'not-a-client-id');
  await page.click('[data-form="calClient"][data-prov="google"] button');
  assert.match(await toast(page), /should end with "\.apps\.googleusercontent\.com"/);
  await page.fill('#gClientId', CLIENT);
  await page.evaluate(() => J.render(false)); // a screen update must not wipe what you typed
  assert.equal(await page.inputValue('#gClientId'), CLIENT);
  await connectGoogle(page);
  const req = await page.evaluate(() => window.__gis.requests[0]);
  assert.equal(req.client_id, CLIENT);
  assert.equal(req.scope, READ, 'read-only asks for calendar.readonly only');
  assert.equal(req.prompt, 'consent');
  assert.match(await page.textContent('#cal-google'), /Signed in as roshan@gmail\.com/);
  assert.match(await page.textContent('#cal-google'), /Last synced/);
  assert.match(await page.textContent('#cal-google'), /It cannot change anything/);
  const ext = await page.evaluate(() => J.data.extEvents.map(e => e.title).sort());
  assert.deepEqual(ext, ['Career fair', 'Data Structures lecture', 'Interview with Careem', 'Late study', 'Team sync'], 'hidden calendars and cancelled events are not loaded');
  assert.ok(!google.calls.some(c => c.includes('holidays')), 'calendars switched off in Google are not fetched');
  // Week view
  await page.evaluate(() => location.hash = 'calendar'); await page.waitForTimeout(300);
  const week = await evTitles(page);
  assert.ok(week.some(t => /10 am – 11 am · roshan@gmail\.com\s*Team sync/.test(t)), 'timed event with range and calendar');
  assert.ok(week.some(t => /All day.*Career fair/.test(t)), 'all-day event');
  assert.ok(week.some(t => /10 pm – midnight.*Late study/.test(t)) && week.some(t => /Until 1 am.*Late study/.test(t)), 'event crossing midnight shows on both days');
  assert.equal(await page.$eval('.ev.ext', el => getComputedStyle(el).getPropertyValue('--evc').trim()), '#4285f4', 'calendar colour');
  // Pick which calendars to show
  await page.click('[data-act="calToggle"][data-id="google|uni@group.calendar.google.com"]');
  assert.ok(!(await evTitles(page)).some(t => /Data Structures/.test(t)), 'University hidden');
  await page.click('[data-act="calToggle"][data-id="google|uni@group.calendar.google.com"]');
  assert.ok((await evTitles(page)).some(t => /Data Structures/.test(t)), 'University shown again');
  // Month view
  await page.click('[data-act="seg"][data-id="month"]');
  const month = await page.$$eval('.mev', els => els.map(e => e.title));
  assert.ok(month.some(t => /Team sync/.test(t)) && month.some(t => /Career fair/.test(t)));
  await page.click('.mev[title*="Team sync"]');
  assert.match(await page.textContent('#formDialog'), /Thursday 15 October 2026 · 10 am – 11 am/);
  assert.equal(await page.$('#formDialog [data-act="calDelEvent"]'), null, 'read-only access: no delete button');
  await page.keyboard.press('Escape');
  // Today
  await page.evaluate(() => location.hash = 'today'); await page.waitForTimeout(300);
  assert.match(await page.textContent('.next-event'), /Next: Team sync at 10 am · roshan@gmail\.com/);
  assert.match(await page.textContent('.grid-3'), /Team sync/);
  // Tokens are never saved to disk
  const stored = await page.evaluate(() => localStorage.getItem('jarvis.v3'));
  assert.ok(!/tok-\d/.test(stored), 'access token is not in localStorage');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('two-way: switching asks for write permission; tasks are sent only after confirmation', async () => {
  const { page, errors, google, ctx } = await open();
  await connectGoogle(page);
  await page.check('input[data-calmode="google"][value="two-way"]');
  await page.waitForFunction(() => window.__gis.requests.length === 2);
  const req = await page.evaluate(() => window.__gis.requests[1]);
  assert.equal(req.scope, READ + ' ' + WRITE, 'two-way asks for calendar.events too');
  await page.waitForFunction(() => J.data.cal.google.mode === 'two-way');
  assert.match(await page.textContent('#cal-google'), /only after you confirm each change/);
  // Create a task with a time: it waits in the outbox until confirmed.
  await page.evaluate(() => location.hash = 'tasks'); await page.waitForTimeout(200);
  await page.fill('#capIn', 'Call HR tomorrow at 4pm');
  await page.press('#capIn', 'Enter');
  assert.equal(await page.textContent('#calChip'), '1 change to send');
  assert.ok(!google.calls.some(c => c.startsWith('POST')), 'nothing is sent without confirmation');
  // Say no first
  await page.click('#calChip');
  assert.match(await page.textContent('#confirmText'), /\+\s+Add "Call HR", Tomorrow at 4 pm/);
  await page.click('#confirmNo');
  await page.waitForTimeout(100);
  assert.ok(!google.calls.some(c => c.startsWith('POST')), '"Cancel" sends nothing');
  // Then yes
  await page.click('#calChip'); await confirmAndWait(page, /Sent 1 change/);
  const created = google.events['roshan@gmail.com'].find(e => e.summary === 'Call HR');
  assert.deepEqual(created.start, { dateTime: '2026-10-16T16:00:00', timeZone: 'Asia/Dubai' });
  assert.deepEqual(created.end, { dateTime: '2026-10-16T16:30:00', timeZone: 'Asia/Dubai' });
  assert.ok(created.extendedProperties.private.jarvisId, 'linked to the NOVA task');
  assert.equal(await page.evaluate(() => document.getElementById('calChip').hidden), true);
  await page.evaluate(() => location.hash = 'calendar'); await page.waitForTimeout(300);
  assert.equal((await evTitles(page)).filter(t => /Call HR/.test(t)).length, 1, 'no duplicate after sync');
  // Edit in NOVA -> update
  const id = await page.evaluate(() => J.data.tasks.find(t => t.title === 'Call HR').id);
  await page.evaluate(id => { const t = J.byId(J.data.tasks, id); t.time = '17:00'; J.commit(); }, id);
  await page.click('#calChip');
  assert.match(await page.textContent('#confirmText'), /~\s+Update "Call HR", Tomorrow at 5 pm/);
  await confirmAndWait(page, /Sent 1 change/);
  assert.equal(google.events['roshan@gmail.com'].find(e => e.id === created.id).start.dateTime, '2026-10-16T17:00:00');
  // Interviews and deadlines (all-day) are sent too
  await page.evaluate(() => { J.addTask({ title: 'Interview: Analyst at Careem', due: '2026-10-19', time: '11:00', kind: 'interview' }); J.addTask({ title: 'Apply: Data Intern at ADNOC', due: '2026-10-20', time: '09:00', kind: 'deadline' }); });
  await page.click('#calChip'); await confirmAndWait(page, /Sent 2 changes/);
  const iv = google.events['roshan@gmail.com'].find(e => /Interview: Analyst/.test(e.summary));
  assert.equal(iv.end.dateTime, '2026-10-19T12:00:00', 'interviews last an hour');
  assert.deepEqual(google.events['roshan@gmail.com'].find(e => /Apply: Data Intern/.test(e.summary)).start, { date: '2026-10-20' }, 'deadlines are all-day');
  // Delete in NOVA -> delete
  await page.evaluate(id => J.removeTask(id), id);
  await page.click('#calChip');
  assert.match(await page.textContent('#confirmText'), /−\s+Remove "Call HR"/);
  await confirmAndWait(page, /Sent 1 change/);
  assert.ok(!google.events['roshan@gmail.com'].some(e => e.id === created.id), 'deleted in Google');
  // Edit and delete a Google event from NOVA (with confirmation)
  await page.click('.ev.ext >> text=Team sync');
  await page.fill('#f_start', '10:30'); await page.fill('#f_end', '11:30');
  await page.click('#dialogSave');
  assert.match(await page.textContent('#confirmText'), /Update "Team sync" in Google Calendar to Thursday 15 October 2026 · 10:30 am – 11:30 am\?/);
  await confirmAndWait(page, /Updated in Google Calendar/);
  assert.deepEqual(google.events['roshan@gmail.com'].find(e => e.id === 'e1').start, { dateTime: '2026-10-15T10:30:00', timeZone: 'Asia/Dubai' });
  await page.click('.ev.ext >> text=Team sync');
  await page.click('#formDialog [data-act="calDelEvent"]');
  assert.match(await page.textContent('#confirmText'), /Delete "Team sync".*This cannot be undone/);
  await confirmAndWait(page, /Deleted from Google Calendar/);
  assert.ok(!google.events['roshan@gmail.com'].some(e => e.id === 'e1'));
  // Read-only calendar (University) still has no delete button
  await page.click('.ev.ext >> text=Data Structures lecture');
  assert.equal(await page.$('#formDialog [data-act="calDelEvent"]'), null);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('token expiry: Reconnect prompt, renew, and no data lost (also after reload)', async () => {
  const { page, google, errors, ctx } = await open();
  await connectGoogle(page);
  await page.evaluate(() => J.addTask({ title: 'Keep me', due: '2026-10-16' }));
  // Reload in the same tab: the token from this tab's session is reused, events come from the local copy.
  await page.reload(); await page.waitForFunction(() => window.J && J.cal);
  assert.equal(await page.evaluate(() => J.cal.needsReconnect('google')), false);
  assert.equal(await page.evaluate(() => J.data.extEvents.length), 5);
  // Google says the token expired
  google.fail = 401;
  await page.evaluate(() => location.hash = 'calendar'); await page.waitForTimeout(200);
  await page.click('[data-act="calSync"]');
  await page.waitForFunction(() => /sign-in has expired/.test(document.getElementById('toast').textContent));
  assert.match(await page.textContent('#toast'), /Your Google Calendar sign-in has expired\. Click Reconnect\. Your NOVA data is safe\./);
  assert.equal(await page.textContent('#calChip'), 'Reconnect Google Calendar');
  assert.match(await page.textContent('.cal-bar'), /Sign-in expired/);
  assert.equal(await page.evaluate(() => J.data.extEvents.length), 5, 'cached events stay');
  assert.ok(await page.evaluate(() => J.data.tasks.some(t => t.title === 'Keep me')), 'tasks stay');
  google.fail = null;
  await page.click('#calChip');
  await page.waitForFunction(() => /reconnected and synced/.test(document.getElementById('toast').textContent));
  const last = await page.evaluate(() => window.__gis.requests.slice(-1)[0]);
  assert.equal(last.prompt, '', 'renewal does not ask for consent again');
  assert.equal(await page.evaluate(() => document.getElementById('calChip').hidden), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('errors: permission denied, API disabled, consent declined, pop-up closed, partial permission', async () => {
  const { page, google, ctx } = await open();
  await page.evaluate(() => { window.__gis.next.error = 'access_denied'; });
  await page.fill('#gClientId', CLIENT);
  await page.click('[data-act="calConnect"][data-id="google"]');
  await page.waitForFunction(() => /declined/.test(document.getElementById('toast').textContent));
  assert.equal(await page.evaluate(() => J.data.cal.google.connected), false);
  await page.evaluate(() => { window.__gis.next.error = null; window.__gis.next.popupError = 'popup_closed'; });
  await page.click('[data-act="calConnect"][data-id="google"]');
  await page.waitForFunction(() => /origin_mismatch/.test(document.getElementById('toast').textContent));
  assert.match(await page.textContent('#toast'), /127\.0\.0\.1:\d+ is listed under Authorised JavaScript origins/);
  assert.match(await page.textContent('#cal-google .cal-error'), /origin_mismatch/, 'error is also shown on the card');
  await page.evaluate(() => { window.__gis.next.popupError = 'popup_failed_to_open'; });
  await page.click('[data-act="calConnect"][data-id="google"]');
  await page.waitForFunction(() => /blocked the sign-in window/.test(document.getElementById('toast').textContent));
  await page.evaluate(() => { window.__gis.next.popupError = null; });
  await connectGoogle(page);
  google.fail = 403;
  await page.click('[data-act="calSyncOne"][data-id="google"]');
  await page.waitForFunction(() => /did not give NOVA permission/.test(document.getElementById('toast').textContent));
  google.fail = 'api-disabled';
  await page.click('[data-act="calSyncOne"][data-id="google"]');
  await page.waitForFunction(() => /Calendar API is not turned on/.test(document.getElementById('toast').textContent));
  google.fail = null;
  // Asking for two-way but only ticking "see" in Google keeps read-only access.
  await page.evaluate(() => { window.__gis.next.grant = 'read'; });
  await page.check('input[data-calmode="google"][value="two-way"]');
  await page.waitForFunction(() => /did not give NOVA permission/.test(document.getElementById('toast').textContent));
  assert.equal(await page.evaluate(() => J.data.cal.google.mode), 'read', 'stays read-only');
  await ctx.close();
});

test('offline: clear message, cached events stay, syncs again when back online', async () => {
  const { page, google, ctx, errors } = await open();
  await connectGoogle(page);
  const calls = google.calls.length;
  await ctx.setOffline(true);
  await page.evaluate(() => location.hash = 'calendar'); await page.waitForTimeout(200);
  await page.click('[data-act="calSync"]');
  await page.waitForFunction(() => /You are offline/.test(document.getElementById('toast').textContent));
  assert.equal(google.calls.length, calls, 'no requests while offline');
  assert.ok((await evTitles(page)).some(t => /Team sync/.test(t)), 'calendar still shows the local copy');
  await ctx.setOffline(false);
  await page.waitForTimeout(400);
  assert.ok(google.calls.length > calls, 'syncs automatically when back online');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('disconnect revokes access and removes synced data', async () => {
  const { page, ctx } = await open();
  await connectGoogle(page);
  await page.click('[data-act="calDisconnect"][data-id="google"]');
  assert.match(await page.textContent('#confirmText'), /revoke its access and remove the synced events/);
  await page.click('#confirmYes');
  await page.waitForFunction(() => !J.data.cal.google.connected);
  assert.deepEqual(await page.evaluate(() => window.__gis.revoked), ['tok-1']);
  assert.equal(await page.evaluate(() => J.data.extEvents.filter(e => e.src === 'google').length), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('jarvis.gtoken')), null);
  assert.equal(await page.inputValue('#gClientId'), CLIENT, 'Client ID is kept so you can reconnect');
  assert.match(await page.textContent('#cal-google'), /Not connected/);
  await ctx.close();
});

test('spoken reminder before events, clashes, free time', async () => {
  const google = googleState();
  // An event 14 minutes from "now" (8:14 am)
  google.events['roshan@gmail.com'].push({ id: 'soon', summary: 'Call with recruiter', start: at('2026-10-15', '08:14'), end: at('2026-10-15', '08:44') });
  const { page, ctx } = await open({ google });
  await connectGoogle(page);
  await page.evaluate(() => J.cal.checkEventReminders());
  const said = await page.evaluate(() => window.__said.join(' | '));
  assert.match(said, /Reminder: Call with recruiter at 8:14 am, in 14 minutes\./);
  assert.match(await page.evaluate(() => window.__notes.join(' | ')), /NOVA: Call with recruiter: 8:14 am · roshan@gmail\.com/);
  await page.evaluate(() => J.cal.checkEventReminders());
  assert.equal((await page.evaluate(() => window.__said.join(' | '))).split('Call with recruiter').length - 1, 1, 'each reminder is spoken once');
  // Clashes
  assert.equal(await page.evaluate(() => J.clashNote('2026-10-15', '10:15')), 'Heads up: you already have "Team sync" at 10 am.');
  assert.equal(await page.evaluate(() => J.clashNote('2026-10-15', '11:00')), '', 'back-to-back is not a clash');
  await page.evaluate(() => location.hash = 'tasks'); await page.waitForTimeout(200);
  await page.click('[data-act="addTask"]');
  await page.fill('#f_due', '2026-10-15'); await page.fill('#f_time', '13:30');
  assert.equal(await page.textContent('#clashWarn'), 'Heads up: you already have "Data Structures lecture" at 1 pm.');
  await page.keyboard.press('Escape');
  await page.fill('#capIn', 'Meet Sara today at 10:30am');
  await page.press('#capIn', 'Enter');
  assert.match(await toast(page), /Added: Meet Sara.*Heads up: you already have "Team sync" at 10 am\./);
  // Free time inside working hours (9–6), from 8:00 am "now"
  const free = await page.evaluate(() => J.cal.freeSlots('2026-10-15'));
  assert.deepEqual(free.slots, [{ from: '09:00', to: '10:00' }, { from: '11:00', to: '13:00' }, { from: '14:30', to: '18:00' }]);
  await ctx.close();
});

test('.ics import and export in the browser, and add-to-calendar links', async () => {
  const { page, ctx, errors } = await open({ hash: 'settings' });
  await page.setInputFiles('#icsFile', [path.join(__dirname, 'fixtures', 'university.ics'), path.join(__dirname, 'fixtures', 'apple.ics')]);
  await page.waitForFunction(() => J.data.cal && J.data.cal.ics && J.data.cal.ics.length === 2);
  assert.match(await page.textContent('main'), /Semester timetable/);
  await page.evaluate(() => location.hash = 'calendar'); await page.waitForTimeout(250);
  await page.click('[data-act="calMove"][data-id="1"]'); // week of 19 Oct
  const wk = await evTitles(page);
  assert.ok(wk.some(t => /2 pm – 3:30 pm · Semester timetable\s*Data Structures lecture \(moved\)/.test(t)), 'moved class on Wednesday');
  assert.ok(wk.some(t => /6:30 pm – 8 pm · Personal\s*Gym with Omar/.test(t)));
  assert.equal(wk.filter(t => /Trip to Oman/.test(t)).length, 3, 'three-day trip shows on each day');
  await page.click('.ev.ext >> text=Gym with Omar');
  assert.match(await page.textContent('#formDialog'), /Imported from a calendar file, so it is read-only here/);
  await page.keyboard.press('Escape');
  // Export
  await page.evaluate(() => { J.addTask({ title: 'Submit report', person: 'Dr. Ahmed', due: '2026-10-18' }); J.addTask({ title: 'Interview: Analyst at Careem', due: '2026-10-19', time: '11:00', kind: 'interview' }); });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="calExport"]')]);
  assert.match(dl.suggestedFilename(), /^nova-calendar-2026-10-15\.ics$/);
  const text = fs.readFileSync(await dl.path(), 'utf8');
  const back = ICS.parse(text, { from: Date.UTC(2026, 0, 1), to: Date.UTC(2027, 0, 1) });
  const sr = back.events.find(e => e.title === 'Submit report for Dr. Ahmed');
  assert.deepEqual([sr.allDay, sr.date], [true, '2026-10-18']);
  const iv = back.events.find(e => /Interview/.test(e.title));
  assert.equal(ICS.dubaiParts(iv.start).time, '11:00');
  assert.equal(iv.end - iv.start, 3600e3);
  // Add to Google / Outlook links on a task
  await page.evaluate(() => location.hash = 'tasks'); await page.waitForTimeout(200);
  await page.click('[data-act="calAdd"][aria-label*="Interview: Analyst"]');
  const links = await page.$$eval('#formDialog a.site-btn', a => a.map(x => x.href));
  assert.equal(links[0], 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Interview%3A%20Analyst%20at%20Careem&dates=20261019T070000Z/20261019T080000Z&ctz=Asia%2FDubai&details=From%20NOVA');
  assert.match(links[1], /^https:\/\/outlook\.live\.com\/calendar\/0\/deeplink\/compose\?.*startdt=2026-10-19T11%3A00%3A00%2B04%3A00/);
  assert.match(links[2], /^https:\/\/outlook\.office\.com\//);
  // Bad file
  await page.keyboard.press('Escape');
  await page.setInputFiles('#icsFile', path.join(__dirname, 'fixtures', 'not-a-calendar.ics'));
  await page.waitForFunction(() => /not a calendar/.test(document.getElementById('toast').textContent));
  assert.deepEqual(errors, []);
  await ctx.close();
});

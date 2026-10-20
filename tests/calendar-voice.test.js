// Every calendar voice command, typed (the same command system the microphone uses).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const NOW = Date.parse('2026-10-15T08:00:00+04:00'); // Thursday 15 Oct 2026, 8:00 am in Dubai
const CLIENT = '123456789012-abcdefghijk.apps.googleusercontent.com';
const CLEAN = { v: 3, profile: { name: 'Roshan' }, tasks: [], notes: [], skills: [], wins: [], apps: [], people: [], settings: { voice: true } };
const at = (d, hm) => ({ dateTime: d + 'T' + hm + ':00+04:00' });
function googleState() {
  return {
    calendars: [
      { id: 'roshan@gmail.com', summary: 'Personal', primary: true, accessRole: 'owner', backgroundColor: '#4285f4' },
      { id: 'uni@group.calendar.google.com', summary: 'University', accessRole: 'reader', backgroundColor: '#33b679' }
    ],
    events: {
      'roshan@gmail.com': [
        { id: 'e1', summary: 'Team sync', start: at('2026-10-15', '10:00'), end: at('2026-10-15', '11:00') },
        { id: 'e6', summary: 'Project meeting', start: at('2026-10-15', '15:00'), end: at('2026-10-15', '16:00') },
        { id: 'e2', summary: 'Interview with Noon', start: at('2026-10-16', '11:00'), end: at('2026-10-16', '12:00') },
        { id: 'e7', summary: 'Call with HR', start: at('2026-10-16', '09:00'), end: at('2026-10-16', '09:30') },
        { id: 'e3', summary: 'Career fair', start: { date: '2026-10-18' }, end: { date: '2026-10-19' } }
      ],
      'uni@group.calendar.google.com': [
        { id: 'u1', summary: 'Data Structures lecture', start: at('2026-10-15', '13:00'), end: at('2026-10-15', '14:30') }
      ]
    }
  };
}

let browser, server, page, ctx, google, errors;
test.before(async () => {
  if (!process.env.BASE_URL) { server = await H.startServer(); process.env.BASE_URL = server.url; }
  browser = await H.launch();
  google = googleState();
  ({ page, ctx, errors } = await H.openApp(browser, { now: NOW, data: CLEAN, google, hash: 'settings' }));
});
test.after(async () => { await ctx.close(); await browser.close(); if (server) server.close(); });

const ask = t => H.ask(page, t);

test('not connected: helpful answers, local calendar still works', async () => {
  assert.equal(await ask('sync my calendar'), 'No online calendar is connected. Open Settings, Calendar connections, to connect Google or Outlook.');
  assert.equal(await ask("what's on my calendar today"), 'Your calendar is clear today.');
  await page.evaluate(() => J.addTask({ title: 'Submit report', person: 'Dr. Ahmed', due: '2026-10-15', time: '17:00' }));
  assert.equal(await ask("what's on my calendar today"), '1 item today: Submit report for Dr. Ahmed, at 5 pm.');
});

test('connect Google (two-way) and sync by voice', async () => {
  await page.fill('#gClientId', CLIENT);
  await page.click('[data-act="calConnect"][data-id="google"]');
  await page.waitForFunction(() => J.data.cal.google.connected && J.data.cal.google.lastSync > 0);
  await page.check('input[data-calmode="google"][value="two-way"]');
  await page.waitForFunction(() => J.data.cal.google.mode === 'two-way' && window.__gis.requests.length === 2);
  // The 5 pm task from the previous test is waiting to be sent: send it so the outbox is empty.
  await page.evaluate(() => J.cal.sendOps(J.cal.outbox(), true));
  assert.match(await ask('sync my calendar'), /^Synced Google Calendar\. You have 6 events in the next 7 days\.$/);
  assert.match(await ask('refresh calendar'), /^Synced Google Calendar/);
});

test("what's on my calendar today / tomorrow / this week", async () => {
  assert.equal(await ask("What's on my calendar today?"), '4 items today: Team sync, at 10 am; Data Structures lecture, at 1 pm; Project meeting, at 3 pm; Submit report for Dr. Ahmed, at 5 pm.');
  assert.equal(await ask("what's on my calendar tomorrow"), '2 items tomorrow: Call with HR, at 9 am; Interview with Noon, at 11 am.');
  assert.match(await ask("what's on my schedule this week"), /^7 items this week: Team sync, today at 10 am; Data Structures lecture, today at 1 pm; Project meeting, today at 3 pm; Submit report for Dr\. Ahmed, today at 5 pm; and 3 more\.$/);
  assert.equal(await ask('what do I have on Sunday'), '1 item Sunday: Career fair, all day.');
  assert.equal(await ask("what's on my calendar next week"), 'Your calendar is clear next week.');
});

test("what's my next meeting", async () => {
  assert.equal(await ask("What's my next meeting?"), 'Your next event is Team sync, today at 10 am, in Personal.');
  assert.equal(await ask("when's my next interview"), 'Your next interview is Interview with Noon, tomorrow at 11 am, in Personal.');
});

test('am I free at 3 pm tomorrow / when am I free', async () => {
  assert.equal(await ask('Am I free at 3 pm tomorrow?'), "Yes, you're free at 3 pm tomorrow.");
  assert.equal(await ask('am I free at 11 tomorrow'), 'No. At 11 am tomorrow you have Interview with Noon (11 am to 12 pm).');
  assert.equal(await ask('am I busy at 10:30am'), 'No. At 10:30 am today you have Team sync (10 am to 11 am).');
  assert.equal(await ask('When am I free on Monday?'), "On Monday you're free 9 am to 6 pm.");
  // Busy today: Team sync 10–11, lecture 1–2:30, Project meeting 3–4, and the 5 pm task (30 minutes)
  assert.equal(await ask('when am I free today'), "Today you're free 9 am to 10 am, 11 am to 1 pm, 2:30 pm to 3 pm, 4 pm to 5 pm and 5:30 pm to 6 pm.");
  assert.equal(await ask('when am I free on Saturday'), 'Saturday is outside your working days, and your calendar is clear.');
  assert.equal(await ask('when am I free on Sunday'), 'Sunday is outside your working days, and you have 1 item on your calendar.');
});

test('add interview with Careem on Sunday at 11am (confirm first, then sent to Google)', async () => {
  const before = google.events['roshan@gmail.com'].length;
  assert.equal(await ask('Add interview with Careem on Sunday at 11am'), 'Add "Interview with Careem" Sunday at 11 am to NOVA and Google Calendar? Say yes or no.');
  assert.equal(google.events['roshan@gmail.com'].length, before, 'nothing created before yes');
  assert.equal(await ask('maybe'), 'Please say yes or no.');
  assert.equal(await ask('yes'), 'Done. Interview with Careem is on your calendar Sunday at 11 am. Google Calendar updated too.');
  const task = await page.evaluate(() => J.data.tasks.find(t => t.title === 'Interview with Careem'));
  assert.deepEqual([task.kind, task.due, task.time, task.priority], ['interview', '2026-10-18', '11:00', 'high']);
  const ev = google.events['roshan@gmail.com'].find(e => e.summary === 'Interview with Careem');
  assert.deepEqual(ev.start, { dateTime: '2026-10-18T11:00:00', timeZone: 'Asia/Dubai' });
  // Missing details: NOVA asks
  assert.equal(await ask('schedule a meeting with Sara tomorrow'), 'What time is the meeting?');
  assert.equal(await ask('at 3pm'), 'Add "Meeting with Sara" tomorrow at 3 pm to NOVA and Google Calendar? Say yes or no.');
  assert.equal(await ask('no'), 'Okay, I left it as it is.');
  assert.ok(!(await page.evaluate(() => J.data.tasks.some(t => t.title === 'Meeting with Sara'))), '"no" adds nothing');
  assert.equal(await ask('book a call'), 'When is the call?');
  assert.equal(await ask('cancel'), '', 'cancel stops the question');
  // Clash warning
  assert.equal(await ask('add meeting with Omar today at 10:30am'), 'Add "Meeting with Omar" today at 10:30 am to NOVA and Google Calendar? Heads up: you already have "Team sync" at 10 am. Say yes or no.');
  assert.equal(await ask('no'), 'Okay, I left it as it is.');
});

test('move my 3 pm meeting to 4 pm (confirm first)', async () => {
  assert.equal(await ask('Move my 3 pm meeting to 4 pm'), 'Move "Project meeting" from today at 3 pm to today at 4 pm? This changes it in Google Calendar. Say yes or no.');
  assert.equal(google.events['roshan@gmail.com'].find(e => e.id === 'e6').start.dateTime, '2026-10-15T15:00:00+04:00', 'unchanged before yes');
  assert.equal(await ask('yes'), 'Moved "Project meeting" to today at 4 pm in Google Calendar.');
  const e6 = google.events['roshan@gmail.com'].find(e => e.id === 'e6');
  assert.deepEqual([e6.start.dateTime, e6.end.dateTime], ['2026-10-15T16:00:00', '2026-10-15T17:00:00'], 'keeps the one-hour length');
  // A NOVA task, moved by name to another day
  assert.equal(await ask('move the interview with Careem to Monday at 10am'), 'Move "Interview with Careem" from Sunday at 11 am to Monday at 10 am? Say yes or no.');
  assert.equal(await ask('yes'), 'Moved "Interview with Careem" to Monday at 10 am. Google Calendar updated too.');
  assert.equal(google.events['roshan@gmail.com'].find(e => e.summary === 'Interview with Careem').start.dateTime, '2026-10-19T10:00:00');
  // Read-only and unknown
  assert.match(await ask('move the Data Structures lecture to 2pm'), /^"Data Structures lecture" is read-only for NOVA\./);
  assert.equal(await ask('move my dentist appointment to Friday'), 'I couldn\'t find "dentist appointment" on your calendar in the next two weeks.');
});

test('cancel the call with HR (yes / no)', async () => {
  assert.equal(await ask('Cancel the call with HR'), 'Cancel "Call with HR" tomorrow at 9 am? This deletes it from Google Calendar. Say yes or no.');
  assert.equal(await ask('no'), 'Okay, I left it as it is.');
  assert.ok(google.events['roshan@gmail.com'].some(e => e.id === 'e7'), 'still there after no');
  await ask('cancel the call with HR');
  assert.equal(await ask('yes'), 'Cancelled "Call with HR". It is removed from Google Calendar.');
  assert.ok(!google.events['roshan@gmail.com'].some(e => e.id === 'e7'));
  assert.match(await ask('cancel the Data Structures lecture'), /read-only for NOVA, so I can't cancel it/);
  assert.equal(await ask('cancel my dentist appointment'), 'I couldn\'t find an upcoming event matching "dentist appointment".');
  // Task commands still go to tasks, not the calendar
  assert.match(await ask('delete task submit report'), /^Delete the task "Submit report"\? Say yes or no\.$/);
  assert.equal(await ask('no'), 'Okay, I kept it.');
});

test('expired sign-in and offline are explained by voice', async () => {
  google.fail = 401;
  assert.equal(await ask('sync my calendar'), 'Your Google Calendar sign-in has expired. Click Reconnect. Your NOVA data is safe.');
  google.fail = null;
  await page.evaluate(() => J.cal.sync('google', { interactive: true }));
  await ctx.setOffline(true);
  assert.equal(await ask('sync my calendar'), 'You are offline. NOVA will sync Google Calendar when you are back online. Your data is safe.');
  await ctx.setOffline(false);
});

test('typed in the chat panel and spoken out loud; navigation still works', async () => {
  await page.click('#miniCore');
  await page.fill('#chatInput', "what's my next meeting");
  await page.press('#chatInput', 'Enter');
  await page.waitForFunction(() => window.__said.some(s => /Your next event is/.test(s)));
  assert.match(await page.textContent('#chatLog'), /Your next event is/);
  assert.equal(await ask('open calendar'), 'Opening Calendar.');
  await page.waitForFunction(() => location.hash === '#calendar');
  assert.deepEqual(errors, []);
});

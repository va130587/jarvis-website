// "What if I say yes?" (server): the proposal is read from plain words in Dubai time, its effect on that day is worked out with fixed rules,
// the calendar is only what the browser sends for this one answer, nothing is written, and nobody else's data is used.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
const { parseProposal } = require('../server/whatif');
test.after(closeAll);

const at = iso => Date.parse(iso + '+04:00'), NOW = at('2026-10-21T09:00:00');   // Wednesday 21 Oct 2026, Dubai
async function setup() { const s = await boot({ NOVA_RATE_API_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }, { now: () => NOW }); const a = s.client(), b = s.client(); await a.login('roshan@example.com'); await b.login('mallory@example.com'); return { s, a, b }; }
const ask = (c, text, extra) => c.post('/api/whatif', Object.assign({ text }, extra || {}));
const ev = (date, start, end, title, allDay) => ({ date, start, end, title: title || 'Meeting', allDay: !!allDay });
function task(db, uid, title, due, est) { db.prepare("INSERT INTO tasks (user_id, title, due, status, estimate_min, created_at) VALUES (?, ?, ?, 'open', ?, ?)").run(uid, title, due, est || null, NOW); }
function promise(db, uid, title, who, deadline, status) { db.prepare("INSERT INTO commitments (user_id, title, direction, counterparty, deadline, source_type, status, created_at, updated_at) VALUES (?, ?, 'i_owe', ?, ?, 'manual', ?, ?, ?)").run(uid, title, who, deadline, status || 'task_prepared', NOW, NOW); }

test('the words become a day, a time range and a length (Dubai time), with guesses labelled', () => {
  const p = t => parseProposal(t, NOW);
  assert.deepEqual(p('Join the Friday workshop 2pm to 5pm'), { title: 'Join the workshop', date: '2026-10-23', start: 840, end: 1020, minutes: 180, timed: true, guess: false });
  assert.equal(p('dinner with Sara tomorrow 7-9pm').start, 19 * 60); assert.equal(p('dinner with Sara tomorrow 7-9pm').end, 21 * 60);
  const c = p('call the bank on 2026-10-30 at 3pm for 30 minutes'); assert.deepEqual([c.date, c.start, c.end, c.minutes, c.guess], ['2026-10-30', 900, 930, 30, false]);
  assert.deepEqual([p('meeting thursday 14:00 to 15:30').start, p('meeting thursday 14:00 to 15:30').end], [840, 930]);
  const g = p('finish the report friday'); assert.equal(g.timed, false); assert.equal(g.minutes, 60); assert.equal(g.guess, true);
  assert.equal(p('lunch today at 1pm').minutes, 60); assert.equal(p('lunch today at 1pm').guess, true, 'no length said: one hour, labelled a guess');
  assert.equal(p('gym thursday 6:30 to 7:30').start, 18 * 60 + 30, 'no am or pm and a start before 7: the evening, labelled a guess');
  assert.equal(p('gym thursday 6:30 to 7:30').guess, true);
  assert.equal(p('write مراجعة 🚀 on friday').title, 'write مراجعة 🚀');
});

test('plain refusals: no day, a day that has passed, an end before the start, too long, empty', async () => {
  const { a } = await setup(); const err = async (t, rx) => { const r = await ask(a, t); assert.equal(r.status, 400, t); assert.match(r.json.error.message, rx, t); };
  await err('join the workshop 2pm to 5pm', /^Say which day it is/); await err('call Sara 2026-10-10', /^That day has already passed/); await err('workshop friday 5pm to 2pm', /^The end time must be after the start time/);
  await err('   ', /^Type what you might say yes to/); await err('x'.repeat(400) + ' friday', /^That is too long/); await err('workshop friday for 20 hours', /^The length must be between/);
  assert.equal((await a.post('/api/whatif', { text: 'workshop friday', events: 'nope', calendar: true })).status, 400);
});

test('an empty day: it fits, with the exact free time, the rules, and a clear note that no calendar was checked', async () => {
  const { a } = await setup(); const r = (await ask(a, 'Join the workshop tomorrow 2pm to 5pm')).json;
  assert.equal(r.verdict, 'fits'); assert.equal(r.capacity.freeBeforeMin, 480); assert.equal(r.capacity.busyAfterMin, 180); assert.equal(r.capacity.freeAfterMin, 300); assert.equal(r.capacity.freeHoursAfter, 5);
  assert.equal(r.summary, 'It fits. You would still have 5 h free that day.'); assert.equal(r.calendar.checked, false); assert.match(r.calendar.note, /No calendar is connected/); assert.equal(r.atRisk, null);
  assert.equal(r.rules.length, 5); assert.equal(r.changed, 'Nothing was added or changed.');
});

test('calendar: a clash is named, back-to-back is not a clash, overlaps are counted once, other days and all-day events are handled', async () => {
  const { a } = await setup(); const D = '2026-10-23';
  const evs = [ev(D, '14:00', '15:00', 'Team sync'), ev(D, '14:30', '16:00', 'Overlapping call'), ev(D, '17:00', '18:00', 'Review'), ev('2026-10-24', '14:00', '17:00', 'Other day'), ev(D, '00:00', '00:00', 'Holiday', true)];
  const clash = (await ask(a, 'workshop Friday 2pm to 5pm', { calendar: true, events: evs })).json;
  assert.equal(clash.verdict, 'clash'); assert.deepEqual(clash.calendar.clashes.map(c => c.title), ['Team sync', 'Overlapping call']); assert.match(clash.summary, /^It clashes with "Team sync" \(14:00 to 15:00\) and "Overlapping call" \(14:30 to 16:00\)\./);
  assert.equal(clash.calendar.events, 3); assert.equal(clash.calendar.allDay, 1); assert.equal(clash.capacity.busyBeforeMin, 180, '14:00-16:00 once, plus 17:00-18:00'); assert.equal(clash.capacity.busyAfterMin, 240, '14:00-18:00 with the new one');
  const back = (await ask(a, 'workshop Friday 4pm to 5pm', { calendar: true, events: evs })).json; assert.equal(back.calendar.clashes.length, 0, 'ending at 17:00 when the next starts at 17:00 is not a clash'); assert.notEqual(back.verdict, 'clash');
  const lunch = (await ask(a, 'walk Friday 1pm to 2pm', { calendar: true, events: [ev(D, '13:00', '14:00', 'Lunch')] })).json; assert.equal(lunch.capacity.busyAfterMin, 0, 'the lunch hour is not working time');
  const out = (await ask(a, 'dinner Friday 7pm to 9pm', { calendar: true, events: [] })).json; assert.match(out.outsideHours, /outside your working hours/); assert.equal(out.capacity.freeAfterMin, 480);
});

test('tasks and promises: work waiting, tight and overbooked, the most at-risk item and why', async () => {
  const { s, a } = await setup(); const D = '2026-10-23'; await a.get('/api/session');
  task(s.app.db, 1, 'Write the report', D, 240); task(s.app.db, 1, 'Call HR', D, 15); task(s.app.db, 1, 'Pay the invoice', '2026-10-30', 15); promise(s.app.db, 1, 'Send Sara the slides', 'Sara', D); promise(s.app.db, 1, 'Send Omar the figures', 'Omar', '2026-10-24');
  promise(s.app.db, 1, 'Old promise', 'Ali', D, 'verified');
  let r = (await ask(a, 'workshop Friday 9am to 11am')).json;           // 480 - 120 busy - (240 + 15 + 30) waiting = 75 free
  assert.equal(r.capacity.workWaitingMin, 285); assert.equal(r.capacity.freeBeforeMin, 195); assert.equal(r.capacity.freeAfterMin, 75); assert.equal(r.verdict, 'fits');
  assert.deepEqual(r.tight.promises.map(p => p.title), ['Send Sara the slides', 'Send Omar the figures'], 'free time under 2 hours: promises due that day or the next are tight'); assert.deepEqual(r.tight.tasks, []);
  assert.equal(r.atRisk.kind, 'promise'); assert.match(r.atRisk.why, /Free time that day would drop to 1\.3 h and this promise is due that day to Sara/);
  r = (await ask(a, 'workshop Friday 9am to 12:30pm')).json;              // free after = 480 - 210 - 285 = -15
  assert.equal(r.capacity.freeAfterMin, -15); assert.equal(r.verdict, 'overbooked'); assert.match(r.summary, /^It would overbook that day: 0\.3 h more work than there is time for\./);
  assert.equal(r.atRisk.title, 'Write the report'); assert.match(r.atRisk.why, /biggest task \(about 240 min\)/); assert.deepEqual(r.tight.tasks.map(t => t.title), ['Write the report', 'Call HR']);
  r = (await ask(a, 'workshop Friday 9am to 10am')).json; assert.equal(r.capacity.freeAfterMin, 135); assert.deepEqual(r.tight.tasks, []);
  const guess = (await ask(a, 'prepare slides Friday')).json; assert.equal(guess.proposal.timed, false); assert.equal(guess.capacity.workWaitingMin, 285 + 60, 'an untimed commitment counts as work waiting (a labelled guess)');
  task(s.app.db, 1, 'Plan the trip', D); r = (await ask(a, 'x Friday 3pm to 4pm')).json; assert.equal(r.capacity.workWaitingMin, 285 + 30, 'a task with no estimate uses a guess'); assert.ok(r.capacity.freeAfterMin === 480 - 60 - 315);
});

test('it writes nothing, needs sign-in and the CSRF header, and never uses another person\'s tasks or promises', async () => {
  const { s, a, b } = await setup(); const D = '2026-10-23'; await a.get('/api/session');
  task(s.app.db, 1, 'Mine secret task', D, 300); promise(s.app.db, 1, 'Mine secret promise', 'Sara', D);
  const snap = () => JSON.stringify(['tasks', 'commitments', 'notes', 'reminders', 'expenses', 'runs', 'approvals', 'tool_executions'].map(t => s.app.db.prepare('SELECT COUNT(*) n FROM ' + t).get().n)), before = snap();
  const mine = (await ask(a, 'workshop Friday 9am to 5pm')).json, theirs = (await ask(b, 'workshop Friday 9am to 5pm')).json;
  assert.equal(snap(), before, 'nothing written, no run, no approval'); assert.ok(mine.capacity.workWaitingMin >= 330); assert.equal(theirs.capacity.workWaitingMin, 0); assert.doesNotMatch(JSON.stringify(theirs), /secret|Sara/);
  assert.equal((await s.client().post('/api/whatif', { text: 'x friday' })).status, 401); assert.equal((await a.raw('POST', '/api/whatif', { text: 'x friday' }, { 'x-nova-csrf': 'bad' })).status, 403);
});

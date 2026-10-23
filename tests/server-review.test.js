// Weekly Review (server): the last full Dubai week (Monday to Sunday) from a known fixture with exact numbers, "not enough data yet" for an empty week,
// Dubai-midnight edges, the three priorities with their rules, copy and download text, other people's data never used, read-only,
// and the optional Sunday-evening notification (off by default, one per week).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);

const at = iso => Date.parse(iso + '+04:00'), clock = { t: at('2026-10-21T09:00:00') };   // Wednesday: the last full week is Monday 12 to Sunday 18 October
async function setup(env) { const s = await boot(Object.assign({ NOVA_RATE_API_MAX: '100000' }, env || {}), { now: () => clock.t }); const a = s.client(), b = s.client(); await a.login('roshan@example.com'); await b.login('mallory@example.com'); clock.t = at('2026-10-21T09:00:00'); return { s, a, b }; }
const OLD = at('2026-09-01T09:00:00');
const task = (db, uid, title, due, status, doneAt) => db.prepare('INSERT INTO tasks (user_id, title, due, status, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, title, due, status, OLD, doneAt ? at(doneAt) : null);
function promise(db, uid, title, who, deadline, status, keptAt) {
  const id = Number(db.prepare('INSERT INTO commitments (user_id, title, direction, counterparty, deadline, source_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(uid, title, 'i_owe', who, deadline, 'manual', status, OLD, OLD).lastInsertRowid);
  db.prepare("INSERT INTO commitment_events (commitment_id, user_id, seq, from_status, to_status, note, actor, ts) VALUES (?, ?, 1, NULL, 'request_detected', 'x', 'you', ?)").run(id, uid, OLD);
  if (keptAt) db.prepare("INSERT INTO commitment_events (commitment_id, user_id, seq, from_status, to_status, note, actor, ts) VALUES (?, ?, 2, 'submitted', ?, 'x', 'you', ?)").run(id, uid, status, at(keptAt));
}
const focus = (db, uid, start, planned, endedMin) => db.prepare("INSERT INTO focus_sessions (user_id, title, planned_min, started_at, ended_at, status) VALUES (?, 'Focus', ?, ?, ?, ?)").run(uid, planned, at(start), endedMin === null ? null : at(start) + endedMin * 60e3, endedMin === null ? 'running' : 'completed');
const exp = (db, uid, day, fils, cat) => db.prepare('INSERT INTO expenses (user_id, amount_fils, category, day, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, fils, cat, day, OLD);
function habit(db, uid, name, schedule, days) { const id = Number(db.prepare('INSERT INTO habits (user_id, name, schedule, created_at) VALUES (?, ?, ?, ?)').run(uid, name, schedule, OLD).lastInsertRowid); days.forEach(d => db.prepare('INSERT INTO habit_checks (habit_id, user_id, day, created_at) VALUES (?, ?, ?, ?)').run(id, uid, d, OLD)); }
const range = (a, b) => { const out = []; for (let d = new Date(a + 'T12:00:00Z'); d <= new Date(b + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };
function fixture(db) {
  task(db, 1, 'Done Monday A', '2026-10-12', 'done', '2026-10-12T09:00:00'); task(db, 1, 'Done Monday B', null, 'done', '2026-10-12T17:00:00'); task(db, 1, 'Done Wednesday', null, 'done', '2026-10-14T10:00:00');
  task(db, 1, 'Done Sunday late', null, 'done', '2026-10-18T23:30:00'); task(db, 1, 'Done after midnight', null, 'done', '2026-10-19T00:10:00'); task(db, 1, 'Done the night before', null, 'done', '2026-10-11T23:50:00');
  task(db, 1, 'Renew passport', '2026-10-10', 'open'); task(db, 1, 'Finished late', '2026-10-15', 'done', '2026-10-20T10:00:00'); task(db, 1, 'Due Sunday', '2026-10-18', 'open'); task(db, 1, 'Pay rent', '2026-10-22', 'open'); task(db, 1, 'Far away', '2026-11-20', 'open');
  promise(db, 1, 'Send the slides', 'Sara', '2026-10-17', 'verified', '2026-10-16T10:00:00'); promise(db, 1, 'Share the report', 'Omar', '2026-10-15', 'completed', '2026-10-19T10:00:00'); promise(db, 1, 'Book the venue', 'Ali', '2026-10-13', 'failed');
  promise(db, 1, 'Send proposal', 'Noor', '2026-10-14', 'task_prepared'); promise(db, 1, 'Old plan', null, '2026-10-12', 'cancelled'); promise(db, 1, 'Kept early', 'Lina', '2026-10-25', 'verified', '2026-10-13T11:00:00');
  focus(db, 1, '2026-10-13T10:00:00', 30, 30); focus(db, 1, '2026-10-13T15:00:00', 25, 20); focus(db, 1, '2026-10-17T09:00:00', 45, 45); focus(db, 1, '2026-10-19T09:00:00', 60, 60); focus(db, 1, '2026-10-18T09:00:00', 60, null);
  habit(db, 1, 'Read', 'daily', range('2026-10-05', '2026-10-11').concat(range('2026-10-12', '2026-10-16'))); habit(db, 1, 'Gym', 'weekdays', range('2026-10-05', '2026-10-09').concat(range('2026-10-12', '2026-10-16')));
  exp(db, 1, '2026-10-12', 4000, 'food'); exp(db, 1, '2026-10-14', 12050, 'transport'); exp(db, 1, '2026-10-18', 1000, 'food'); exp(db, 1, '2026-10-19', 9900, 'fun'); exp(db, 1, '2026-10-11', 500, 'food'); exp(db, 1, '2026-10-03', 30000, 'bills');
  db.prepare("INSERT INTO budgets (user_id, category, monthly_fils) VALUES (1, 'total', 300000)").run();
}
const review = (c, q) => c.get('/api/review' + (q || '')).then(r => r.json);

test('the last full week, from a known fixture, with exact numbers in every section', async () => {
  const { s, a } = await setup(); fixture(s.app.db); const r = await a.get('/api/review'); assert.equal(r.status, 200); const d = r.json;
  assert.deepEqual([d.week.from, d.week.to, d.week.inProgress, d.week.note], ['2026-10-12', '2026-10-18', false, null]); assert.equal(d.week.label, '12 Oct to 18 Oct 2026');
  assert.equal(d.finished.total, 4, 'Sunday 23:30 is in the week; 00:10 Monday and 23:50 the night before are not'); assert.deepEqual(d.finished.byDay.map(x => x.count), [2, 0, 1, 0, 0, 0, 1]); assert.deepEqual(d.finished.byDay.map(x => x.weekday)[0], 'Monday');
  assert.deepEqual([d.promises.onTime, d.promises.late, d.promises.notKept, d.promises.stillOpen, d.promises.cancelled, d.promises.counted, d.promises.keptThisWeek], [1, 1, 1, 1, 1, 4, 2]);
  assert.equal(d.focus.totalMin, 95); assert.equal(d.focus.sessions, 3); assert.deepEqual(d.focus.byDay.map(x => x.minutes), [0, 50, 0, 0, 0, 45, 0], 'a session still running and one on Monday are not counted');
  const read = d.habits.items.find(h => h.name === 'Read'), gym = d.habits.items.find(h => h.name === 'Gym');
  assert.deepEqual([read.done, read.of, read.previousDone, read.previousOf, read.streak], [5, 7, 7, 7, 0]); assert.deepEqual([gym.done, gym.of, gym.previousDone, gym.previousOf, gym.streak], [5, 5, 5, 5, 10], 'weekdays only; the weekend does not break the streak');
  assert.deepEqual([d.spending.totalFils, d.spending.count, d.spending.totalLabel], [17050, 3, 'AED 170.50']); assert.deepEqual(d.spending.byCategory.map(x => x.category + ':' + x.fils), ['transport:12050', 'food:5000']);
  assert.deepEqual([d.spending.budget.monthToDateFils, d.spending.budget.usedPct, d.spending.budget.monthlyLabel], [47550, 16, 'AED 3,000']);
  assert.deepEqual(d.slipped.items.map(x => x.kind + ':' + x.title + ':' + x.daysLate), ['Task:Renew passport:8', 'Promise:Send proposal (to Noor):4', 'Task:Finished late:3', 'Promise:Share the report (to Omar):3'], 'still open, or only finished after the week ended');
  assert.equal(d.slipped.total, 4);
  const [p1, p2, p3] = d.priorities.items; assert.equal(p1.title, 'Renew passport'); assert.match(p1.why, /^Due 10 Oct, 8 days overdue at the end of the week\./); assert.match(p1.rule, /^Rule 1/);
  assert.equal(p2.title, 'Pay rent'); assert.match(p2.why, /^Due Thursday 22 Oct\./); assert.match(p2.rule, /19 Oct to 25 Oct/); assert.equal(p3.title, 'Read'); assert.equal(p3.why, 'Done 5 times this week, 7 the week before.');
  assert.equal(d.weeks.length, 12); assert.match(d.weeks[0].label, /\(this week\)$/); assert.match(d.weeks[1].label, /\(last week\)$/); assert.equal(d.weeks[1].from, '2026-10-12');
});

test('copy as text and download as Markdown carry the same facts', async () => {
  const { s, a } = await setup(); fixture(s.app.db); const d = await review(a);
  assert.match(d.text, /^WEEKLY REVIEW: 12 Oct to 18 Oct 2026/); assert.match(d.text, /Finished 4 tasks\./); assert.match(d.text, /Spent AED 170\.50 in 3 purchases\./); assert.match(d.text, /Rule 1: the item that is the most overdue\./);
  assert.match(d.markdown, /^# Weekly Review: 12 Oct to 18 Oct 2026/); assert.match(d.markdown, /\n## What I finished\n/); assert.match(d.markdown, /\n1\. Task: Renew passport\./); assert.match(d.markdown, /Month so far: AED 475\.50 of AED 3,000 \(16%\)\./);
  assert.ok(!/<|>/.test(d.text.replace(/->/g, '')), 'plain text, no markup');
});

test('an empty week says "not enough data yet" in every section and never invents a number', async () => {
  const { a } = await setup(); const d = await review(a);
  for (const k of ['finished', 'promises', 'focus', 'habits', 'spending']) { assert.equal(d[k].empty, true, k); assert.match(d[k].message, /^Not enough data yet: /, k); }
  assert.match(d.slipped.message, /^Nothing slipped/); assert.match(d.spending.budgetMessage, /No monthly budget is set/); assert.equal(d.finished.total, 0);
  assert.deepEqual(d.priorities.items.map(x => x.title), [null, null, null]); assert.deepEqual(d.priorities.items.map(x => x.why), ['Nothing was overdue.', 'Nothing is due in the next 7 days.', 'No habit dropped.']);
  assert.match(d.text, /Not enough data yet: no tasks were finished this week\./);
});

test('choose a week: any date in it, this week is marked "not over yet", earlier weeks work, bad or future dates are refused in plain words', async () => {
  const { s, a } = await setup(); fixture(s.app.db);
  const mid = await review(a, '?week=2026-10-14'); assert.equal(mid.week.from, '2026-10-12'); assert.equal(mid.finished.total, 4);
  const cur = await review(a, '?week=2026-10-21'); assert.equal(cur.week.from, '2026-10-19'); assert.equal(cur.week.inProgress, true); assert.equal(cur.week.note, 'This week is not over yet, so the numbers are so far.'); assert.equal(cur.finished.total, 2, 'the task done on Monday 19 Oct at 00:10, and the one finished on Tuesday');
  const before = await review(a, '?week=2026-10-05'); assert.equal(before.week.to, '2026-10-11'); assert.equal(before.finished.total, 1, '23:50 on Sunday 11 Oct belongs to that week'); assert.equal(before.habits.items.find(h => h.name === 'Read').done, 7);
  for (const bad of ['friday', '2026-13-45', '2026-10-5']) { const r = await a.get('/api/review?week=' + bad); assert.equal(r.status, 400, bad); assert.match(r.json.error.message, /^Choose a week by a date/); }
  const fut = await a.get('/api/review?week=2026-10-26'); assert.equal(fut.status, 400); assert.match(fut.json.error.message, /^That week has not started yet/);
});

test('reading writes nothing, needs sign-in, and never uses another person\'s data', async () => {
  const { s, a, b } = await setup(); fixture(s.app.db); task(s.app.db, 2, 'Mallory secret task', '2026-10-10', 'open'); exp(s.app.db, 2, '2026-10-13', 99900, 'fun');
  const snap = () => JSON.stringify(['tasks', 'commitments', 'expenses', 'habits', 'focus_sessions', 'notifications', 'runs', 'approvals'].map(t => s.app.db.prepare('SELECT COUNT(*) n FROM ' + t).get().n)), before = snap();
  const mine = await review(a), theirs = await review(b); assert.equal(snap(), before);
  assert.doesNotMatch(JSON.stringify(mine), /Mallory secret|999/); assert.doesNotMatch(JSON.stringify(theirs), /Renew passport|Sara|Gym/); assert.equal(theirs.spending.totalFils, 99900); assert.equal(theirs.finished.total, 0);
  assert.equal((await s.client().get('/api/review')).status, 401);
});

test('the Sunday notification is off by default, then adds ONE bell notification per week that opens the review', async () => {
  const { s, a } = await setup(); fixture(s.app.db);
  await s.app.scheduler.tick();     // creates each person's schedules
  const jump = async iso => { clock.t = at(iso); await a.login('roshan@example.com'); };       // sessions expire as the fake clock moves days ahead
  const list = () => a.get('/api/schedules').then(r => { assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.schedules; }), job = async () => (await list()).find(x => x.kind === 'weekly_review');
  let j = await job(); assert.deepEqual([j.name, j.enabled, j.time, j.days], ['Weekly review notification', false, '18:00', '0']); assert.match(j.daysLabel, /Sun/);
  await jump('2026-10-25T18:30:00'); await s.app.scheduler.tick(); assert.equal(s.app.db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'review'").get().n, 0, 'off means nothing happens');
  await jump('2026-10-24T12:00:00'); await a.patch('/api/schedules/' + j.id, { enabled: true }); j = await job(); assert.equal(j.enabled, true); assert.ok(j.nextRunAt > clock.t);
  await jump('2026-10-25T18:00:30'); await s.app.scheduler.tick(); await s.app.scheduler.tick();
  const notes = s.app.db.prepare("SELECT * FROM notifications WHERE kind = 'review'").all(); assert.equal(notes.length, 1); assert.equal(notes[0].link, '#weekreview'); assert.equal(notes[0].title, 'Your weekly review is ready'); assert.match(notes[0].body, /three suggested priorities/);
  const run = await a.post('/api/schedules/' + j.id + '/run'); assert.equal(run.status, 200); assert.equal(s.app.db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'review'").get().n, 1, 'the same week is never notified twice');
  await jump('2026-11-01T18:00:30'); await s.app.scheduler.tick(); assert.equal(s.app.db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'review'").get().n, 2, 'the next Sunday is a new week');
});

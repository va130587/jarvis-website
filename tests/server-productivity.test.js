// Plan my day, focus sessions and weekly insights, with a fake clock in Dubai time.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
const { guessMinutes } = require('../server/productivity');
test.after(closeAll);
const at = iso => Date.parse(iso + '+04:00');
function clock(t) { const c = { t, now: () => c.t }; return c; }
async function setup(t) { const k = clock(t); const s = await boot({}, { now: k.now }); const c = s.client(); await c.login('roshan@example.com'); return { s, c, k }; }
const task = (db, title, due, o) => db.prepare("INSERT INTO tasks (user_id, title, due, status, created_at, completed_at, estimate_min) VALUES (1, ?, ?, ?, ?, ?, ?)").run(title, due, (o && o.status) || 'open', (o && o.created) || 1, (o && o.done) || null, (o && o.est) || null).lastInsertRowid;

test('estimates: explicit beats a labelled guess from the wording', () => {
  assert.equal(guessMinutes('Call the bank'), 15); assert.equal(guessMinutes('Review the contract'), 30); assert.equal(guessMinutes('Write the project report'), 60); assert.equal(guessMinutes('Something'), 30);
});

test('plan my day: order by urgency, reasons, lunch protected, breaks after 90 minutes, what does not fit, no changes made', async () => {
  const { s, c } = await setup(at('2026-10-19T08:00:00'));            // Monday, before work
  const db = s.app.db;
  task(db, 'Prepare the client presentation', '2026-10-19', { est: 120 }); task(db, 'Call the bank', '2026-10-16'); task(db, 'Write the project report', '2026-10-20');
  task(db, 'Study for the exam', '2026-10-21', { est: 90 }); task(db, 'Clean the inbox', null, { created: 5 }); task(db, 'Far future', '2026-12-01');
  s.app.pl.create(1, { title: 'send the proposal', direction: 'i_owe', counterparty: 'Alex', deadline: '2026-10-19' });
  const before = db.prepare('SELECT COUNT(*) n FROM tasks').get().n;
  const p = (await c.get('/api/plan')).json.proposal;
  const work = p.blocks.filter(b => b.minutes);
  assert.deepEqual(work.map(b => b.title), ['Call the bank', 'Prepare the client presentation', 'send the proposal', 'Write the project report', 'Study for the exam', 'Clean the inbox']);
  assert.equal(work[0].start, '09:00'); assert.equal(work[0].why, 'Overdue (3 days late)'); assert.equal(work[0].guessed, true); assert.equal(work[0].minutes, 15);
  assert.equal(work[1].guessed, false); assert.equal(work[1].minutes, 120);
  assert.equal(work[2].kind, 'promise'); assert.match(work[2].why, /Promised to Alex for today/);
  assert.ok(!p.blocks.some(b => b.title === 'Far future'), 'far-off tasks are not planned');
  const lunch = p.blocks.find(b => b.kind === 'lunch'); assert.deepEqual([lunch.start, lunch.end], ['13:00', '14:00']);
  for (const b of work) assert.ok(b.end <= '13:00' || b.start >= '14:00', 'nothing runs through lunch: ' + b.title);
  assert.ok(p.blocks.some(b => b.kind === 'break'), 'a short break after 90 minutes of focus');
  for (let i = 1; i < p.blocks.length; i++) assert.ok(p.blocks[i].start >= p.blocks[i - 1].end, 'no overlaps');
  assert.ok(work.every(b => b.end <= '18:00'));
  assert.match(p.summary, /^Planned 6 of 6 items/); assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks').get().n, before, 'planning changes nothing');
  // a short day: some things do not fit, and it says why
  const short = (await c.get('/api/plan?start=09:00&end=11:00&lunch=off')).json.proposal;
  assert.ok(short.unscheduled.length >= 3); assert.match(short.unscheduled[0].why, /does not fit in the time left/);
  assert.equal((await c.get('/api/plan?start=9am')).status, 400); assert.equal((await c.get('/api/plan?start=10:00&end=10:30')).status, 400);
  await s.close();
});

test('plan: starts from now during the day; after hours it plans tomorrow; empty day says so; saved plans; estimates validated', async () => {
  const { s, c, k } = await setup(at('2026-10-19T10:07:00'));
  task(s.app.db, 'Call the bank', '2026-10-19');
  let p = (await c.get('/api/plan')).json.proposal; assert.equal(p.window.from, '10:15'); assert.equal(p.blocks[0].start, '10:15');
  k.t = at('2026-10-19T19:30:00'); await c.login('roshan@example.com');
  p = (await c.get('/api/plan')).json.proposal; assert.equal(p.day, '2026-10-20'); assert.match(p.note, /plan for tomorrow/); assert.match(p.blocks[0].why, /Overdue \(yesterday\)/);
  const saved = (await c.post('/api/plan', { start: '08:00', end: '16:00' })).json.saved; assert.equal(saved.window.start, '08:00');
  assert.equal((await c.get('/api/plan')).json.saved.day, '2026-10-20');
  assert.equal((await c.patch('/api/tasks/1/estimate', { minutes: 45 })).status, 200);
  assert.equal((await c.get('/api/plan')).json.proposal.blocks[0].minutes, 45);
  for (const bad of [{ minutes: 2 }, { minutes: 1000 }, { minutes: 'soon' }, { minutes: 4.5 }]) assert.equal((await c.patch('/api/tasks/1/estimate', bad)).status, 400);
  const m = s.client(); await m.login('mallory@example.com');
  assert.equal((await m.patch('/api/tasks/1/estimate', { minutes: 30 })).status, 404);
  assert.match((await m.get('/api/plan')).json.proposal.summary, /Nothing is due or overdue/);
  await s.close();
});

test('focus sessions: one at a time, stop early or finish, closed automatically if you walk away, totals, private', async () => {
  const { s, c, k } = await setup(at('2026-10-19T09:00:00'));
  const tid = Number(task(s.app.db, 'Write the report', '2026-10-19'));
  let f = (await c.post('/api/focus/start', { taskId: tid, minutes: 50 })).json.session;
  assert.equal(f.title, 'Write the report'); assert.equal(f.status, 'running'); assert.equal(f.remainingMs, 50 * 60e3);
  assert.equal((await c.post('/api/focus/start', { minutes: 25 })).status, 409, 'one session at a time');
  k.t += 20 * 60e3;
  assert.equal((await c.get('/api/focus')).json.running.remainingMs, 30 * 60e3);
  f = (await c.post('/api/focus/' + f.id + '/stop')).json.session; assert.equal(f.status, 'stopped'); assert.equal(f.minutes, 20);
  f = (await c.post('/api/focus/start', { title: 'Inbox zero', minutes: 25 })).json.session;
  k.t += 25 * 60e3;
  f = (await c.post('/api/focus/' + f.id + '/stop')).json.session; assert.equal(f.status, 'completed'); assert.equal(f.minutes, 25);
  f = (await c.post('/api/focus/start', { title: 'Forgot to stop', minutes: 30 })).json.session;
  k.t += 3 * 3600e3;                                                     // walked away
  let st = (await c.get('/api/focus')).json;
  assert.equal(st.running, null); assert.equal(st.today[0].status, 'completed'); assert.equal(st.today[0].minutes, 30, 'counted only up to its planned end');
  assert.equal(st.todayMin, 75);
  task(s.app.db, 'x', null); assert.equal(s.app.db.prepare('SELECT task_id FROM focus_sessions WHERE id = 1').get().task_id, tid);
  for (const bad of [{ minutes: 2 }, { minutes: 500 }, { minutes: '25' }, { taskId: 999 }]) assert.ok([400, 404].includes((await c.post('/api/focus/start', bad)).status), JSON.stringify(bad));
  const m = s.client(); await m.login('mallory@example.com');
  assert.equal((await m.get('/api/focus')).json.todayMin, 0);
  assert.equal((await m.post('/api/focus/1/stop')).status, 404);
  assert.equal((await m.post('/api/focus/start', { taskId: tid })).status, 404, 'cannot focus on someone else\'s task');
  await s.close();
});

test('weekly insights: done per day, on-time rate, focus trend, reliability from ProofLoop, overdue, plain sentences', async () => {
  const { s, c } = await setup(at('2026-10-22T18:00:00'));           // Thursday
  const db = s.app.db;
  task(db, 'a', '2026-10-20', { status: 'done', done: at('2026-10-20T10:00:00') }); task(db, 'b', '2026-10-20', { status: 'done', done: at('2026-10-21T10:00:00') });
  task(db, 'c', null, { status: 'done', done: at('2026-10-20T15:00:00') }); task(db, 'd', null, { status: 'done', done: at('2026-10-14T10:00:00') }); task(db, 'late one', '2026-10-15');
  const fs = (st, min) => db.prepare("INSERT INTO focus_sessions (user_id, title, planned_min, started_at, ended_at, status) VALUES (1, 'f', ?, ?, ?, 'completed')").run(min, st, st + min * 60e3);
  fs(at('2026-10-20T09:00:00'), 50); fs(at('2026-10-21T09:00:00'), 25); fs(at('2026-10-13T09:00:00'), 25);
  const close = (deadline, closed) => { const id = s.app.pl.create(1, { title: 'p' + deadline, direction: 'i_owe', deadline }); db.prepare("UPDATE commitments SET status = 'completed', closed_at = ? WHERE id = ?").run(closed, id); };
  close('2026-10-15', at('2026-10-14T12:00:00')); close('2026-10-18', at('2026-10-18T20:00:00')); close('2026-10-19', at('2026-10-21T09:00:00'));
  s.app.pl.create(1, { title: 'still owed', direction: 'i_owe', deadline: '2026-10-17' });
  const r = (await c.get('/api/insights')).json;
  assert.deepEqual(r.week, { start: '2026-10-19', end: '2026-10-25' });
  assert.deepEqual(r.days.map(d => d.done), [0, 2, 1, 0, 0, 0, 0]); assert.deepEqual(r.days.map(d => d.focusMin), [0, 50, 25, 0, 0, 0, 0]);
  assert.deepEqual(r.days.map(d => d.future), [false, false, false, false, true, true, true]);
  assert.equal(r.totals.done, 3); assert.equal(r.totals.doneLastWeek, 1); assert.equal(r.totals.onTimePct, 50, 'b was done a day after its due date');
  assert.equal(r.totals.focusMin, 75); assert.equal(r.totals.focusMinLastWeek, 25); assert.equal(r.totals.overdue, 2);
  assert.deepEqual(r.reliability, { score: 50, kept: 2, judged: 4, windowDays: 28 });
  assert.ok(r.lines.includes('Focus time is up 200% on last week (1h 15m vs 25m).'), r.lines.join(' | '));
  assert.ok(r.lines.includes('Tuesday was your most productive day (2 tasks done).'));
  assert.ok(r.lines.includes('You kept 2 of 4 promises on time over the last four weeks (50%).'));
  assert.ok(r.lines.some(l => /2 items are overdue; the oldest is "late one" \(7 days late\)/.test(l)), r.lines.join(' | '));
  const chat = (await c.post('/api/chat', { message: 'how was my week?' })).json;
  assert.equal(chat.status, 'completed'); assert.match(chat.reply, /Focus time is up 200%/);
  assert.match((await c.post('/api/chat', { message: 'plan my day' })).json.reply, /plan for tomorrow|Planned|Nothing is due/);
  const m = s.client(); await m.login('mallory@example.com');
  const e = (await m.get('/api/insights')).json; assert.equal(e.totals.done, 0); assert.equal(e.reliability.score, null); assert.match(e.lines[0], /quiet week/);
  await s.close();
});

test('deleting all data removes focus sessions and day plans', async () => {
  const { s, c } = await setup(at('2026-10-19T09:00:00'));
  await c.post('/api/focus/start', { minutes: 25 }); await c.post('/api/plan', {});
  await c.post('/api/data/delete', { scope: 'all', confirm: 'DELETE MY DATA' });
  for (const t of ['focus_sessions', 'day_plans']) assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM ' + t).get().n, 0, t);
  await s.close();
});

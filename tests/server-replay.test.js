// Day Replay (server): one Dubai day of what NOVA did, in order, from its own records; read-only; private; bounded.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);
const at = iso => Date.parse(iso + '+04:00');
async function setup() { const k = { t: at('2026-10-22T15:00:00'), now: () => k.t };
  // "today" is the 22nd: the test's own sign-in lands there, not on the 21st being checked
  const s = await boot({}, { now: k.now }); const c = s.client(); await c.login('roshan@example.com'); return { s, c, k }; }
const run = (s, uid, request, ts) => Number(s.app.db.prepare("INSERT INTO runs (user_id, request, status, planner, created_at, updated_at) VALUES (?, ?, 'completed', 'rules', ?, ?)").run(uid, request, ts, ts).lastInsertRowid);
const step = (s, uid, runId, seq, kind, summary, ts) => s.app.db.prepare('INSERT INTO run_steps (run_id, user_id, seq, kind, summary, ts) VALUES (?, ?, ?, ?, ?, ?)').run(runId, uid, seq, kind, summary, ts);

test('events of one Dubai day in time order, from every source, with plain titles; internal steps are left out', async () => {
  const { s, c } = await setup(); const uid = 1, D = '2026-10-21';
  const r = run(s, uid, 'add a task to call the bank', at(D + 'T09:00:00'));
  step(s, uid, r, 1, 'request', 'You asked: add a task to call the bank', at(D + 'T09:00:00'));
  step(s, uid, r, 2, 'plan', 'internal planning detail', at(D + 'T09:00:01'));                       // not shown
  step(s, uid, r, 3, 'tool_call', 'internal tool call', at(D + 'T09:00:01'));                        // not shown
  step(s, uid, r, 4, 'approval_requested', 'Waiting for your approval: create a task', at(D + 'T09:00:02'));
  step(s, uid, r, 5, 'approval_granted', 'You approved: tasks.create.', at(D + 'T09:01:10'));
  step(s, uid, r, 6, 'verified', 'Read back from the database: task #5 exists.', at(D + 'T09:01:11'));
  const c1 = Number(s.app.db.prepare("INSERT INTO commitments (user_id, title, direction, status, source_type, created_at, updated_at) VALUES (?, 'Send the proposal', 'i_owe', 'awaiting_confirmation', 'manual', 1, 1)").run(uid).lastInsertRowid);
  s.app.db.prepare("INSERT INTO commitment_events (commitment_id, user_id, seq, from_status, to_status, note, actor, ts) VALUES (?, ?, 1, 'submitted', 'awaiting_confirmation', 'Task created', 'nova', ?)").run(c1, uid, at(D + 'T09:01:12'));
  s.app.db.prepare("INSERT INTO notifications (user_id, kind, title, body, link, created_at) VALUES (?, 'briefing', 'Your daily briefing', 'You have 2 overdue items', '#briefing', ?)").run(uid, at(D + 'T07:30:00'));
  s.app.db.prepare("INSERT INTO focus_sessions (user_id, title, planned_min, started_at, ended_at, status) VALUES (?, 'Write the report', 25, ?, ?, 'completed')").run(uid, at(D + 'T10:00:00'), at(D + 'T10:25:00'));
  const sc = Number(s.app.db.prepare("INSERT INTO schedules (user_id, kind, hour, minute, days, enabled, created_at, updated_at) VALUES (?, 'briefing', 7, 30, 'daily', 1, 1, 1)").run(uid).lastInsertRowid);
  s.app.db.prepare("INSERT INTO schedule_runs (schedule_id, user_id, kind, due_at, trigger, status, started_at, finished_at, summary) VALUES (?, ?, 'briefing', ?, 'schedule', 'done', ?, ?, 'Briefing made')").run(sc, uid, at(D + 'T07:30:00'), at(D + 'T07:30:00'), at(D + 'T07:30:02'));
  s.app.db.prepare("INSERT INTO audit_log (user_id, ts, action, detail) VALUES (?, ?, 'login', 'dev'), (?, ?, 'email_send_refused', 'draft 3'), (?, ?, 'rate_limited_internal', 'x')").run(uid, at(D + 'T06:55:00'), uid, at(D + 'T11:00:00'), uid, at(D + 'T11:01:00'));
  const j = (await c.get('/api/replay?day=' + D)).json;
  assert.equal(j.day, D); assert.equal(j.today, '2026-10-22');
  assert.deepEqual(j.events.map(e => e.at), j.events.map(e => e.at).slice().sort(), 'in time order');
  assert.deepEqual(j.events.map(e => e.title), ['You signed in', 'NOVA told you: Your daily briefing', 'Scheduled job: briefing (done)', 'You asked', 'Preview shown, waiting for you', 'You approved', 'Result checked', 'ProofLoop: Awaiting Confirmation', 'Focus started', 'Focus finished', 'NOVA refused to send e-mail (read-only access)']);
  assert.equal(j.events.find(e => e.title === 'You asked').detail, 'You asked: add a task to call the bank');
  assert.equal(j.total, 11); assert.equal(j.first, '06:55:00'); assert.equal(j.last, '11:00:00'); assert.equal(j.hours.length, 24); assert.equal(j.hours[9], 5); assert.equal(j.hours[7], 2); assert.equal(j.hours[10], 2);
  assert.ok(!j.events.some(e => /internal/.test(e.detail)), 'internal steps and unlisted audit actions are not shown');
});

test('the day is a Dubai day: 23:59 and 00:00 fall on different days; empty days say so; bad or future days are refused', async () => {
  const { s, c } = await setup(); const uid = 1, r = run(s, uid, 'x', 1);
  step(s, uid, r, 1, 'request', 'late', at('2026-10-20T23:59:59')); step(s, uid, r, 2, 'request', 'early', at('2026-10-21T00:00:00'));
  assert.deepEqual((await c.get('/api/replay?day=2026-10-20')).json.events.map(e => e.detail), ['late']);
  assert.deepEqual((await c.get('/api/replay?day=2026-10-21')).json.events.map(e => e.detail), ['early']);
  const empty = (await c.get('/api/replay?day=2026-09-01')).json; assert.equal(empty.total, 0); assert.deepEqual(empty.events, []); assert.equal(empty.first, null);
  for (const bad of ['yesterday', '2026-13-01', '2026-02-30', '2026-10-21x', '1999-01-01', '2027-01-01']) assert.equal((await c.get('/api/replay?day=' + bad)).status, 400, bad);
  assert.equal((await c.get('/api/replay')).json.day, '2026-10-22', 'default is today in Dubai');
});

test('private and read-only: nobody sees another user\'s events, signed-out is refused, reading changes nothing, 600 events are capped at 500 and say so', async () => {
  const { s, c } = await setup(); const D = '2026-10-21';
  const m = s.client(); await m.login('mallory@example.com');
  const r = run(s, 1, 'secret request', at(D + 'T08:00:00')); step(s, 1, r, 1, 'request', 'You asked: secret request', at(D + 'T08:00:00'));
  assert.equal((await m.get('/api/replay?day=' + D)).json.total, 0);
  assert.equal((await s.client().get('/api/replay')).status, 401);
  s.app.db.exec('BEGIN'); for (let i = 0; i < 600; i++) step(s, 1, r, 10 + i, 'verified', 'Checked ' + i, at(D + 'T09:00:00') + i * 1000); s.app.db.exec('COMMIT');
  const dump = () => JSON.stringify(['runs', 'run_steps', 'audit_log', 'notifications'].map(t => s.app.db.prepare('SELECT COUNT(*) n FROM ' + t).get().n));
  const before = dump(); const j = (await c.get('/api/replay?day=' + D)).json;
  assert.equal(j.total, 601); assert.equal(j.events.length, 500); assert.equal(j.truncated, true); assert.equal(dump(), before);
});

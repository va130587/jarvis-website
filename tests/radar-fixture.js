// Shared by the Life Radar tests: one fixed week of data (clock: Wednesday 21 October 2026, 15:00 Dubai) whose radar numbers are known.
'use strict';
const at = iso => Date.parse(iso + '+04:00');
const run = (db, sql, ...a) => db.prepare(sql).run(...a);
const NOW = at('2026-10-21T15:00:00');
function seed(db, uid) {
  uid = uid || 1;
  const P = (title, dir, status, deadline, closed, updated) => run(db, "INSERT INTO commitments (user_id, title, direction, status, deadline, source_type, closed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)", uid, title, dir, status, deadline, closed, at('2026-10-01T09:00:00'), updated || closed || at('2026-10-01T09:00:00'));
  // promises: this week 1 of 3 kept (one late, one still open after its day; one due today is not judged yet); last week 2 of 2
  P('A kept', 'i_owe', 'completed', '2026-10-20', at('2026-10-20T12:00:00')); P('B late', 'i_owe', 'completed', '2026-10-19', at('2026-10-21T10:00:00'));
  P('C due today', 'i_owe', 'task_prepared', '2026-10-21', null); P('D open and late', 'i_owe', 'task_prepared', '2026-10-20', null); P('Owed to me', 'owed_to_me', 'awaiting_confirmation', '2026-10-19', null);
  P('E verified', 'i_owe', 'verified', '2026-10-14', null, at('2026-10-13T10:00:00')); P('F kept', 'i_owe', 'completed', '2026-10-15', at('2026-10-15T09:00:00'));
  // focus: 90 min this week, 150 last week
  const F = (a, b) => run(db, "INSERT INTO focus_sessions (user_id, title, planned_min, started_at, ended_at, status) VALUES (?, 'f', 30, ?, ?, 'completed')", uid, at(a), at(b));
  F('2026-10-20T10:00:00', '2026-10-20T10:30:00'); F('2026-10-21T09:00:00', '2026-10-21T10:00:00'); F('2026-10-13T09:00:00', '2026-10-13T10:00:00'); F('2026-10-14T09:00:00', '2026-10-14T10:30:00');
  // habits: Read (daily): 2 of 3 days, last week 5 of 7. Gym (weekdays): 3 of 3, last week 5 of 5 (a Saturday check-in does not count).
  const H = (name, sch) => Number(run(db, 'INSERT INTO habits (user_id, name, schedule, archived, created_at) VALUES (?, ?, ?, 0, ?)', uid, name, sch, at('2026-10-01T09:00:00')).lastInsertRowid);
  const read = H('Read', 'daily'), gym = H('Gym', 'weekdays'), chk = (h, days) => days.forEach(d => run(db, 'INSERT INTO habit_checks (habit_id, user_id, day, created_at) VALUES (?, ?, ?, 1)', h, uid, d));
  chk(read, ['2026-10-19', '2026-10-21', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']); chk(gym, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
  // money: budget AED 3,000 a month; AED 200 this week (3 days so far), AED 1,000 last week
  run(db, "INSERT INTO budgets (user_id, category, monthly_fils) VALUES (?, 'total', 300000)", uid);
  const E = (day, f) => run(db, "INSERT INTO expenses (user_id, amount_fils, category, day, created_at) VALUES (?, ?, 'food', ?, 1)", uid, f, day);
  E('2026-10-20', 20000); E('2026-10-14', 100000); run(db, "INSERT INTO expenses (user_id, amount_fils, category, day, created_at, deleted_at) VALUES (?, 99999999, 'food', '2026-10-20', 1, 5)", uid);   // a deleted one never counts
  // overdue: now: a task due the 18th (open) + promise D = 2. At the end of last week: a task due the 16th that was only finished on the 20th = 1.
  const T = (title, due, status, created, done, deleted) => run(db, "INSERT INTO tasks (user_id, title, due, status, created_at, completed_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)", uid, title, due, status, created, done || null, deleted || null);
  T('Open and late', '2026-10-18', 'open', at('2026-10-10T09:00:00')); T('Finished on time', '2026-10-20', 'done', at('2026-10-10T09:00:00'), at('2026-10-20T09:00:00'));
  T('Due today', '2026-10-21', 'open', at('2026-10-10T09:00:00')); T('Late then finished', '2026-10-16', 'done', at('2026-10-10T09:00:00'), at('2026-10-20T08:00:00')); T('Deleted', '2026-10-01', 'open', at('2026-10-02T09:00:00'), null, at('2026-10-03T09:00:00'));
}
module.exports = { seed, at, NOW };

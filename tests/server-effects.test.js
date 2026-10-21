// "What happens if": every approval preview carries an Effects list worked out from real data before you approve. Facts only,
// "no other effects" when nothing is touched, nothing for read tools, and nothing is written by looking.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
const { createEffects } = require('../server/effects');
test.after(closeAll);

const at = iso => Date.parse(iso + '+04:00');
const NOW = at('2026-10-19T08:00:00');                           // Monday 19 Oct 2026, Dubai
async function setup() { const s = await boot({}, { now: () => NOW }); const c = s.client(); await c.login('roshan@example.com'); return { s, c, db: s.app.db, fx: createEffects(s.app.db, { now: () => NOW }) }; }
const chat = (c, m) => c.post('/api/chat', { message: m }).then(r => r.json);
const run = (db, sql, ...a) => db.prepare(sql).run(...a);
const U = { id: 1 };
const addTask = (db, title, due, status, extra) => Number(run(db, "INSERT INTO tasks (user_id, title, due, status, created_at) VALUES (1, ?, ?, ?, 1)", title, due, status || 'open').lastInsertRowid);
const addC = (db, title, status, deadline, taskId) => Number(run(db, "INSERT INTO commitments (user_id, title, direction, status, deadline, task_id, source_type, created_at, updated_at) VALUES (1, ?, 'i_owe', ?, ?, ?, 'manual', 1, 1)", title, status, deadline, taskId || null).lastInsertRowid);
const savePlan = (db, day, blocks) => run(db, 'INSERT INTO day_plans (user_id, day, data, created_at) VALUES (1, ?, ?, 1)', day, JSON.stringify({ day, blocks }));

test('through the chat: a task with a date shows what else falls on that day, the ProofLoop tracking and the saved plan, all before you approve and without changing anything', async () => {
  const { c, db } = await setup();
  addTask(db, 'Prepare the slides', '2026-10-23'); addC(db, 'Send the proposal', 'awaiting_confirmation', '2026-10-23'); addC(db, 'Already finished', 'completed', '2026-10-23');
  savePlan(db, '2026-10-23', [{ kind: 'task', title: 'Prepare the slides', start: '09:00', end: '10:00', taskId: null }, { kind: 'lunch', title: 'Lunch', start: '13:00', end: '14:00' }]);
  const counts = () => ['tasks', 'notes', 'expenses', 'reminders', 'habit_checks', 'memories'].map(t => db.prepare('SELECT COUNT(*) n FROM ' + t).get().n).join(',');
  const before = counts();
  const r = await chat(c, 'add a task to call HR by friday'); assert.equal(r.status, 'awaiting_approval');
  assert.deepEqual(r.run.pendingApproval.preview.effects, [
    '2 other items are already due on Friday 23 October: “Prepare the slides”, “Send the proposal”.',
    'NOVA will also track it in ProofLoop as something you owe, due 2026-10-23. It will wait in Awaiting Confirmation: NOVA cannot see whether you did it.',
    'You have a saved plan for Friday 23 October (1 work block). This task is not in it; plan the day again to include it.']);
  assert.equal(counts(), before, 'looking changes nothing');
  assert.equal(db.prepare('SELECT status FROM approvals WHERE id = ?').get(r.run.pendingApproval.id).status, 'pending');
});

test('a task with no date: nothing else is affected, and it says so; a note and a memory have no effects; read tools have no preview at all', async () => {
  const { c, db } = await setup();
  const t = await chat(c, 'add a task to water the plants'); assert.deepEqual(t.run.pendingApproval.preview.effects, []);
  const n = await chat(c, 'add a note that the lab is closed on Sunday'); assert.deepEqual(n.run.pendingApproval.preview.effects, []);
  const read = await chat(c, 'what are my tasks'); assert.equal(read.run.pendingApproval, null); assert.equal(read.status, 'completed');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM approvals').get().n, 2, 'only the two changes asked for approval');
});

test('completing a task: the ProofLoop commitment it closes (told apart from one it will not touch), a running focus session, a block in today\'s plan', async () => {
  const { c, db, fx } = await setup();
  const t = addTask(db, 'Send the portfolio link', '2026-10-21'); addC(db, 'Send the portfolio link', 'awaiting_confirmation', '2026-10-21', t);
  assert.deepEqual(fx.effects(U, 'tasks.complete', { id: t }), ['It closes your ProofLoop commitment “Send the portfolio link” (#1): your confirmation is recorded as self-reported evidence, then the commitment is Completed.']);
  const t2 = addTask(db, 'Other', null); addC(db, 'Prepared only', 'task_prepared', null, t2);
  assert.deepEqual(fx.effects(U, 'tasks.complete', { id: t2 }), ['Your ProofLoop commitment “Prepared only” (#2) is linked to this task, but it is Task Prepared, so it will not be changed.']);
  run(db, "INSERT INTO focus_sessions (user_id, task_id, title, planned_min, started_at, status) VALUES (1, ?, 'f', 25, ?, 'running')", t, NOW); savePlan(db, '2026-10-19', [{ kind: 'task', title: 'Send the portfolio link', start: '09:00', end: '09:30', taskId: t }]);
  assert.deepEqual(fx.effects(U, 'tasks.complete', { id: t }).slice(1), ['A focus session on this task is running; it keeps running until you stop it.', 'It is a block in your saved plan for today (09:00 to 09:30); the plan is not changed.']);
  assert.deepEqual(fx.effects(U, 'tasks.complete', { id: 999 }), [], 'an unknown task: nothing to say');
  const r = await chat(c, 'mark Other as done'); if (r.run && r.run.pendingApproval) assert.ok(Array.isArray(r.run.pendingApproval.preview.effects));
});

test('deleting a task leaves its commitment open and says so; confirming a commitment also marks its open task done', async () => {
  const { db, fx } = await setup(); const t = addTask(db, 'Call the bank', '2026-10-22'); const c = addC(db, 'Call the bank', 'awaiting_confirmation', '2026-10-22', t);
  assert.deepEqual(fx.effects(U, 'tasks.delete', { id: t }), ['Your ProofLoop commitment “Call the bank” (#' + c + ') is linked to this task. Deleting the task does not close it: it stays Awaiting Confirmation.']);
  assert.deepEqual(fx.effects(U, 'commitments.confirm', { id: c }), ['Task #' + t + ' “Call the bank” will also be marked done.']);
  db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(t); assert.deepEqual(fx.effects(U, 'commitments.confirm', { id: c }), []);
  assert.deepEqual(fx.effects(U, 'commitments.create', { title: 'x', direction: 'i_owe', deadline: '2026-10-22' }), ['1 other item is already due on Thursday 22 October: “Call the bank”.']);
  assert.deepEqual(fx.effects(U, 'commitments.create', { title: 'x', direction: 'i_owe', deadline: '2026-10-01' }), ['That date has already passed, so it will be overdue as soon as it is created.']);
});

test('a date in the past and a duplicate title are flagged on a new task', async () => {
  const { db, fx } = await setup(); addTask(db, 'Renew the visa', null);
  assert.deepEqual(fx.effects(U, 'tasks.create', { title: '  renew the VISA ' }), ['You already have an open task with the same title (#1).']);
  const e = fx.effects(U, 'tasks.create', { title: 'Pay the fine', due: '2026-10-17' });
  assert.equal(e[0], 'That date has already passed (2 days ago), so the task will be overdue as soon as it is created.'); assert.match(e[1], /track it in ProofLoop/);
});

test('a reminder: another at the same time, a focus session still running, a block in the saved plan', async () => {
  const { db, fx } = await setup(); const when = at('2026-10-19T15:00:00');
  run(db, "INSERT INTO reminders (user_id, text, due_at, repeat, status, created_at) VALUES (1, 'Call mum', ?, 'none', 'pending', 1)", when + 20e3);
  run(db, "INSERT INTO reminders (user_id, text, due_at, repeat, status, created_at) VALUES (1, 'Much later', ?, 'none', 'pending', 1)", when + 3600e3);
  run(db, "INSERT INTO focus_sessions (user_id, title, planned_min, started_at, status) VALUES (1, 'Write the report', 60, ?, 'running')", when - 20 * 60e3);
  savePlan(db, '2026-10-19', [{ kind: 'task', title: 'Prepare the interview', start: '14:30', end: '16:00', taskId: null }, { kind: 'lunch', title: 'Lunch', start: '13:00', end: '14:00' }]);
  assert.deepEqual(fx.effects(U, 'reminders.create', { text: 'Lock the door', dueAt: when }), ['Another reminder is set for the same time: “Call mum”.', 'A focus session (“Write the report”) will still be running then; it ends at 15:40.', 'At that time your saved plan has “Prepare the interview” (14:30 to 16:00).']);
  assert.deepEqual(fx.effects(U, 'reminders.create', { text: 'Early', dueAt: at('2026-10-19T09:00:00') }), []);
});

test('an expense: where it takes the month against the budget and the 80% and 100% warnings; no budget, no claim', async () => {
  const { db, fx } = await setup();
  assert.deepEqual(fx.effects(U, 'expenses.add', { fils: 5000, category: 'food' }), [], 'no budget set: nothing to compare');
  run(db, "INSERT INTO budgets (user_id, category, monthly_fils) VALUES (1, 'total', 100000)");
  run(db, "INSERT INTO expenses (user_id, amount_fils, category, day, created_at) VALUES (1, 70000, 'food', '2026-10-05', 1), (1, 99999999, 'food', '2026-10-06', 1), (1, 5000, 'food', '2026-09-30', 1)");
  run(db, "UPDATE expenses SET deleted_at = 9 WHERE amount_fils = 99999999");                                    // deleted and last month's never count
  assert.deepEqual(fx.effects(U, 'expenses.add', { fils: 5000, category: 'food' }), ['This month\'s spending goes from AED 700 to AED 750 of your AED 1,000 budget (70% to 75%).']);
  assert.deepEqual(fx.effects(U, 'expenses.add', { fils: 10000, category: 'food' }), ['This month\'s spending goes from AED 700 to AED 800 of your AED 1,000 budget (70% to 80%).', 'This passes 80% of your budget: NOVA will warn you.']);
  assert.deepEqual(fx.effects(U, 'expenses.add', { fils: 30000, category: 'food' }), ['This month\'s spending goes from AED 700 to AED 1,000 of your AED 1,000 budget (70% to 100%).', 'This reaches 100% of your budget: NOVA will warn you.']);
  run(db, "INSERT INTO expenses (user_id, amount_fils, category, day, created_at) VALUES (1, 20000, 'food', '2026-10-07', 1)");
  assert.deepEqual(fx.effects(U, 'expenses.add', { fils: 2000, category: 'food' }), ['This month\'s spending goes from AED 900 to AED 920 of your AED 1,000 budget (90% to 92%).'], 'already past 80%: no second warning');
});

test('private and safe: another user\'s data never appears; unknown tools have no effects; a failing check says null, not "nothing"', async () => {
  const { db, fx } = await setup(); addTask(db, 'Mine', '2026-10-23');
  run(db, "INSERT INTO users (email, display_name, created_at) VALUES ('m@x.com', 'M', 1)");
  assert.deepEqual(fx.effects({ id: 2 }, 'tasks.create', { title: 'x', due: '2026-10-23' }).filter(l => /Mine/.test(l)), []);
  assert.deepEqual(fx.effects(U, 'notes.create', { text: 'x' }), []); assert.deepEqual(fx.effects(U, 'nothing.here', {}), []);
  assert.equal(createEffects({ prepare() { throw new Error('db down'); } }, { now: () => NOW }).effects(U, 'tasks.create', { title: 'x' }), null);
});

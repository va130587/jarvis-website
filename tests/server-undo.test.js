// The Undo list (server): the last 20 changes, what/when, an Undo only after a preview and approval, "what happens if" facts for the undo,
// plain reasons where undoing is not possible, double-click safety, and never anyone else's changes.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);

const T0 = Date.parse('2026-10-21T09:00:00+04:00'), clock = { t: T0 };
async function setup() { const s = await boot({ NOVA_RATE_CHAT_MAX: '100000', NOVA_RATE_API_MAX: '100000' }, { now: () => clock.t }); const a = s.client(), b = s.client(); await a.login('roshan@example.com'); await b.login('mallory@example.com'); clock.t = T0; return { s, a, b }; }
const chat = (c, m) => c.post('/api/chat', { message: m }).then(r => r.json);
const approve = async (c, r) => { const x = await c.post('/api/approvals/' + r.run.pendingApproval.id + '/approve'); assert.equal(x.status, 200, JSON.stringify(x.json)); return x.json; };
const doIt = async (c, text) => { const r = await chat(c, text); assert.ok(r.run && r.run.pendingApproval, text + ' -> ' + JSON.stringify(r).slice(0, 200)); clock.t += 60e3; return approve(c, r); };
// memory changes go through a separate "proposal" path in chat, so their tool runs are written directly here
function seedExec(db, uid, tool, output, ok) {
  const r = Number(db.prepare("INSERT INTO runs (user_id, request, status, planner, created_at, updated_at) VALUES (?, 'x', 'completed', 'rules', 1, 1)").run(uid).lastInsertRowid);
  return Number(db.prepare("INSERT INTO tool_executions (user_id, run_id, tool, input, status, output, undoable, started_at, finished_at) VALUES (?, ?, ?, '{}', 'succeeded', ?, ?, ?, ?)").run(uid, r, tool, JSON.stringify(output), ok ? 1 : 0, clock.t, clock.t).lastInsertRowid);
}
const undoList = c => c.get('/api/undo').then(r => r.json);

test('lists changes newest first with plain words; reads and things that were only previewed are not listed; each person sees only their own', async () => {
  const { a, b } = await setup();
  await doIt(a, 'add a task to call HR by friday'); await doIt(a, 'note that the visa photos need a white background'); await doIt(b, 'add a task to renew passport');
  await chat(a, 'what time is it'); await chat(a, 'add a task to never approved');                 // a read, and a preview nobody approved
  const l = await undoList(a); assert.equal(l.items.length, 2);
  assert.deepEqual(l.items.map(i => i.tool), ['notes.create', 'tasks.create']); assert.equal(l.canUndo, 2);
  assert.match(l.items[1].action, /Create a task/); assert.match(l.items[1].detail, /call HR/i); assert.ok(l.items.every(i => i.state === 'can' && i.at > 0));
  assert.doesNotMatch(JSON.stringify(l), /renew passport/); assert.equal((await undoList(b)).items.length, 1);
  assert.equal((await a.get('/api/undo')).status, 200); assert.equal((await (await boot()).client().get('/api/undo')).status, 401);
});

test('at most the last 20 changes', async () => {
  const { s, a } = await setup(); for (let i = 0; i < 23; i++) await doIt(a, 'note that item ' + i);
  const l = await undoList(a); assert.equal(l.items.length, 20); assert.match(l.items[0].detail, /item 22/); assert.match(l.items[19].detail, /item 3\b/);
});

test('Undo needs a preview and your approval: the preview shows what changes and writes nothing; apply without approval or a token is refused', async () => {
  const { s, a } = await setup(); await doIt(a, 'add a task to call HR by friday'); const it = (await undoList(a)).items[0];
  const tasks = () => s.app.db.prepare('SELECT COUNT(*) n FROM tasks WHERE user_id = 1 AND deleted_at IS NULL').get().n; assert.equal(tasks(), 1);
  const pv = await a.post('/api/undo/' + it.id + '/preview'); assert.equal(pv.status, 200);
  assert.match(pv.json.action, /^Undo: Create a task/); assert.deepEqual(pv.json.changes, ['The task is removed.']); assert.ok(Array.isArray(pv.json.effects)); assert.equal(tasks(), 1, 'a preview changes nothing');
  for (const body of [{ token: pv.json.token }, { token: pv.json.token, approve: 'yes' }, { approve: true }, { token: 'wrong', approve: true }]) { const r = await a.post('/api/undo/' + it.id + '/apply', body); assert.ok([400, 404].includes(r.status), JSON.stringify(body)); assert.equal(tasks(), 1); }
  const ok = await a.post('/api/undo/' + it.id + '/apply', { token: pv.json.token, approve: true }); assert.equal(ok.status, 200); assert.equal(ok.json.ok, true); assert.equal(ok.json.item.state, 'undone'); assert.equal(tasks(), 0);
  const l = await undoList(a); assert.equal(l.items[0].state, 'undone'); assert.match(l.items[0].reason, /Already undone/); assert.equal(l.canUndo, 0);
  assert.equal(s.app.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'undo'").get().n, 1);
});

test('double click: a second apply with the same token, or a new preview of an undone change, is refused and changes nothing more', async () => {
  const { s, a } = await setup(); await doIt(a, 'note that the gate code is on the fridge'); const it = (await undoList(a)).items[0];
  const pv = (await a.post('/api/undo/' + it.id + '/preview')).json; const r = await Promise.all([a.post('/api/undo/' + it.id + '/apply', { token: pv.token, approve: true }), a.post('/api/undo/' + it.id + '/apply', { token: pv.token, approve: true })]);
  assert.deepEqual(r.map(x => x.status).sort(), [200, 404].sort()); assert.match(r.find(x => x.status === 404).json.error.message, /expired or was already used/);
  const again = await a.post('/api/undo/' + it.id + '/preview'); assert.equal(again.status, 409); assert.match(again.json.error.message, /already undone/);
  assert.equal(s.app.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'undo'").get().n, 1);
});

test('a preview expires after 10 minutes', async () => {
  const { a } = await setup(); await doIt(a, 'note that the gate code is on the fridge'); const it = (await undoList(a)).items[0];
  const pv = (await a.post('/api/undo/' + it.id + '/preview')).json; clock.t += 11 * 60e3;
  const r = await a.post('/api/undo/' + it.id + '/apply', { token: pv.token, approve: true }); assert.equal(r.status, 404);
});

test("nobody can preview or undo someone else's change, with or without their token", async () => {
  const { s, a, b } = await setup(); await doIt(a, 'add a task to call HR by friday'); const it = (await undoList(a)).items[0];
  assert.equal((await b.post('/api/undo/' + it.id + '/preview')).status, 404);
  const pv = (await a.post('/api/undo/' + it.id + '/preview')).json; assert.equal((await b.post('/api/undo/' + it.id + '/apply', { token: pv.token, approve: true })).status, 404);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM tasks WHERE user_id = 1 AND deleted_at IS NULL').get().n, 1);
  assert.equal((await a.post('/api/undo/99999/preview')).status, 404);
});

test('plain reasons where undoing is not possible: a deleted memory, a task that changed since, an unknown kind', async () => {
  const { s, a } = await setup(); const db = s.app.db;
  seedExec(db, 1, 'memory.add', { id: 4242 }, true); seedExec(db, 1, 'memory.delete', { id: 4243 }, false);
  let l = await undoList(a); const del = l.items.find(i => i.tool === 'memory.delete'); assert.equal(del.state, 'cannot'); assert.match(del.reason, /gone for good/); assert.equal((await a.post('/api/undo/' + del.id + '/preview')).status, 409);
  const add = l.items.find(i => i.tool === 'memory.add'); assert.equal(add.state, 'cannot'); assert.match(add.reason, /already gone/, 'the memory it created no longer exists');
  await doIt(a, 'add a task to book the dentist'); const taskId = db.prepare('SELECT id FROM tasks WHERE user_id = 1').get().id;
  await doIt(a, 'mark book the dentist as done'); assert.equal((await undoList(a)).items.find(i => i.tool === 'tasks.complete').state, 'can');
  db.prepare("UPDATE tasks SET status = 'open', completed_at = NULL WHERE id = ?").run(taskId);
  const c2 = (await undoList(a)).items.find(i => i.tool === 'tasks.complete'); assert.equal(c2.state, 'cannot'); assert.match(c2.reason, /not marked done any more/);
  db.prepare('UPDATE tool_executions SET undoable = 0 WHERE id = ?').run(c2.id); assert.match((await undoList(a)).items.find(i => i.id === c2.id).reason, /not marked done any more|cannot be undone/);
});

test('"what happens if" for undo: a linked ProofLoop commitment, a closed commitment that stays closed, and the budget', async () => {
  const { s, a } = await setup(); const db = s.app.db;
  await doIt(a, 'add a task to send the proposal by 2026-10-30'); const l1 = await undoList(a); const pv1 = (await a.post('/api/undo/' + l1.items[0].id + '/preview')).json;
  assert.ok(pv1.effects.some(e => /ProofLoop commitment .*Send the proposal.* will be cancelled too/i.test(e)), JSON.stringify(pv1.effects));
  const tid = db.prepare('SELECT id FROM tasks WHERE user_id = 1').get().id; await doIt(a, 'mark send the proposal as done');
  const comp = (await undoList(a)).items[0]; const pv2 = (await a.post('/api/undo/' + comp.id + '/preview')).json;
  assert.equal(comp.tool, 'tasks.complete');
  assert.ok(pv2.effects.every(e => !/will be cancelled/.test(e)));
  db.prepare("UPDATE commitments SET status = 'completed' WHERE user_id = 1").run(); const pv3 = (await a.post('/api/undo/' + comp.id + '/preview')).json;
  assert.ok(pv3.effects.some(e => /Undoing does not reopen it: it stays Completed/.test(e)), JSON.stringify(pv3.effects));
  db.prepare("INSERT INTO budgets (user_id, category, monthly_fils) VALUES (1, 'total', 100000)").run();
  await doIt(a, 'I spent 40 dirhams on lunch'); const ex = (await undoList(a)).items[0]; assert.equal(ex.tool, 'expenses.add');
  const pv4 = (await a.post('/api/undo/' + ex.id + '/preview')).json; assert.ok(pv4.effects.some(e => /goes from AED 40 to AED 0 of your AED 1,000 budget \(4% to 0%\)/.test(e)), JSON.stringify(pv4.effects));
});

test('every kind that can be undone really is undone, and the thing it created is gone', async () => {
  const { s, a } = await setup(); const db = s.app.db, n = (t, w) => db.prepare('SELECT COUNT(*) n FROM ' + t + ' WHERE user_id = 1' + (w || '')).get().n;
  await doIt(a, 'add a task to call HR'); await doIt(a, 'note that parking is on level 2'); const mid = Number(db.prepare("INSERT INTO memories (user_id, kind, text, source, status, sensitive, created_at, updated_at) VALUES (1, 'fact', 'my manager is Sara', 'user', 'active', 0, 1, 1)").run().lastInsertRowid); seedExec(db, 1, 'memory.add', { id: mid }, true);
  await doIt(a, 'remind me in 2 hours to call mum'); await doIt(a, 'I spent 12 dirhams on coffee');
  assert.equal(n('tasks', ' AND deleted_at IS NULL'), 1); assert.equal(n('notes', ' AND deleted_at IS NULL'), 1); assert.equal(n('memories'), 1); assert.equal(n('reminders', " AND status = 'pending'"), 1); assert.equal(n('expenses', ' AND deleted_at IS NULL'), 1);
  const l = await undoList(a); assert.equal(l.canUndo, l.items.length, JSON.stringify(l.items.map(i => [i.tool, i.state, i.reason])));
  for (const it of l.items) { const pv = (await a.post('/api/undo/' + it.id + '/preview')).json; const r = await a.post('/api/undo/' + it.id + '/apply', { token: pv.token, approve: true }); assert.equal(r.status, 200, it.tool); }
  assert.equal(n('tasks', ' AND deleted_at IS NULL'), 0); assert.equal(n('notes', ' AND deleted_at IS NULL'), 0); assert.equal(n('memories'), 0); assert.equal(n('reminders', " AND status = 'pending'"), 0); assert.equal(n('expenses', ' AND deleted_at IS NULL'), 0);
  assert.equal((await undoList(a)).canUndo, 0);
});

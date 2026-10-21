// Promise Orbit (server): one read-only list of open commitments and tasks, nearest first, with states, 12 at most, private to each user.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);
const at = iso => Date.parse(iso + '+04:00');
async function setup() { const k = { t: at('2026-10-21T09:00:00'), now: () => k.t }; const s = await boot({}, { now: k.now }); const c = s.client(); await c.login('roshan@example.com'); return { s, c, k }; }
const addC = (s, uid, title, status, deadline, extra) => s.app.db.prepare("INSERT INTO commitments (user_id, title, direction, counterparty, status, deadline, task_id, source_type, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', 0, 1, 1)").run(uid, title, (extra && extra.dir) || 'i_owe', (extra && extra.who) || null, status, deadline || null, (extra && extra.task) || null);
const addT = (s, uid, title, due, status) => Number(s.app.db.prepare("INSERT INTO tasks (user_id, title, due, status, created_at) VALUES (?, ?, ?, ?, 1)").run(uid, title, due || null, status || 'open').lastInsertRowid);

test('states, order and wording: overdue first (most late first), then nearest; verified and waiting are told apart; done, cancelled and deleted are left out', async () => {
  const { s, c } = await setup(); const uid = 1;
  addC(s, uid, 'Submit the scholarship form', 'task_prepared', '2026-10-18');                       // overdue 3 days
  addC(s, uid, 'Send the transcript', 'awaiting_confirmation', '2026-10-23');                       // waiting, in 2 days
  addC(s, uid, 'Lab quote from the supplier', 'awaiting_confirmation', '2026-10-22', { dir: 'owed_to_me', who: 'Omar' });
  addC(s, uid, 'Proposal to Alex', 'verified', '2026-10-24');                                       // verified (not overdue even if it were late)
  addC(s, uid, 'Old and finished', 'completed', '2026-10-01'); addC(s, uid, 'Dropped', 'cancelled', '2026-10-02'); addC(s, uid, 'Broke', 'failed', '2026-10-03');
  addT(s, uid, 'Pay the utilities bill', '2026-10-21');                                              // due today
  addT(s, uid, 'Book the study room', '2026-10-30'); addT(s, uid, 'Someday task', null); addT(s, uid, 'Already done', '2026-10-01', 'done');
  const dead = addT(s, uid, 'Deleted task', '2026-10-01'); s.app.db.prepare('UPDATE tasks SET deleted_at = 5 WHERE id = ?').run(dead);
  const r = (await c.get('/api/orbit')).json;
  assert.equal(r.today, '2026-10-21'); assert.equal(r.total, 7); assert.equal(r.more, 0); assert.equal(r.overdue, 1);
  assert.deepEqual(r.shown.map(i => i.title), ['Submit the scholarship form', 'Pay the utilities bill', 'Lab quote from the supplier', 'Send the transcript', 'Proposal to Alex', 'Book the study room', 'Someday task']);
  const by = Object.fromEntries(r.shown.map(i => [i.title, i]));
  assert.equal(by['Submit the scholarship form'].state, 'overdue'); assert.equal(by['Submit the scholarship form'].label, 'Submit the scholarship form, overdue 3 days');
  assert.equal(by['Pay the utilities bill'].state, 'normal'); assert.equal(by['Pay the utilities bill'].label, 'Pay the utilities bill, due today');
  assert.equal(by['Send the transcript'].state, 'waiting'); assert.equal(by['Send the transcript'].label, 'Send the transcript, waiting for proof, due in 2 days');
  assert.equal(by['Lab quote from the supplier'].who, 'owed to you by Omar');
  assert.equal(by['Proposal to Alex'].state, 'verified'); assert.equal(by['Someday task'].label, 'Someday task, no date'); assert.equal(by['Someday task'].days, null);
});

test('a task that already backs a commitment is shown once; 12 at most with the rest counted; nothing is changed by reading', async () => {
  const { s, c } = await setup(); const uid = 1;
  const t = addT(s, uid, 'Send the proposal', '2026-10-25'); addC(s, uid, 'Send the proposal', 'awaiting_confirmation', '2026-10-25', { task: t });
  for (let i = 0; i < 199; i++) addT(s, uid, 'Task ' + String(i).padStart(3, '0'), '2026-11-' + String(1 + (i % 28)).padStart(2, '0'));
  const before = JSON.stringify([s.app.db.prepare('SELECT * FROM tasks').all(), s.app.db.prepare('SELECT * FROM commitments').all()]);
  const r = (await c.get('/api/orbit')).json;
  assert.equal(r.total, 200); assert.equal(r.shown.length, 12); assert.equal(r.more, 188);
  assert.equal(r.shown.filter(i => i.title === 'Send the proposal').length, 1, 'once, as the commitment'); assert.equal(r.shown[0].kind, 'commitment');
  assert.equal(JSON.stringify([s.app.db.prepare('SELECT * FROM tasks').all(), s.app.db.prepare('SELECT * FROM commitments').all()]), before);
});

test('Dubai date decides: just after midnight in Dubai a task due "yesterday" is overdue (while it is still the 20th in UTC)', async () => {
  const { s, c, k } = await setup(); addT(s, 1, 'Due on the 20th', '2026-10-20');
  k.t = at('2026-10-20T23:30:00'); assert.equal((await c.get('/api/orbit')).json.shown[0].state, 'normal');
  k.t = at('2026-10-21T00:30:00'); assert.equal((await c.get('/api/orbit')).json.shown[0].state, 'overdue');
});

test('private: nobody sees another user\'s items, and signed-out requests are refused', async () => {
  const { s, c } = await setup(); addT(s, 1, 'Roshan only', '2026-10-22');
  const m = s.client(); assert.equal((await m.get('/api/orbit')).status, 401); await m.login('mallory@example.com');
  const r = (await m.get('/api/orbit')).json; assert.equal(r.total, 0); assert.deepEqual(r.shown, []);
});

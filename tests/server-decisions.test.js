// Decision journal (server): saving and answering go through preview, approval, verification and the Undo list; one notification on the review date;
// an honest record only from 5 reviewed decisions; another person's journal is never visible.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);

const at = iso => Date.parse(iso + '+04:00'), clock = { t: at('2026-10-21T08:00:00') };   // Wednesday 21 October 2026, Dubai
async function setup() { const s = await boot({ NOVA_RATE_API_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }, { now: () => clock.t }); const a = s.client(), b = s.client(); await a.login('roshan@example.com'); await b.login('mallory@example.com'); clock.t = at('2026-10-21T08:00:00'); return { s, a, b }; }
const FORM = { title: 'Move to the new office', why: 'Shorter commute', expected: 'Saves me an hour a day', reviewOn: '2026-10-28' };
const approve = async (c, run) => { const r = await c.post('/api/approvals/' + run.pendingApproval.id + '/approve'); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
const count = (db, where) => db.prepare('SELECT COUNT(*) n FROM decisions' + (where ? ' WHERE ' + where : '')).get().n;
async function add(c, over) { const r = await c.post('/api/decisions/start', Object.assign({}, FORM, over)); assert.equal(r.status, 200, JSON.stringify(r.json)); return approve(c, r.json.run); }
function row(db, uid, title, reviewOn, status, outcome) { db.prepare('INSERT INTO decisions (user_id, title, expected, review_on, status, outcome, reviewed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(uid, title, 'x', reviewOn, status, outcome || null, outcome ? 1 : null, 1); }

test('saving shows a preview first and writes nothing; Approve saves it, reads it back, and it is in the Undo list', async () => {
  const { s, a } = await setup(); const r = await a.post('/api/decisions/start', FORM); assert.equal(r.status, 200); const run = r.json.run;
  assert.equal(run.status, 'awaiting_approval'); const p = run.pendingApproval.preview; assert.equal(p.action, 'Record a decision'); assert.ok(p.changes.some(c => /Move to the new office/.test(c))); assert.ok(p.changes.includes('Expected: Saves me an hour a day')); assert.ok(p.changes.includes('Look back on 2026-10-28')); assert.equal(p.undoable, true);
  assert.equal(count(s.app.db), 0, 'nothing is written before you approve');
  const done = await approve(a, run); assert.equal(done.status, 'completed'); assert.match(JSON.stringify(done), /Read back from the database: decision #1 is saved/); assert.equal(count(s.app.db), 1);
  const list = (await a.get('/api/decisions')).json; assert.equal(list.decisions.length, 1); assert.deepEqual([list.decisions[0].title, list.decisions[0].status, list.decisions[0].due], ['Move to the new office', 'open', false]);
  const u = (await a.get('/api/undo')).json; assert.equal(u.items.length, 1); assert.match(u.items[0].action, /Record a decision/); assert.equal(u.items[0].state, 'can');
  const pv = await a.post('/api/undo/' + u.items[0].id + '/preview'); assert.equal(pv.status, 200);
  const rej = await a.post('/api/decisions/start', Object.assign({}, FORM, { title: 'Rejected one' })); await a.post('/api/approvals/' + rej.json.run.pendingApproval.id + '/reject'); assert.equal(count(s.app.db), 1, 'rejected means not saved');
});

test('plain refusals: missing words, a bad date, a past date', async () => {
  const { a } = await setup(); const err = async (over, rx) => { const r = await a.post('/api/decisions/start', Object.assign({}, FORM, over)); assert.equal(r.status, 400, JSON.stringify(over)); assert.match(r.json.error.message, rx); };
  await err({ title: '' }, /title/); await err({ expected: '   ' }, /expected/); await err({ reviewOn: 'next week' }, /^Choose the date to look back on/); await err({ reviewOn: '2026-02-30' }, /^Choose the date to look back on/); await err({ reviewOn: '2026-10-20' }, /^The review date must be today or a later date/);
  assert.equal((await a.post('/api/decisions/start', Object.assign({}, FORM, { reviewOn: '2026-10-21' }))).status, 200, 'today is allowed');
});

test('answering: three answers, preview then approval, reviewed once, undone from the Undo list', async () => {
  const { s, a, b } = await setup(); await add(a); const id = 1;
  assert.equal((await a.post('/api/decisions/' + id + '/review', { outcome: 'great' })).status, 400); assert.equal((await b.post('/api/decisions/' + id + '/review', { outcome: 'better' })).status, 404, 'not someone else\'s');
  const r = await a.post('/api/decisions/' + id + '/review', { outcome: 'better', note: 'Even shorter' }); assert.equal(r.status, 200); assert.equal(r.json.run.pendingApproval.preview.action, 'Record how a decision turned out'); assert.ok(r.json.run.pendingApproval.preview.changes.includes('Answer: Better than expected'));
  assert.equal(s.app.db.prepare('SELECT status FROM decisions').get().status, 'open'); const done = await approve(a, r.json.run); assert.equal(done.status, 'completed');
  const d = (await a.get('/api/decisions')).json.decisions[0]; assert.deepEqual([d.status, d.outcome, d.outcomeLabel, d.outcomeNote], ['reviewed', 'better', 'Better than expected', 'Even shorter']);
  const again = await a.post('/api/decisions/' + id + '/review', { outcome: 'worse' }); assert.equal(again.status, 409); assert.match(again.json.error.message, /^That decision has already been reviewed/);
  const u = (await a.get('/api/undo')).json.items[0]; assert.match(u.action, /Record how a decision turned out/); const pv = await a.post('/api/undo/' + u.id + '/preview'); assert.equal(pv.status, 200);
  const ap = await a.post('/api/undo/' + u.id + '/apply', { approve: true, token: pv.json.token }); assert.equal(ap.status, 200, JSON.stringify(ap.json)); assert.equal(s.app.db.prepare('SELECT status, outcome FROM decisions').get().status, 'open');
});

test('the record: "not enough data yet" below 5 reviewed decisions, then exact counts and the sentence', async () => {
  const { s, a } = await setup(); for (const [i, o] of ['as_expected', 'better', 'worse'].entries()) row(s.app.db, 1, 'D' + i, '2026-10-10', 'reviewed', o); row(s.app.db, 1, 'Open one', '2026-10-30', 'open');
  let rec = (await a.get('/api/decisions')).json.record; assert.deepEqual([rec.reviewed, rec.ready, rec.asExpected, rec.better, rec.worse], [3, false, 1, 1, 1]); assert.equal(rec.line, 'Not enough data yet: 3 of 5 reviewed decisions needed for a record.');
  row(s.app.db, 1, 'D3', '2026-10-10', 'reviewed', 'as_expected'); row(s.app.db, 1, 'D4', '2026-10-10', 'reviewed', 'as_expected');
  rec = (await a.get('/api/decisions')).json.record; assert.deepEqual([rec.reviewed, rec.ready, rec.asExpected], [5, true, 3]); assert.equal(rec.line, '4 of 5 turned out as expected or better.'); assert.match(rec.rule, /As expected or better/);
  s.app.db.prepare("UPDATE decisions SET deleted_at = 1 WHERE title = 'D4'").run(); assert.equal((await a.get('/api/decisions')).json.record.ready, false, 'a removed decision is not counted');
});

test('one bell notification on the review date (from 09:00 Dubai time), never twice, never for answered or removed decisions', async () => {
  const { s, a } = await setup(); row(s.app.db, 1, 'Due today', '2026-10-21', 'open'); row(s.app.db, 1, 'Due tomorrow', '2026-10-22', 'open'); row(s.app.db, 1, 'Answered', '2026-10-21', 'reviewed', 'better'); s.app.db.prepare("INSERT INTO decisions (user_id, title, expected, review_on, status, created_at, deleted_at) VALUES (1, 'Removed', 'x', '2026-10-21', 'open', 1, 1)").run();
  const notes = () => s.app.db.prepare("SELECT * FROM notifications WHERE kind = 'decision'").all();
  await s.app.scheduler.tick(); assert.equal(notes().length, 0, 'at 08:00 it is too early');
  clock.t = at('2026-10-21T09:05:00'); await s.app.scheduler.tick(); await s.app.scheduler.tick(); const n = notes(); assert.equal(n.length, 1); assert.equal(n[0].title, 'How did it turn out?'); assert.equal(n[0].link, '#journal'); assert.match(n[0].body, /You decided: Due today\./);
  clock.t = at('2026-10-21T15:00:00'); await s.app.scheduler.tick(); assert.equal(notes().length, 1, 'the same decision is never notified twice');
  clock.t = at('2026-10-22T09:30:00'); await s.app.scheduler.tick(); assert.equal(notes().length, 2); assert.match(notes()[1].body, /Due tomorrow/);
  await a.login('roshan@example.com');       // sessions expire as the fake clock moves days ahead
  assert.equal((await a.get('/api/decisions')).json.decisions.filter(d => d.due).length, 2, 'both open ones are due to be answered now');
});

test('nobody else sees your journal; sign-in and the CSRF header are required', async () => {
  const { s, a, b } = await setup(); await add(a); assert.equal((await b.get('/api/decisions')).json.decisions.length, 0); assert.doesNotMatch(JSON.stringify((await b.get('/api/decisions')).json), /new office/);
  assert.equal((await s.client().get('/api/decisions')).status, 401); assert.equal((await s.client().post('/api/decisions/start', FORM)).status, 401); assert.equal((await a.raw('POST', '/api/decisions/start', FORM, { 'x-nova-csrf': 'bad' })).status, 403);
});

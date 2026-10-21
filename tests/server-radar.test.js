// Life Radar (server): five measures for this week and last week, scaled by written rules; no data means null, never a made-up number.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);
const at = iso => Date.parse(iso + '+04:00');
async function setup() { const k = { t: at('2026-10-21T15:00:00'), now: () => k.t }; const s = await boot({}, { now: k.now }); const c = s.client(); await c.login('roshan@example.com'); return { s, c, k }; }   // Wednesday
const run = (db, sql, ...a) => db.prepare(sql).run(...a);
const { seed: seedDb } = require('./radar-fixture');
const seed = s => seedDb(s.app.db, 1);

test('five measures for this week and last week, each from real rows and a written rule', async () => {
  const { s, c } = await setup(); seed(s);
  const r = (await c.get('/api/radar')).json;
  assert.equal(r.today, '2026-10-21'); assert.deepEqual(r.weeks.this, { start: '2026-10-19', end: '2026-10-25', through: '2026-10-21' }); assert.deepEqual(r.weeks.last, { start: '2026-10-12', end: '2026-10-18', through: '2026-10-18' });
  assert.deepEqual(r.spokes.map(x => x.id), ['kept', 'focus', 'habits', 'money', 'overdue']);
  assert.ok(r.spokes.every(x => x.name && x.rule.length > 20), 'every measure says how it is scored');
  const by = Object.fromEntries(r.spokes.map(x => [x.id, x]));
  assert.deepEqual(by.kept.this, { score: 33, detail: 'kept 1 of 3' }); assert.deepEqual(by.kept.last, { score: 100, detail: 'kept 2 of 2' });
  assert.deepEqual(by.focus.this, { score: 30, detail: '1 h 30 min of focus' }); assert.deepEqual(by.focus.last, { score: 50, detail: '2 h 30 min of focus' });
  assert.deepEqual(by.habits.this, { score: 83, detail: '5 of 6 check-ins' }); assert.deepEqual(by.habits.last, { score: 83, detail: '10 of 12 check-ins' });
  assert.deepEqual(by.money.this, { score: 100, detail: 'AED 200 spent of AED 290' }); assert.deepEqual(by.money.last, { score: 52, detail: 'AED 1,000 spent of AED 677' });
  assert.deepEqual(by.overdue.this, { score: 80, detail: '2 overdue' }); assert.deepEqual(by.overdue.last, { score: 90, detail: '1 overdue' });
});

test('no data means null, not a number: a new account, no budget, no expenses that week, no focus ever', async () => {
  const { s, c } = await setup();
  let r = (await c.get('/api/radar')).json, by = Object.fromEntries(r.spokes.map(x => [x.id, x]));
  for (const id of ['kept', 'focus', 'habits', 'money']) { assert.equal(by[id].this, null, id); assert.equal(by[id].last, null, id); }
  assert.deepEqual(by.overdue.this, { score: 100, detail: 'nothing overdue' });
  run(s.app.db, "INSERT INTO budgets (user_id, category, monthly_fils) VALUES (1, 'total', 300000)"); run(s.app.db, "INSERT INTO expenses (user_id, amount_fils, category, day, created_at) VALUES (1, 5000, 'food', '2026-10-20', 1)");
  r = (await c.get('/api/radar')).json; by = Object.fromEntries(r.spokes.map(x => [x.id, x]));
  assert.ok(by.money.this && by.money.this.score === 100); assert.equal(by.money.last, null, 'a week with a budget but no expense is "not enough data", not 100');
  run(s.app.db, "INSERT INTO focus_sessions (user_id, title, planned_min, started_at, ended_at, status) VALUES (1, 'f', 25, ?, ?, 'completed')", at('2026-10-05T09:00:00'), at('2026-10-05T09:25:00'));
  r = (await c.get('/api/radar')).json; by = Object.fromEntries(r.spokes.map(x => [x.id, x]));
  assert.deepEqual(by.focus.this, { score: 0, detail: '0 min of focus' }, 'once you use focus, a week without it is a real 0'); 
});

test('Monday 00:30 Dubai starts a new week; private; signed-out refused; reading changes nothing', async () => {
  const { s, c, k } = await setup(); seed(s);
  k.t = at('2026-10-26T00:30:00'); await c.login('roshan@example.com');                      // five days later: the old session has expired
  let r = (await c.get('/api/radar')).json;
  assert.equal(r.weeks.this.start, '2026-10-26'); assert.equal(r.weeks.last.start, '2026-10-19'); assert.equal(r.weeks.last.through, '2026-10-25');
  k.t = at('2026-10-21T15:00:00'); await c.login('roshan@example.com');
  const m = s.client(); assert.equal((await m.get('/api/radar')).status, 401); await m.login('mallory@example.com');
  assert.equal((await m.get('/api/radar')).json.spokes.find(x => x.id === 'kept').this, null);
  const count = () => ['commitments', 'tasks', 'habit_checks', 'expenses', 'focus_sessions', 'audit_log'].map(t => s.app.db.prepare('SELECT COUNT(*) n FROM ' + t).get().n).join(',');
  const before = count(); await c.get('/api/radar'); assert.equal(count(), before);
});

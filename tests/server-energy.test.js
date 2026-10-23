// Energy marks (server): one tap per part of the day in my own account, my own pattern only after 7 days ("not enough data yet" before),
// the planner switch that needs that pattern, hard tasks moved into my high-energy hours (urgency still first), and nobody else's data.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);

const at = iso => Date.parse(iso + '+04:00'), clock = { t: at('2026-10-21T08:00:00') };   // Wednesday 21 October 2026, Dubai
async function setup() { const s = await boot({ NOVA_RATE_API_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }, { now: () => clock.t }); const a = s.client(), b = s.client(); await a.login('roshan@example.com'); await b.login('mallory@example.com'); clock.t = at('2026-10-21T08:00:00'); return { s, a, b }; }
const addIso = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mark = (db, uid, day, slot, level) => db.prepare('INSERT OR REPLACE INTO energy_marks (user_id, day, slot, level, updated_at) VALUES (?, ?, ?, ?, 1)').run(uid, day, slot, level);
// eight earlier days: morning high on `m` of them, afternoon high on `a` of them (the rest medium), evening always low on the first five
function history(db, uid, m, a, days = 8) { for (let i = 1; i <= days; i++) { const day = addIso('2026-10-21', -i); mark(db, uid, day, 'morning', i <= m ? 'high' : 'low'); mark(db, uid, day, 'afternoon', i <= a ? 'high' : 'medium'); if (i <= 5) mark(db, uid, day, 'evening', 'low'); } }
const get = c => c.get('/api/energy').then(r => r.json), post = (c, slot, level) => c.post('/api/energy', { slot, level });

test('one tap per part of today, changed or cleared, validated in plain words, and written to my account only', async () => {
  const { s, a, b } = await setup();
  let r = (await post(a, 'morning', 'high')).json; assert.deepEqual(r.slots.map(x => x.level), ['high', null, null]); assert.equal(r.today, '2026-10-21'); assert.deepEqual(r.slots.map(x => x.window), ['09:00 to 12:00', '12:00 to 17:00', '17:00 to 18:00']);
  r = (await post(a, 'morning', 'low')).json; assert.equal(r.slots[0].level, 'low', 'tapping again changes it'); await post(a, 'evening', 'medium');
  assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM energy_marks WHERE user_id = 1').get().n, 2);
  r = (await post(a, 'morning', null)).json; assert.equal(r.slots[0].level, null, 'cleared'); assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM energy_marks WHERE user_id = 1').get().n, 1);
  let bad = await post(a, 'midnight', 'high'); assert.equal(bad.status, 400); assert.equal(bad.json.error.message, 'slot must be one of: morning, afternoon, evening.');
  bad = await post(a, 'morning', 'great'); assert.equal(bad.status, 400); assert.equal(bad.json.error.message, 'level must be one of: high, medium, low.');
  assert.deepEqual((await get(b)).slots.map(x => x.level), [null, null, null]); assert.equal((await s.client().get('/api/energy')).status, 401);
  assert.equal((await a.raw('POST', '/api/energy', { slot: 'morning', level: 'high' }, { 'x-nova-csrf': 'bad' })).status, 403);
  assert.ok(s.app.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'energy_marked'").get().n >= 4, 'each tap is recorded in the activity log');
});

test('before 7 days: "not enough data yet", no pattern, and the planner switch cannot be turned on', async () => {
  const { s, a } = await setup(); history(s.app.db, 1, 6, 0, 3); const r = await get(a);
  assert.equal(r.days, 3); assert.equal(r.ready, false); assert.deepEqual(r.highSlots, []); assert.match(r.summary, /^Not enough data yet: 3 of 7 days marked\./); assert.equal(r.plan.available, false);
  const on = await a.post('/api/energy/plan', { on: true }); assert.equal(on.status, 409); assert.match(on.json.error.message, /^Not enough data yet: mark your energy on 7 different days first\. Nothing changed\./);
  assert.equal(s.app.db.prepare('SELECT energy_plan FROM users WHERE id = 1').get().energy_plan, 0);
  assert.equal((await a.post('/api/energy/plan', { on: 'yes' })).status, 400);
});

test('from 7 days: my own pattern in plain words, with exact counts and the rule', async () => {
  const { s, a } = await setup(); history(s.app.db, 1, 6, 3); const r = await get(a);
  assert.equal(r.ready, true); assert.equal(r.days, 8); assert.deepEqual(r.highSlots, ['morning']); assert.equal(r.summary, 'You usually mark high energy in the morning (6 of 8 days).');
  assert.deepEqual(r.pattern.map(p => [p.slot, p.high, p.total, p.usuallyHigh]), [['morning', 6, 8, true], ['afternoon', 3, 8, false], ['evening', 0, 5, false]]); assert.match(r.rule, /at least 7 different days/);
  history(s.app.db, 1, 4, 4); assert.equal((await get(a)).summary, 'You usually mark high energy in the morning (4 of 8 days) and in the afternoon (4 of 8 days).', 'exactly half counts');
  history(s.app.db, 1, 2, 2); assert.equal((await get(a)).summary, 'No part of the day is usually high for you yet.'); const none = await a.post('/api/energy/plan', { on: true }); assert.equal(none.status, 409); assert.match(none.json.error.message, /^No usual high-energy time was found yet/);
  const few = (await setup()); history(few.s.app.db, 1, 4, 0, 7); mark(few.s.app.db, 1, '2026-10-14', 'morning', 'high');   // only 4 marked days in a part of the day is not enough: it needs 4 marks and half high
});

test('the planner switch: off by default and ignored; on, hard tasks go in my high-energy hours; urgent items still come first', async () => {
  const { s, a } = await setup(); history(s.app.db, 1, 0, 6);          // the afternoon is my high-energy time
  const today = '2026-10-21', ins = (title, due, est) => s.app.db.prepare("INSERT INTO tasks (user_id, title, due, status, estimate_min, created_at) VALUES (1, ?, ?, 'open', ?, ?)").run(title, due, est, clock.t);
  ins('Write the report', today, 120); for (let i = 1; i <= 6; i++) ins('Quick job ' + i, today, 45); ins('Overdue thing', '2026-10-19', 90);
  const plan = async () => (await a.get('/api/plan')).json.proposal, firstWork = p => p.blocks.filter(b => b.minutes)[0], find = (p, t) => p.blocks.find(b => b.title === t);
  let p = await plan(); assert.equal(p.energy, null); assert.equal(firstWork(p).title, 'Overdue thing'); assert.equal(find(p, 'Write the report').start < '12:00', true, 'ignoring my energy: the hard task comes early, in order');
  const on = await a.post('/api/energy/plan', { on: true }); assert.equal(on.status, 200); assert.equal(on.json.plan.on, true); assert.match(on.json.plan.note, /Urgent items still come first/);
  p = await plan(); assert.equal(p.energy.used, true); assert.deepEqual(p.energy.windows, ['12:00 to 17:00']); assert.equal(firstWork(p).title, 'Overdue thing', 'the overdue item is still first');
  const hard = find(p, 'Write the report'); assert.ok(hard.start >= '12:00' && hard.start < '17:00', 'the hard task starts in my high-energy hours: ' + hard.start); assert.match(hard.why, /Placed in your high-energy time/);
  assert.ok(p.blocks.filter(b => b.minutes && b.title.startsWith('Quick job')).every(b => b.start < hard.start || b.start >= hard.end), 'no overlaps'); assert.ok(!/Placed in your high-energy time/.test(find(p, 'Quick job 1').why), 'only hard tasks are marked');
  assert.equal((await a.post('/api/energy/plan', { on: false })).json.plan.on, false); p = await plan(); assert.equal(p.energy, null);
});

test('with the switch on but data removed, the planner quietly does nothing different; and nothing about it is shared between people', async () => {
  const { s, a, b } = await setup(); history(s.app.db, 1, 6, 0); await a.post('/api/energy/plan', { on: true });
  s.app.db.prepare('DELETE FROM energy_marks WHERE user_id = 1 AND day < ?').run('2026-10-18'); const r = await get(a); assert.equal(r.plan.wanted, true); assert.equal(r.plan.on, false); assert.equal((await a.get('/api/plan')).json.proposal.energy, null);
  assert.equal((await get(b)).days, 0); assert.equal((await b.get('/api/plan')).json.proposal.energy, null);
});

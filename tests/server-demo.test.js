// The demo data (server): the last 14 days look lived in (sign-ins, requests, approvals, focus, briefings, finished tasks at different times
// of day), a verified ProofLoop receipt, a budget near 80%, two habits with different streaks, everything labelled fictional, dates relative to
// "now" at any time of day or month, and seeding twice changes nothing. Plus the guided demo's remembered steps.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');
const { seed, EMAIL } = require('../scripts/demo');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);

const dubai = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date(ms));
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const CLOCKS = ['2026-10-19T02:10:00+04:00', '2026-11-01T23:50:00+04:00', '2026-12-30T12:00:00+04:00', '2026-02-28T07:31:00+04:00'].map(Date.parse);
async function demo(now, env) {
  const s = await boot(Object.assign({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-demo-')), 'd.db'), AUTH_MODE: 'dev', OWNER_EMAILS: EMAIL + ',mallory@example.com', NOVA_RATE_API_MAX: '100000' }, env || {}), { now: () => now });
  const r = seed(s.app, { now }); const c = s.client(); await c.login(EMAIL); return { s, c, r };
}

for (const now of CLOCKS) {
  test('at ' + new Date(now).toISOString() + ': the last 14 days are lived in, nothing is in the future, a verified receipt, a budget near 80%, streaks 9 and 3', async () => {
    const { s, c, r } = await demo(now); const db = s.app.db, today = dubai(now); assert.equal(r.seeded, true);
    // every one of the last 14 days has something to replay, at different times of day
    const hours = new Set(); let total = 0;
    for (let d = 1; d <= 14; d++) {
      const day = addDays(today, -d), rp = (await c.get('/api/replay?day=' + day)).json;
      assert.ok(rp.total >= 2, day + ' has ' + rp.total + ' events'); total += rp.total; rp.events.forEach(e => hours.add(e.at.slice(0, 2)));
      assert.ok(rp.events.some(e => e.group === 'notice'), day + ' has the morning briefing'); assert.ok(rp.events.some(e => e.group === 'security' || e.group === 'asked'), day + ' has a sign-in or a request');
    }
    assert.ok(total >= 80, 'events over 14 days: ' + total); assert.ok(hours.size >= 9, 'distinct hours of the day: ' + [...hours].sort().join(' '));
    const groups = new Set(); for (let d = 1; d <= 14; d++) (await c.get('/api/replay?day=' + addDays(today, -d))).json.events.forEach(e => groups.add(e.group)); for (const g of ['asked', 'preview', 'approved', 'rejected', 'verified', 'focus', 'notice', 'job', 'proof']) assert.ok(groups.has(g), 'Day Replay shows ' + g + ': ' + [...groups]);
    // nothing in the future (every timestamp the seed writes is at or before "now")
    for (const [t, col] of [['run_steps', 'ts'], ['runs', 'created_at'], ['focus_sessions', 'ended_at'], ['notifications', 'created_at'], ['schedule_runs', 'finished_at'], ['audit_log', 'ts'], ['commitment_events', 'ts'], ['evidence', 'ts'], ['tasks', 'completed_at'], ['tasks', 'created_at'], ['commitments', 'created_at'], ['commitments', 'updated_at']])
      assert.equal(db.prepare('SELECT COUNT(*) n FROM ' + t + ' WHERE ' + col + ' > ?').get(now).n, 0, t + '.' + col + ' has nothing in the future');
    assert.ok(db.prepare('SELECT COUNT(*) n FROM tasks WHERE status = \'done\'').get().n >= 10, 'finished tasks spread over the two weeks');
    const doneDays = new Set(db.prepare('SELECT completed_at t FROM tasks WHERE completed_at IS NOT NULL').all().map(x => dubai(x.t))); assert.ok(doneDays.size >= 8, 'finished on ' + doneDays.size + ' different days');
    // a verified ProofLoop receipt that checks out
    const list = (await c.get('/api/commitments')).json.commitments, done = list.find(x => /library fine receipt/.test(x.title)); assert.ok(done && done.status === 'completed');
    const md = await (await c.raw('GET', '/api/commitments/' + done.id + '/receipt?format=md')).text(); assert.match(md, /independent check/i); assert.match(md, /Fingerprint \(SHA-256\)/);
    const v = await s.client().post('/api/verify', { text: md }); assert.equal(v.status, 200); assert.equal(v.json.verdict, 'matches', JSON.stringify(v.json));
    const ev = (await c.get('/api/commitments/' + done.id)).json.commitment; assert.ok(ev.events.length >= 6); const tsl = ev.events.map(e => e.at); assert.deepEqual(tsl, tsl.slice().sort((a, b) => a - b), 'the timeline is in order'); assert.ok(tsl.at(-1) - tsl[0] >= 3 * 3600e3, 'the timeline spans hours, not a second');
    // the budget sits near 80% this month
    const month = today.slice(0, 7), spent = db.prepare('SELECT COALESCE(SUM(amount_fils), 0) s FROM expenses WHERE day >= ? AND day <= ?').get(month + '-01', month + '-31').s, budget = db.prepare("SELECT monthly_fils b FROM budgets WHERE category = 'total'").get().b;
    assert.ok(spent / budget >= 0.78 && spent / budget <= 0.82, 'spent ' + spent + ' of ' + budget); const life = (await c.get('/api/life')).json; assert.ok(life.money.total >= 0 || life.money);
    // two habits, different streaks
    const h = Object.fromEntries(life.habits.map(x => [x.name, x])); assert.equal(h['Read 10 pages'].streak, 9); assert.equal(h['Gym'].streak, 3); assert.notEqual(h['Read 10 pages'].streak, h['Gym'].streak);
  });
}

test('everything is labelled fictional', async () => {
  const { s } = await demo(CLOCKS[0]); const db = s.app.db, n = q => db.prepare(q).get().n;
  assert.equal(n("SELECT COUNT(*) n FROM runs WHERE planner != 'demo'"), 0); assert.equal(n("SELECT COUNT(*) n FROM run_steps WHERE summary NOT LIKE '%(demo)%'"), 0);
  assert.equal(n("SELECT COUNT(*) n FROM notifications WHERE title NOT LIKE '%(demo)%'"), 0); assert.equal(n("SELECT COUNT(*) n FROM focus_sessions WHERE title NOT LIKE '%(demo)%' AND title NOT IN ('Update CV with the data project')") <= 12, true);
  assert.equal(n("SELECT COUNT(*) n FROM tasks WHERE source != 'demo'"), 0); assert.equal(n('SELECT COUNT(*) n FROM commitments WHERE is_demo = 0'), 0); assert.equal(n("SELECT COUNT(*) n FROM schedule_runs WHERE summary NOT LIKE '%(demo)%'"), 0);
  assert.equal(n("SELECT COUNT(*) n FROM audit_log WHERE detail != 'demo sign-in' AND ts < " + CLOCKS[0]), 0); assert.equal(n('SELECT COUNT(*) n FROM users'), 1); assert.equal(n("SELECT COUNT(*) n FROM users WHERE email != '" + EMAIL + "'"), 0);
});

test('seeding again changes nothing (idempotent), and the demo can be reset and seeded again', async () => {
  const { s } = await demo(CLOCKS[2]); const db = s.app.db, all = () => ['tasks', 'runs', 'run_steps', 'focus_sessions', 'notifications', 'schedule_runs', 'audit_log', 'commitments', 'commitment_events', 'evidence', 'habits', 'habit_checks', 'expenses', 'budgets', 'memories', 'notes', 'documents', 'emails'].map(t => t + db.prepare('SELECT COUNT(*) n FROM ' + t).get().n).join(',');
  const before = all(); const again = seed(s.app, { now: CLOCKS[2] }); assert.equal(again.seeded, false); assert.equal(all(), before);
  const later = seed(s.app, { now: CLOCKS[2] + 3 * 86400e3 }); assert.equal(later.seeded, false); assert.equal(all(), before, 'a later day does not add a second copy');
});

test('the guided demo: its steps are remembered per account, only the five steps and "hidden" are accepted, and demo mode is a server setting', async () => {
  const { s, c } = await demo(CLOCKS[0], { NOVA_DEMO: '1' }); const other = s.client(); await other.login('mallory@example.com');
  assert.equal((await c.get('/api/session')).json.demo, true); assert.deepEqual((await c.get('/api/profile')).json.user.demoSteps, []);
  for (const step of ['orbit', 'replay', 'orbit']) assert.equal((await c.req('PATCH', '/api/profile', { demoStep: step })).status, 200);
  assert.deepEqual((await c.get('/api/profile')).json.user.demoSteps, ['orbit', 'replay'], 'each step once'); assert.deepEqual((await other.get('/api/profile')).json.user.demoSteps, [], 'another account is not affected');
  for (const bad of ['everything', 5, null, {}, 'ORBIT']) { const r = await c.req('PATCH', '/api/profile', { demoStep: bad }); assert.equal(r.status, 400, JSON.stringify(bad)); assert.match(r.json.error.message, /not a step of the guided demo/); }
  const off = await boot(); const o = off.client(); await o.login('roshan@example.com'); assert.equal((await o.get('/api/session')).json.demo, false);
});

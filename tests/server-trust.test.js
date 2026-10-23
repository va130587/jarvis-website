// "Can people rely on me?" (server): reliability worked out from ProofLoop only, with exact numbers on a known fixture, "not enough data yet"
// below 3 counted promises, Dubai-date boundaries, nothing written, other people's data never used, and the "before you promise" week check.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);

const at = iso => Date.parse(iso + '+04:00'), NOW = at('2026-10-21T09:00:00');   // a Wednesday in Dubai
async function setup() { const s = await boot({ NOVA_RATE_API_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }, { now: () => NOW }); const a = s.client(), b = s.client(); await a.login('roshan@example.com'); await b.login('mallory@example.com'); return { s, a, b }; }
let seq = 0;
// one commitment with its history: kept = when it first reached Verified/Completed (ISO with Dubai time), or null
function add(db, uid, o) {
  const id = Number(db.prepare('INSERT INTO commitments (user_id, title, direction, counterparty, deadline, source_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uid, o.title || 'Promise ' + (++seq), o.dir || 'i_owe', o.who === undefined ? null : o.who, o.deadline || null, 'manual', o.status, NOW - 864e5 * 20, NOW).lastInsertRowid);
  db.prepare("INSERT INTO commitment_events (commitment_id, user_id, seq, from_status, to_status, note, actor, ts) VALUES (?, ?, 1, NULL, 'request_detected', 'x', 'you', ?)").run(id, uid, NOW - 864e5 * 20);
  if (o.kept) db.prepare("INSERT INTO commitment_events (commitment_id, user_id, seq, from_status, to_status, note, actor, ts) VALUES (?, ?, 2, 'submitted', ?, 'x', 'you', ?)").run(id, uid, o.status === 'completed' ? 'completed' : 'verified', at(o.kept));
  return id;
}
function fixture(db) {
  add(db, 1, { who: 'Sara', deadline: '2026-10-10', status: 'verified', kept: '2026-10-09T10:00:00' });           // on time
  add(db, 1, { who: 'Sara', deadline: '2026-10-12', status: 'completed', kept: '2026-10-14T10:00:00' });          // late
  add(db, 1, { who: 'Sara', deadline: '2026-10-15', status: 'failed' });                                         // not kept
  add(db, 1, { who: 'Sara', deadline: '2026-10-18', status: 'task_prepared' });                                  // past its deadline, still open
  add(db, 1, { who: 'sara ', deadline: '2026-10-30', status: 'executing' });                                     // open, not due (same person, other spelling)
  add(db, 1, { who: 'Sara', status: 'verified', kept: '2026-10-05T10:00:00' });                                  // done, no deadline
  add(db, 1, { who: 'Sara', deadline: '2026-10-01', status: 'cancelled' });                                      // cancelled
  add(db, 1, { who: 'Omar', deadline: '2026-10-11', status: 'verified', kept: '2026-10-11T23:59:00' });          // on time, last minute of the day
  add(db, 1, { who: null, deadline: '2026-10-08', status: 'verified', kept: '2026-10-07T08:00:00' });            // on time, no name
  add(db, 1, { who: 'Lina', dir: 'owed_to_me', deadline: '2026-10-20', status: 'verified', kept: '2026-10-19T10:00:00' });
  add(db, 1, { who: 'Lina', dir: 'owed_to_me', deadline: '2026-10-20', status: 'completed', kept: '2026-10-20T12:00:00' });
  add(db, 1, { who: 'Lina', dir: 'owed_to_me', deadline: '2026-10-14', status: 'completed', kept: '2026-10-15T00:00:00' });   // late by one minute past Dubai midnight
}
const trust = c => c.get('/api/proofloop/trust').then(r => r.json);

test('exact numbers on a known fixture, with the rule, per person and in total', async () => {
  const { s, a } = await setup(); fixture(s.app.db);
  const r = (await a.get('/api/proofloop/trust')); assert.equal(r.status, 200); const t = r.json;
  assert.equal(t.promises, 12); assert.equal(t.asOf, '2026-10-21'); assert.match(t.rule, /on or before its deadline/);
  const sara = t.iOwe.people.find(p => p.name === 'Sara');
  assert.deepEqual([sara.onTime, sara.late, sara.notKept, sara.overdue, sara.open, sara.doneNoDeadline, sara.cancelled, sara.counted, sara.percent], [1, 1, 1, 1, 1, 1, 1, 4, 25], 'same person with a different spelling is one person');
  assert.equal(sara.line, 'You kept 1 of 4 promises to Sara on time.');
  const tot = t.iOwe.total; assert.deepEqual([tot.onTime, tot.late, tot.notKept, tot.overdue, tot.counted, tot.percent], [3, 1, 1, 1, 6, 50]); assert.equal(tot.line, 'You kept 3 of 6 promises on time.');
  const lina = t.owedToMe.people[0]; assert.equal(lina.name, 'Lina'); assert.deepEqual([lina.onTime, lina.late, lina.counted, lina.percent], [2, 1, 3, 67]); assert.equal(lina.line, 'Lina kept 2 of 3 promises to you on time.');
  assert.equal(t.iOwe.people.length, 2, 'the unnamed promise counts in the total but is not a person');
});

test('fewer than 3 counted promises: "not enough data yet", never a made-up percentage; an empty account says nothing is counted', async () => {
  const { s, a } = await setup(); fixture(s.app.db);
  const omar = (await trust(a)).iOwe.people.find(p => p.name === 'Omar'); assert.equal(omar.percent, null); assert.equal(omar.counted, 1); assert.match(omar.line, /^Not enough data yet: at least 3 promises/); assert.match(omar.line, /so far 1/);
  const b = (await setup()).b; const e = await trust(b); assert.equal(e.promises, 0); assert.equal(e.iOwe.total.percent, null); assert.match(e.iOwe.total.line, /^Not enough data yet/); assert.deepEqual(e.iOwe.people, []);
});

test('the deadline is a Dubai date: kept in the last minute of the day is on time, one minute past midnight is late', async () => {
  const { s, a } = await setup(); fixture(s.app.db); const t = await trust(a);
  assert.equal(t.iOwe.people.find(p => p.name === 'Omar').onTime, 1, '23:59 Dubai on the deadline day');
  assert.equal(t.owedToMe.people[0].late, 1, '00:00 Dubai the day after');
});

test('reading changes nothing, and another person\'s promises are never counted or shown', async () => {
  const { s, a, b } = await setup(); fixture(s.app.db); add(s.app.db, 2, { who: 'Zed', deadline: '2026-10-10', status: 'verified', kept: '2026-10-09T10:00:00' });
  const rows = () => JSON.stringify([s.app.db.prepare('SELECT * FROM commitments ORDER BY id').all(), s.app.db.prepare('SELECT COUNT(*) n FROM commitment_events').get()]), before = rows();
  const mine = await trust(a), theirs = await trust(b); await a.get('/api/proofloop/heads-up?deadline=2026-10-28');
  assert.equal(rows(), before); assert.doesNotMatch(JSON.stringify(mine), /Zed/); assert.doesNotMatch(JSON.stringify(theirs), /Sara|Lina|Omar/); assert.equal(theirs.promises, 1);
  assert.equal((await s.client().get('/api/proofloop/trust')).status, 401); assert.equal((await s.client().get('/api/proofloop/heads-up?deadline=2026-10-28')).status, 401);
});

test('"Before you promise": the Monday to Sunday week of a date, and a heads-up only from 3 open promises', async () => {
  const { s, a, b } = await setup(); fixture(s.app.db);
  let h = (await a.get('/api/proofloop/heads-up?deadline=2026-10-28')).json;   // week 26 Oct to 1 Nov holds one open promise (30 Oct)
  assert.deepEqual(h.week, { from: '2026-10-26', to: '2026-11-01' }); assert.equal(h.open, 1); assert.equal(h.message, null);
  add(s.app.db, 1, { who: 'Noor', title: 'Send the invoice', deadline: '2026-10-27', status: 'task_prepared' }); add(s.app.db, 1, { who: 'Ali', title: 'Book the venue', deadline: '2026-11-01', status: 'request_understood' });
  add(s.app.db, 1, { who: 'Ali', title: 'Already done', deadline: '2026-10-28', status: 'verified', kept: '2026-10-20T10:00:00' }); add(s.app.db, 1, { dir: 'owed_to_me', who: 'Ali', deadline: '2026-10-29', status: 'task_prepared' });
  h = (await a.get('/api/proofloop/heads-up?deadline=2026-11-01')).json; assert.equal(h.open, 3, 'Sunday belongs to the week that started on Monday; done and owed-to-me items are not counted');
  assert.match(h.message, /^You already have 3 open promises due the week of 2026-10-26: /); assert.match(h.message, /Send the invoice/);
  assert.equal((await a.get('/api/proofloop/heads-up?deadline=2026-11-02')).json.open, 0, 'Monday starts the next week');
  assert.equal((await b.get('/api/proofloop/heads-up?deadline=2026-10-28')).json.open, 0, 'only your own promises');
  for (const bad of ['', 'friday', '2026-13-45x']) { const r = await a.get('/api/proofloop/heads-up?deadline=' + bad); assert.equal(r.status, 400); assert.match(r.json.error.message, /^Enter the date as a date/); }
});

test('Quick capture shows the "before you promise" heads-up on a new promise in a busy week, and not otherwise', async () => {
  const { s, a } = await setup(); fixture(s.app.db);
  const quiet = (await a.post('/api/capture/preview', { text: 'I promised Sam the slides by 2026-10-30' })).json; assert.equal(quiet.items[0].tool, 'commitments.create'); assert.equal(quiet.items[0].headsUp, null);
  add(s.app.db, 1, { who: 'Noor', deadline: '2026-10-27', status: 'task_prepared' }); add(s.app.db, 1, { who: 'Ali', deadline: '2026-11-01', status: 'task_prepared' });
  const busy = (await a.post('/api/capture/preview', { text: 'I promised Sam the slides by 2026-10-30, note: gate code' })).json;
  assert.match(busy.items[0].headsUp, /You already have 3 open promises due the week of 2026-10-26/); assert.equal(busy.items[1].headsUp, null);
  assert.equal(s.app.db.prepare("SELECT COUNT(*) n FROM commitments WHERE title LIKE '%slides%'").get().n, 0, 'a preview writes nothing');
});

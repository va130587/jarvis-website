// Planning around the calendar (server): events sent with the plan request become fixed blocks, tasks are planned around them,
// all-day events do not block time, the events are never stored, and with no calendar the plan is exactly what it was.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);

const at = iso => Date.parse(iso + '+04:00');
const k = { t: at('2026-10-19T08:00:00') };           // Monday, before work
async function setup() { const s = await boot({ NOVA_RATE_CHAT_MAX: '100000' }, { now: () => k.now ? k.now() : k.t }); const c = s.client(); await c.login('roshan@example.com'); return { s, c }; }
const task = (db, title, due, est) => db.prepare("INSERT INTO tasks (user_id, title, due, status, created_at, estimate_min) VALUES (1, ?, ?, 'open', 1, ?)").run(title, due, est || null);
const propose = (c, events, extra) => c.post('/api/plan/propose', Object.assign({ start: '09:00', end: '18:00', events }, extra || {}));
const mins = s => +s.slice(0, 2) * 60 + +s.slice(3);
const overlaps = (a, b) => mins(a.start) < mins(b.end) && mins(b.start) < mins(a.end);
const allText = db => { const out = []; for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '%_fts%' AND name NOT LIKE 'sqlite_%' AND name != 'sessions'").all()) { try { out.push(JSON.stringify(db.prepare('SELECT * FROM ' + t.name).all())); } catch (e) { /* virtual table */ } } return out.join('\n'); };

test('with no events the plan is exactly what it was; "no calendar" is not an error', async () => {
  const { s, c } = await setup(); k.t = at('2026-10-19T08:00:00'); task(s.app.db, 'Prepare the client presentation', '2026-10-19', 120); task(s.app.db, 'Call the bank', '2026-10-16');
  const plain = (await c.get('/api/plan')).json.proposal, same = (await propose(c, undefined)).json.proposal;
  assert.equal(plain.calendar, null); assert.deepEqual(same.blocks, plain.blocks); assert.equal(same.summary, plain.summary); assert.equal(same.calendar, null);
  const empty = (await propose(c, [])).json.proposal; assert.deepEqual(empty.blocks, plain.blocks); assert.equal(empty.calendar.events, 0); assert.equal(empty.calendar.used, true);
  assert.equal(empty.totals.freeMin, plain.totals.freeMin);
});

test('events at the start, middle and end of the day become fixed blocks and no task is planned over them', async () => {
  const { s, c } = await setup(); k.t = at('2026-10-19T08:00:00'); const db = s.app.db;
  task(db, 'Prepare the client presentation', '2026-10-19', 120); task(db, 'Call the bank', '2026-10-16', 30); task(db, 'Write the project report', '2026-10-19', 60); task(db, 'Study for the exam', '2026-10-19', 45);
  const events = [{ title: 'Stand-up', start: '09:00', end: '09:30' }, { title: 'Design review', start: '11:00', end: '12:00' }, { title: 'Dentist', start: '17:00', end: '18:00' }];
  const r = (await propose(c, events, { day: '2026-10-19' })); assert.equal(r.status, 200); const p = r.json.proposal;
  const ev = p.blocks.filter(b => b.kind === 'event'), work = p.blocks.filter(b => b.minutes);
  assert.deepEqual(ev.map(b => [b.title, b.start, b.end, b.fixed]), [['Stand-up', '09:00', '09:30', true], ['Design review', '11:00', '12:00', true], ['Dentist', '17:00', '18:00', true]]);
  assert.equal(work.length, 4, 'all four fit: the free gaps between meetings are used'); assert.equal(p.unscheduled.length, 0); assert.ok(work.some(w => w.start >= '10:00' && w.end <= '11:00'), 'a task sits in the gap before the design review'); for (const w of work) for (const e of ev) assert.equal(overlaps(w, e), false, w.title + ' ' + w.start + '-' + w.end + ' over ' + e.title);
  assert.equal(work[0].start, '09:30', 'the first task starts when the stand-up ends'); assert.deepEqual(p.blocks.map(b => b.start), p.blocks.map(b => b.start).slice().sort());
  assert.deepEqual(p.calendar, { used: true, events: 3, allDay: [], busyMin: 150 }); assert.match(p.summary, /Planned around 3 calendar events \(2h 30m busy\)/);
  const plain = (await c.get('/api/plan')).json.proposal; assert.equal(p.totals.freeMin, Math.max(0, plain.totals.freeMin - 150 - p.totals.plannedMin + plain.totals.plannedMin), 'free time counts the busy minutes');
});

test('an event over lunch, overlapping events and an event partly before the planning start are handled; lunch stays protected', async () => {
  const { s, c } = await setup(); k.t = at('2026-10-19T09:35:00'); const db = s.app.db;        // planning from 09:45
  for (let i = 0; i < 6; i++) task(db, 'Write chapter ' + i, '2026-10-19', 60);
  const p = (await propose(c, [{ title: 'Early call', start: '08:30', end: '10:15' }, { title: 'Lunch meeting', start: '12:30', end: '13:30' }, { title: 'Overlap A', start: '15:00', end: '16:00' }, { title: 'Overlap B', start: '15:30', end: '16:30' }])).json.proposal;
  const ev = p.blocks.filter(b => b.kind === 'event'), work = p.blocks.filter(b => b.minutes), lunch = p.blocks.find(b => b.kind === 'lunch');
  assert.equal(ev[0].start, '09:45', 'the part of an event before the planning start is cut off'); assert.equal(ev[0].end, '10:15'); assert.equal(work[0].start, '10:15');
  for (const w of work) { for (const e of ev) assert.equal(overlaps(w, e), false, w.title + ' over ' + e.title); if (lunch) assert.equal(overlaps(w, lunch), false); }
  assert.ok(lunch && lunch.start === '13:00' && lunch.end === '14:00', 'lunch is kept even with an event over it');
  assert.equal(p.calendar.busyMin, (10 * 60 + 15 - 585) + (13 * 60 - 12 * 60 - 30) + 90 + 0, 'overlapping events and the lunch hour are not counted twice: ' + p.calendar.busyMin);
});

test('all-day events are only mentioned; they do not block time; the day is full of meetings so tasks say they do not fit', async () => {
  const { s, c } = await setup(); k.t = at('2026-10-19T08:00:00'); task(s.app.db, 'Write the project report', '2026-10-19', 60);
  const a = (await propose(c, [{ title: 'Public holiday', allDay: true }, { title: 'Birthday', allDay: true, start: 'x' }])).json.proposal;
  assert.equal(a.blocks.filter(b => b.kind === 'event').length, 0); assert.equal(a.blocks.find(b => b.minutes).start, '09:00'); assert.deepEqual(a.calendar.allDay, ['Public holiday', 'Birthday']); assert.match(a.summary, /no timed calendar events, plus 2 all-day events that do not block time/);
  const full = (await propose(c, [{ title: 'All-day workshop', start: '09:00', end: '18:00' }])).json.proposal;
  assert.equal(full.blocks.filter(b => b.minutes).length, 0); assert.equal(full.unscheduled.length, 1); assert.match(full.unscheduled[0].why, /does not fit/); assert.equal(full.totals.freeMin, 0);
});

test('only the planned day: a different day is refused, and unreadable events change nothing', async () => {
  const { c } = await setup(); k.t = at('2026-10-19T08:00:00');
  const wrong = await propose(c, [], { day: '2026-10-20' }); assert.equal(wrong.status, 409); assert.match(wrong.json.error.message, /planned day changed/);
  k.t = at('2026-10-19T17:50:00'); await c.login('roshan@example.com'); assert.equal((await c.get('/api/plan')).json.proposal.day, '2026-10-20', 'after work it plans tomorrow'); assert.equal((await propose(c, [], { day: '2026-10-20' })).status, 200); assert.equal((await propose(c, [], { day: '2026-10-19' })).status, 409);
  k.t = at('2026-10-19T08:00:00'); await c.login('roshan@example.com');
  for (const bad of ['nope', { a: 1 }, Array.from({ length: 41 }, () => ({ title: 'x', start: '09:00', end: '10:00' })), [{ title: 'x', start: '9am', end: '10am' }], [null], [[]], [{ title: 'x', start: '09:00', end: '25:00' }]]) {
    const r = await propose(c, bad); assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 40)); assert.match(r.json.error.message, /could not be read/);
    assert.doesNotMatch(r.json.error.message, /undefined|\[object|Error:/);
  }
  assert.equal((await propose(c, [{ title: 'ends before it starts', start: '11:00', end: '10:00' }])).json.proposal.blocks.filter(b => b.kind === 'event').length, 0);
  assert.equal((await (await boot()).client().post('/api/plan/propose', {})).status, 401);
});

test('events are never stored: a proposal writes nothing; a saved plan keeps only "busy" blocks without titles', async () => {
  const { s, c } = await setup(); k.t = at('2026-10-19T08:00:00'); const db = s.app.db; task(db, 'Write the project report', '2026-10-19', 60);
  const T = 'Secret board meeting about the acquisition', A = 'Confidential all-day offsite';
  const before = allText(db); await propose(c, [{ title: T, start: '10:00', end: '11:00' }, { title: A, allDay: true }]);
  assert.equal(allText(db), before, 'a proposal writes nothing'); assert.equal(db.prepare('SELECT COUNT(*) n FROM day_plans').get().n, 0);
  const saved = await c.post('/api/plan', { start: '09:00', end: '18:00', day: '2026-10-19', events: [{ title: T, start: '10:00', end: '11:00' }, { title: A, allDay: true }] }); assert.equal(saved.status, 201);
  const data = db.prepare('SELECT data FROM day_plans').get().data; assert.doesNotMatch(allText(db), /Secret board meeting|Confidential all-day|acquisition/);
  const plan = JSON.parse(data); const b = plan.blocks.find(x => x.kind === 'event'); assert.equal(b.title, 'Busy (calendar)'); assert.equal(b.start, '10:00'); assert.deepEqual(plan.calendar.allDay, ['All-day event']);
  assert.ok(plan.blocks.filter(x => x.minutes).every(w => !overlaps(w, b)));
  assert.doesNotMatch(JSON.stringify((await c.get('/api/plan')).json), /Secret board|acquisition/);
});

test('"What happens if": a reminder at the time of a busy block says so, and the saved plan is described as around busy blocks', async () => {
  const { s, c } = await setup(); k.t = at('2026-10-19T08:00:00'); task(s.app.db, 'Write the project report', '2026-10-19', 60);
  await c.post('/api/plan', { start: '09:00', end: '18:00', day: '2026-10-19', events: [{ title: 'Board', start: '15:00', end: '16:00' }] });
  const r = await c.post('/api/chat', { message: 'remind me at 3pm to call mum' }); assert.ok(r.json.run && r.json.run.pendingApproval, JSON.stringify(r.json).slice(0, 200));
  const fx = r.json.run.pendingApproval.preview.effects; assert.ok(fx.some(e => /clashes with a calendar event in your saved plan \(15:00 to 16:00\)/.test(e)), JSON.stringify(fx));
  const t = await c.post('/api/chat', { message: 'add a task to send the invoice by 2026-10-19' });
  const tfx = t.json.run.pendingApproval.preview.effects; assert.ok(tfx.some(e => /around 1 busy calendar block/.test(e)), JSON.stringify(tfx));
  assert.doesNotMatch(JSON.stringify(fx) + JSON.stringify(tfx), /Board/);
});

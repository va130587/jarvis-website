// Life Timeline (server): everything that happened, merged and newest first, with exact order and Dubai days on a known fixture, paged with a cursor so
// 1,200+ events are all seen once, type filters and a safe search (Arabic, emoji, % and _), read-only, and nobody else's events.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);

const at = iso => Date.parse(iso + '+04:00'), NOW = at('2026-10-21T09:00:00');
async function setup() { const s = await boot({ NOVA_RATE_API_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }, { now: () => NOW }); const a = s.client(), b = s.client(); await a.login('roshan@example.com'); await b.login('mallory@example.com'); return { s, a, b }; }
const tl = (c, q) => c.get('/api/timeline' + (q || '')).then(r => r.json);
const OLD = at('2026-09-01T09:00:00');
function task(db, uid, title, doneAt, due) { db.prepare("INSERT INTO tasks (user_id, title, due, status, created_at, completed_at) VALUES (?, ?, ?, 'done', ?, ?)").run(uid, title, due || null, OLD, at(doneAt)); }
function note(db, uid, text, when) { db.prepare('INSERT INTO notes (user_id, text, created_at) VALUES (?, ?, ?)').run(uid, text, at(when)); }
function expense(db, uid, day, fils, cat, noteText, createdAt) { db.prepare('INSERT INTO expenses (user_id, amount_fils, category, note, day, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, fils, cat, noteText || null, day, at(createdAt || day + 'T12:00:00')); }
function habit(db, uid, name, days) { const id = Number(db.prepare('INSERT INTO habits (user_id, name, schedule, created_at) VALUES (?, ?, ?, ?)').run(uid, name, 'daily', OLD).lastInsertRowid); days.forEach(d => db.prepare('INSERT INTO habit_checks (habit_id, user_id, day, created_at) VALUES (?, ?, ?, ?)').run(id, uid, d[0], at(d[1]))); }
function promise(db, uid, title, who, keptAt, dir) { const id = Number(db.prepare("INSERT INTO commitments (user_id, title, direction, counterparty, source_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'manual', 'verified', ?, ?)").run(uid, title, dir || 'i_owe', who, OLD, OLD).lastInsertRowid); [['verified', keptAt], ['completed', keptAt.replace(/T(\d\d):/, (m, h) => 'T' + String(+h + 1).padStart(2, '0') + ':')]].forEach(([st, w], i) => db.prepare("INSERT INTO commitment_events (commitment_id, user_id, seq, from_status, to_status, note, actor, ts) VALUES (?, ?, ?, 'x', ?, 'x', 'you', ?)").run(id, uid, i + 2, st, at(w))); }
function action(db, uid, request, tool, when, undone) { const r = Number(db.prepare("INSERT INTO runs (user_id, request, status, planner, created_at, updated_at) VALUES (?, ?, 'completed', 'rules', 1, 1)").run(uid, request).lastInsertRowid); db.prepare("INSERT INTO tool_executions (user_id, run_id, tool, input, status, undone_at, started_at, finished_at) VALUES (?, ?, ?, '{}', 'succeeded', ?, ?, ?)").run(uid, r, tool, undone ? 1 : null, at(when), at(when)); }
function fixture(db) {
  task(db, 1, 'Send the proposal', '2026-10-20T10:00:00', '2026-10-20'); note(db, 1, 'Gate code is on the fridge', '2026-10-20T09:30:00'); expense(db, 1, '2026-10-20', 4500, 'food', 'Lunch with Sara', '2026-10-20T13:10:00');
  habit(db, 1, 'Read', [['2026-10-20', '2026-10-20T07:00:00'], ['2026-10-19', '2026-10-19T07:00:00']]); promise(db, 1, 'Send Sara the slides', 'Sara', '2026-10-19T16:00:00'); action(db, 1, 'add a task to call HR by friday', 'tasks.create', '2026-10-19T15:00:00');
  task(db, 1, 'Midnight task', '2026-10-18T23:59:00'); task(db, 1, 'After midnight task', '2026-10-19T00:00:00'); expense(db, 1, '2026-10-18', 1000, 'fun', 'Late log for Sunday', '2026-10-19T08:00:00');
  promise(db, 1, 'Lina sent the contract', 'Lina', '2026-10-17T11:00:00', 'owed_to_me'); action(db, 1, 'delete task old', 'tasks.delete', '2026-10-17T10:00:00', true);
}

test('everything merged, newest first, with the right day, time, kind, wording and link', async () => {
  const { s, a } = await setup(); fixture(s.app.db); const r = await a.get('/api/timeline'); assert.equal(r.status, 200); const d = r.json;
  assert.deepEqual(d.events.map(e => e.title), ['AED 45 on Lunch with Sara', 'Send the proposal', 'Gate code is on the fridge', 'Read', 'Send Sara the slides', 'add a task to call HR by friday', 'Read', 'After midnight task', 'Midnight task', 'AED 10 on Late log for Sunday', 'Lina sent the contract', 'delete task old']);
  const by = t => d.events.find(e => e.title === t);
  assert.deepEqual([by('Send the proposal').type, by('Send the proposal').day, by('Send the proposal').time, by('Send the proposal').link, by('Send the proposal').detail], ['task', '2026-10-20', '10:00', '#hub', 'Due 2026-10-20']);
  assert.deepEqual([by('Send Sara the slides').what, by('Send Sara the slides').detail, by('Send Sara the slides').time, by('Send Sara the slides').link], ['Promise kept', 'To Sara', '16:00', '#proofloop'], 'the first time it was verified, not the later completion');
  assert.deepEqual([by('Lina sent the contract').what, by('Lina sent the contract').detail], ['Promise to me kept', 'From Lina']);
  assert.deepEqual([by('delete task old').type, by('delete task old').detail, by('delete task old').link], ['action', 'tasks.delete (undone)', '#replay']); assert.equal(by('add a task to call HR by friday').what, 'NOVA did this for you');
  assert.deepEqual([by('Midnight task').day, by('After midnight task').day], ['2026-10-18', '2026-10-19'], 'Dubai midnight splits the days'); assert.equal(by('Midnight task').time, '23:59'); assert.equal(by('After midnight task').time, '00:00');
  const late = by('AED 10 on Late log for Sunday'); assert.equal(late.day, '2026-10-18'); assert.equal(late.time, null, 'logged on another day than it belongs to: the day, no time'); assert.equal(by('AED 45 on Lunch with Sara').detail, 'food');
  assert.equal(d.next, null); assert.equal(d.today, '2026-10-21'); assert.deepEqual(d.types.map(t => t.id), ['task', 'promise', 'expense', 'habit', 'note', 'action']);
});

test('paging with a cursor shows every event exactly once, including events at the same second (1,250 events)', async () => {
  const { s, a } = await setup(); const db = s.app.db, ins = db.prepare('INSERT INTO notes (user_id, text, created_at) VALUES (1, ?, ?)'), tins = db.prepare("INSERT INTO tasks (user_id, title, status, created_at, completed_at) VALUES (1, ?, 'done', ?, ?)");
  db.exec('BEGIN'); for (let i = 0; i < 1000; i++) ins.run('Note ' + i, at('2026-10-20T08:00:00') + Math.floor(i / 5) * 1000);          // five notes share each second
  for (let i = 0; i < 250; i++) tins.run('Task ' + i, OLD, at('2026-10-20T08:00:00') + Math.floor(i / 5) * 1000); db.exec('COMMIT');       // and five tasks share the same seconds
  const seen = []; let cursor = null, pages = 0;
  do { const d = await tl(a, '?limit=100' + (cursor ? '&before=' + encodeURIComponent(cursor) : '')); assert.ok(d.events.length <= 100); d.events.forEach(e => seen.push(e.key)); cursor = d.next; pages++; } while (cursor && pages < 30);
  assert.equal(seen.length, 1250); assert.equal(new Set(seen).size, 1250, 'no event twice, none missing'); assert.equal(pages, 13);
  const ts = []; cursor = null; do { const d = await tl(a, '?limit=100' + (cursor ? '&before=' + encodeURIComponent(cursor) : '')); d.events.forEach(e => ts.push(e.ts)); cursor = d.next; } while (cursor);
  assert.deepEqual(ts, ts.slice().sort((x, y) => y - x), 'newest first all the way');
  assert.equal((await tl(a, '?limit=5000')).events.length, 100, 'a page is at most 100'); assert.equal((await tl(a, '?limit=0')).events.length, 50, 'a bad limit uses the default');
});

test('a very busy day (450 expenses and 300 habit check-ins on the same day) is paged completely too', async () => {
  const { s, a } = await setup(); const db = s.app.db; db.exec('BEGIN');
  const ex = db.prepare('INSERT INTO expenses (user_id, amount_fils, category, day, created_at) VALUES (1, ?, ?, ?, ?)'); for (let i = 0; i < 450; i++) ex.run(100 + i, 'food', '2026-10-20', at('2026-10-20T06:00:00') + i * 1000);
  for (let h = 0; h < 300; h++) { const id = Number(db.prepare('INSERT INTO habits (user_id, name, schedule, created_at) VALUES (1, ?, ?, ?)').run('Habit ' + h, 'daily', OLD).lastInsertRowid); db.prepare('INSERT INTO habit_checks (habit_id, user_id, day, created_at) VALUES (?, 1, ?, ?)').run(id, '2026-10-20', at('2026-10-20T07:00:00')); } db.exec('COMMIT');
  const seen = []; let cursor = null, pages = 0; do { const d = await tl(a, '?limit=100' + (cursor ? '&before=' + encodeURIComponent(cursor) : '')); d.events.forEach(e => seen.push(e.key)); cursor = d.next; pages++; } while (cursor && pages < 20);
  assert.equal(seen.length, 750); assert.equal(new Set(seen).size, 750);
});

test('filters by kind and a safe search: Arabic, emoji and the characters % and _ are plain text', async () => {
  const { s, a } = await setup(); fixture(s.app.db); note(s.app.db, 1, 'مراجعة طلب التأشيرة 🚀', '2026-10-20T11:00:00'); note(s.app.db, 1, 'Save 100% of it', '2026-10-20T11:05:00'); note(s.app.db, 1, 'a_b literal underscore', '2026-10-20T11:06:00'); note(s.app.db, 1, 'axb should not match', '2026-10-20T11:07:00');
  assert.deepEqual((await tl(a, '?types=note')).events.map(e => e.type), ['note', 'note', 'note', 'note', 'note']); assert.deepEqual((await tl(a, '?types=habit,expense')).events.map(e => e.type).sort(), ['expense', 'expense', 'habit', 'habit']);
  assert.deepEqual((await tl(a, '?q=' + encodeURIComponent('التأشيرة'))).events.map(e => e.title), ['مراجعة طلب التأشيرة 🚀']); assert.equal((await tl(a, '?q=' + encodeURIComponent('🚀'))).events.length, 1);
  assert.deepEqual((await tl(a, '?q=' + encodeURIComponent('100%'))).events.map(e => e.title), ['Save 100% of it']); assert.deepEqual((await tl(a, '?q=' + encodeURIComponent('a_b'))).events.map(e => e.title), ['a_b literal underscore'], '_ is not a wildcard');
  assert.deepEqual((await tl(a, '?q=sara&types=task,promise,expense')).events.map(e => e.title).sort(), ['AED 45 on Lunch with Sara', 'Send Sara the slides']); assert.equal((await tl(a, '?q=nothing-matches-this')).events.length, 0);
  const bad = await a.get('/api/timeline?types=nonsense'); assert.equal(bad.status, 400); assert.equal(bad.json.error.message, 'Choose at least one kind of event to show.'); const cur = await a.get('/api/timeline?before=abc'); assert.equal(cur.status, 400); assert.match(cur.json.error.message, /^That page marker is not valid/);
});

test('read-only, sign-in required, and another person\'s events never appear', async () => {
  const { s, a, b } = await setup(); fixture(s.app.db); task(s.app.db, 2, 'Mallory secret task', '2026-10-20T12:00:00'); note(s.app.db, 2, 'Mallory secret note', '2026-10-20T12:00:00'); action(s.app.db, 2, 'mallory private request', 'notes.create', '2026-10-20T12:00:00');
  const snap = () => JSON.stringify(['tasks', 'notes', 'expenses', 'habit_checks', 'commitment_events', 'runs', 'tool_executions'].map(t => s.app.db.prepare('SELECT COUNT(*) n FROM ' + t).get().n)), before = snap();
  const mine = await tl(a, '?limit=100'), theirs = await tl(b, '?limit=100'); assert.equal(snap(), before); assert.doesNotMatch(JSON.stringify(mine), /Mallory|mallory/); assert.deepEqual(theirs.events.map(e => e.title).sort(), ['Mallory secret note', 'Mallory secret task', 'mallory private request']);
  assert.equal((await s.client().get('/api/timeline')).status, 401);
});

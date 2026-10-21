// Export and import (server): a round trip returns the same data, importing twice adds nothing, damaged or oversized files are refused
// with plain words, nothing changes before Approve, and another person's file only ever lands in YOUR account.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);

const NOW = Date.parse('2026-10-21T09:00:00+04:00'), clock = { t: NOW };
async function setup(env) { const s = await boot(env || {}, { now: () => clock.t }); const a = s.client(), b = s.client(); await a.login('roshan@example.com'); await b.login('mallory@example.com'); return { s, a, b }; }
const counts = (db, uid) => Object.fromEntries([['tasks', 'tasks WHERE deleted_at IS NULL'], ['notes', 'notes WHERE deleted_at IS NULL'], ['memories', "memories WHERE status = 'active'"], ['commitments', 'commitments'], ['reminders', 'reminders'], ['habits', 'habits'], ['expenses', 'expenses WHERE deleted_at IS NULL'], ['documents', 'documents'], ['checks', 'habit_checks']]
  .map(([k, t]) => [k, db.prepare('SELECT COUNT(*) n FROM ' + t.split(' WHERE')[0] + ' WHERE user_id = ?' + (t.includes(' WHERE') ? ' AND ' + t.split(' WHERE ')[1] : '')).get(uid).n]));
function fill(s, uid) {
  const db = s.app.db, t = NOW;
  db.prepare("INSERT INTO tasks (user_id, title, due, status, created_at) VALUES (?, 'Pay the electricity bill', '2026-10-25', 'open', ?)").run(uid, t);
  db.prepare("INSERT INTO tasks (user_id, title, due, status, created_at, completed_at) VALUES (?, 'مراجعة طلب التأشيرة 🚀', NULL, 'done', ?, ?)").run(uid, t, t);
  db.prepare("INSERT INTO notes (user_id, text, created_at) VALUES (?, 'Visa photos need a white background', ?)").run(uid, t);
  db.prepare("INSERT INTO memories (user_id, kind, text, source, status, sensitive, created_at, updated_at) VALUES (?, 'preference', 'I like short answers', 'user', 'active', 0, ?, ?)").run(uid, t, t);
  db.prepare("INSERT INTO commitments (user_id, title, direction, counterparty, deadline, source_type, status, created_at, updated_at) VALUES (?, 'Send the proposal', 'i_owe', 'Alex', '2026-10-30', 'manual', 'awaiting_confirmation', ?, ?)").run(uid, t, t);
  db.prepare("INSERT INTO commitments (user_id, title, direction, counterparty, deadline, source_type, status, created_at, updated_at) VALUES (?, 'Lab quote', 'owed_to_me', 'Omar', NULL, 'manual', 'verified', ?, ?)").run(uid, t, t);
  db.prepare("INSERT INTO reminders (user_id, text, due_at, repeat, status, created_at) VALUES (?, 'Call mum', ?, 'none', 'pending', ?)").run(uid, NOW + 86400e3, t);
  const h = Number(db.prepare("INSERT INTO habits (user_id, name, schedule, created_at) VALUES (?, 'Read 20 minutes', 'daily', ?)").run(uid, t).lastInsertRowid);
  for (const d of ['2026-10-19', '2026-10-20']) db.prepare('INSERT INTO habit_checks (habit_id, user_id, day, created_at) VALUES (?, ?, ?, ?)').run(h, uid, d, t);
  db.prepare("INSERT INTO expenses (user_id, amount_fils, category, note, day, created_at) VALUES (?, 4550, 'food', 'lunch', '2026-10-20', ?)").run(uid, t);
  s.app.kb.add(uid, { title: 'Visa checklist', kind: 'note', text: 'Bring two photos.\n\nBring the passport.' });
}
const post = (c, p, b) => c.post(p, b);
async function importAll(c, data) { const pv = await post(c, '/api/import/preview', { data }); assert.equal(pv.status, 200, JSON.stringify(pv.json)); return { pv, ap: await post(c, '/api/import/apply', { importId: pv.json.importId, approve: true }) }; }

test('round trip: export, wipe, import gives back the same items', async () => {
  const { s, a } = await setup(); fill(s, 1); const before = counts(s.app.db, 1);
  const exp = (await a.get('/api/export')).json; assert.equal(exp.format, 'nova-export'); assert.equal(exp.version, 1);
  for (const t of ['habit_checks', 'habits', 'reminders', 'expenses', 'commitment_events', 'commitments', 'tasks', 'notes', 'memories', 'chunks', 'documents']) s.app.db.prepare('DELETE FROM ' + t + ' WHERE user_id = 1').run();
  s.app.db.prepare('DELETE FROM chunks_fts').run();
  assert.equal(counts(s.app.db, 1).tasks, 0);
  const { pv, ap } = await importAll(a, exp);
  assert.deepEqual(pv.json.sections.map(x => [x.key, x.add]), [['tasks', 2], ['notes', 1], ['memories', 1], ['commitments', 2], ['reminders', 1], ['habits', 1], ['expenses', 1], ['documents', 1]]);
  assert.equal(ap.status, 200); assert.equal(ap.json.total, 10); assert.deepEqual(counts(s.app.db, 1), before);
  const t = s.app.db.prepare("SELECT title, due, status FROM tasks WHERE user_id = 1 ORDER BY id").all(); assert.deepEqual(t.map(x => x.title).sort(), ['Pay the electricity bill', 'مراجعة طلب التأشيرة 🚀'].sort());
  assert.equal(s.app.db.prepare("SELECT status FROM tasks WHERE title LIKE 'مراجعة%'").get().status, 'done');
  assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM habit_checks').get().n, 2);
  assert.equal(s.app.db.prepare("SELECT amount_fils f FROM expenses WHERE user_id = 1").get().f, 4550);
  assert.ok(s.app.kb.search(1, 'passport', 3).length > 0, 'the imported document is searchable');
  assert.ok(s.app.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'import_applied'").get().n === 1);
});

test('honest about proof: a "verified" commitment comes back as "awaiting confirmation", with a note, and has a timeline entry', async () => {
  const { s, a } = await setup(); fill(s, 1); const exp = (await a.get('/api/export')).json;
  s.app.db.prepare('DELETE FROM commitments WHERE user_id = 1').run();
  const { pv } = await importAll(a, exp);
  assert.match(pv.json.notes.join(' '), /Proof is not imported/);
  assert.equal(s.app.db.prepare("SELECT status FROM commitments WHERE title = 'Lab quote'").get().status, 'awaiting_confirmation');
  assert.equal(s.app.db.prepare("SELECT status FROM commitments WHERE title = 'Send the proposal'").get().status, 'awaiting_confirmation');
  const ev = s.app.db.prepare("SELECT note FROM commitment_events WHERE user_id = 1").all(); assert.equal(ev.length, 2); assert.match(ev[0].note, /Imported from a NOVA export/);
});

test('merge: importing the same file again adds nothing, and a mixed file only adds what is new', async () => {
  const { s, a } = await setup(); fill(s, 1); const exp = (await a.get('/api/export')).json; const before = counts(s.app.db, 1);
  const again = await post(a, '/api/import/preview', { data: exp });
  assert.equal(again.json.totalNew, 0); assert.ok(again.json.sections.every(x => x.add === 0 && x.have === x.found - x.refused - (x.key === 'reminders' ? 0 : 0)), JSON.stringify(again.json.sections));
  const ap = await post(a, '/api/import/apply', { importId: again.json.importId, approve: true }); assert.equal(ap.json.total, 0); assert.deepEqual(counts(s.app.db, 1), before);
  const mixed = Object.assign({}, exp, { tasks: exp.tasks.concat([{ title: 'Renew the gym card', due: '2026-11-01', status: 'open' }, { title: 'pay the electricity bill', due: '2026-10-25', status: 'open' }, { title: 'Renew the gym card', due: '2026-11-01', status: 'open' }]) });
  const r = await importAll(a, mixed); assert.equal(r.pv.json.sections[0].add, 1, 'one new task; the other two are duplicates (even with different capital letters, or twice in the file)');
  assert.equal(counts(s.app.db, 1).tasks, before.tasks + 1);
});

test('nothing is written before Approve: a preview changes no rows, and apply without approval or with a wrong id is refused', async () => {
  const { s, a, b } = await setup(); fill(s, 2); const exp = (await b.get('/api/export')).json;
  const snap = () => JSON.stringify(counts(s.app.db, 1)) + s.app.db.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
  const before = snap(); const pv = await post(a, '/api/import/preview', { data: exp }); assert.equal(pv.status, 200); assert.ok(pv.json.totalNew > 5); assert.equal(snap(), before, 'a preview writes nothing');
  for (const body of [{ importId: pv.json.importId }, { importId: pv.json.importId, approve: 'yes' }, { importId: pv.json.importId, approve: false }]) { const r = await post(a, '/api/import/apply', body); assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.json.error.message, /Press Approve/); }
  assert.equal(snap(), before);
  const wrong = await post(a, '/api/import/apply', { importId: 'nope', approve: true }); assert.equal(wrong.status, 404); assert.match(wrong.json.error.message, /expired/);
  const theirs = await post(b, '/api/import/apply', { importId: pv.json.importId, approve: true }); assert.equal(theirs.status, 404, "another person's preview id does not work for you");
  assert.equal(snap(), before);
  clock.t += 16 * 60e3; const late = await post(a, '/api/import/apply', { importId: pv.json.importId, approve: true }); assert.equal(late.status, 404, 'a preview expires after 15 minutes'); clock.t = NOW;
  const c = await post(a, '/api/import/preview', { data: exp }); await post(a, '/api/import/cancel', { importId: c.json.importId }); assert.equal((await post(a, '/api/import/apply', { importId: c.json.importId, approve: true })).status, 404);
});

test("another person's file lands only in your account; their account is untouched; the preview says whose file it is", async () => {
  const { s, a, b } = await setup(); fill(s, 2); const theirs = counts(s.app.db, 2); const exp = (await b.get('/api/export')).json;
  const { pv, ap } = await importAll(a, exp);
  assert.equal(pv.json.fromOtherAccount, true); assert.match(pv.json.notes.join(' '), /different account \(mallory@example\.com\).*YOUR account only/);
  assert.equal(ap.status, 200); assert.deepEqual(counts(s.app.db, 2), theirs, 'their data is unchanged');
  assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM tasks WHERE user_id = 1').get().n, 2); assert.equal(s.app.db.prepare("SELECT COUNT(*) n FROM tasks WHERE user_id = 1 AND title = 'Pay the electricity bill'").get().n, 1);
  const forged = JSON.parse(JSON.stringify(exp)); forged.tasks[0].user_id = 2; forged.tasks[0].id = 999; forged.tasks[0].title = 'Forged id task';
  await importAll(a, forged); assert.equal(s.app.db.prepare("SELECT user_id FROM tasks WHERE title = 'Forged id task'").get().user_id, 1);
});

test('what is never imported: sessions, tokens, secrets, e-mail, and anything unknown is refused in plain words', async () => {
  const { s, a } = await setup(); fill(s, 1); const exp = (await a.get('/api/export')).json; const before = JSON.stringify(counts(s.app.db, 1));
  for (const [name, bad] of [['sessions', { sessions: [{ id: 'x' }] }], ['tokens', { token_enc: 'abc' }], ['secrets', { secrets: { NOVA_SECRET_KEY: 'x' } }], ['csrf', { csrf: 'x' }], ['a made-up part', { __proto__x: 1, hacked: [] }]]) {
    const r = await post(a, '/api/import/preview', { data: Object.assign({}, exp, bad) }); assert.equal(r.status, 400, name); assert.match(r.json.error.message, /does not recognise/, name);
    assert.doesNotMatch(r.json.error.message, /undefined|\[object|Error:/);
  }
  const ok = await post(a, '/api/import/preview', { data: Object.assign({}, exp, { email: { connections: [{ provider: 'gmail', account: 'x@y.z', scope: 'read' }], messages: [] }, conversations: [], notifications: [] }) });
  assert.equal(ok.status, 200); assert.ok(ok.json.ignored.includes('e-mail') && ok.json.ignored.includes('chat history'));
  await post(a, '/api/import/apply', { importId: ok.json.importId, approve: true });
  assert.equal(s.app.db.prepare("SELECT COUNT(*) n FROM connections WHERE user_id = 1").get().n, 0); assert.equal(JSON.stringify(counts(s.app.db, 1)), before);
});

test('damaged or hostile files are refused with a plain reason and change nothing', async () => {
  const { s, a } = await setup(); const before = JSON.stringify(counts(s.app.db, 1));
  const cases = [
    ['not an export', { data: { hello: 'world' } }, /does not recognise|nothing NOVA can import/],
    ['wrong format', { data: { format: 'other', tasks: [] } }, /not a NOVA export/],
    ['newer version', { data: { format: 'nova-export', version: 2, tasks: [] } }, /newer NOVA/],
    ['a list that is not a list', { data: { format: 'nova-export', tasks: 'abc' } }, /damaged/],
    ['an array instead of an object', { data: [1, 2] }, /not a NOVA export/],
    ['a missing file', {}, /Choose a NOVA export file/],
    ['too many items', { data: { tasks: Array.from({ length: 5001 }, (_, i) => ({ title: 't' + i })) } }, /more than 5000/]];
  for (const [name, body, rx] of cases) { const r = await post(a, '/api/import/preview', body); assert.equal(r.status, 400, name); assert.match(r.json.error.message, rx, name); }
  const bad = await post(a, '/api/import/preview', { data: { tasks: [{ title: '' }, { title: 5 }, { title: 'x'.repeat(301) }, { title: 'ok', due: '2026-13-45' }, { title: 'ok2', status: 'weird' }, null, 'str', [], { title: 'Fine one' }], notes: [{ text: 'a'.repeat(20001) }], expenses: [{ amount_fils: -5, category: 'x', day: '2026-10-01' }, { amount_fils: 1.5, category: 'x', day: '2026-10-01' }], commitments: [{ title: 'c', direction: 'sideways', status: 'completed' }], habits: [{ name: 'h', checks: ['nope'] }] } });
  assert.equal(bad.status, 200); const sec = Object.fromEntries(bad.json.sections.map(x => [x.key, x])); assert.equal(sec.tasks.add, 1); assert.equal(sec.tasks.refused, 8);
  assert.equal(sec.notes.refused, 1); assert.equal(sec.expenses.refused, 2); assert.equal(sec.commitments.refused, 1); assert.equal(sec.habits.refused, 1);
  assert.equal(JSON.stringify(counts(s.app.db, 1)), before);
});

test('an oversized file is refused before it is read, and an old reminder or a secret-looking memory is left out', async () => {
  const { s, a } = await setup();
  const huge = await a.raw('POST', '/api/import/preview', JSON.stringify({ data: { notes: [{ text: 'x'.repeat(7 * 1024 * 1024) }] } }));
  const hm = (await huge.json().catch(() => ({ error: { message: '' } }))).error.message;
  assert.equal(huge.status, 413); assert.match(hm, /too large/); assert.doesNotMatch(hm, /undefined/);
  const r = await post(a, '/api/import/preview', { data: { reminders: [{ text: 'Old', due_at: NOW - 86400e3, status: 'pending' }, { text: 'Future', due_at: NOW + 86400e3, status: 'pending' }, { text: 'Done one', due_at: NOW + 86400e3, status: 'done' }], memories: [{ text: 'My password is hunter2hunter2', kind: 'fact' }, { text: 'I prefer tea', kind: 'preference' }] } });
  assert.equal(r.status, 200); assert.equal(r.json.sections.find(x => x.key === 'reminders').add, 1); assert.match(r.json.notes.join(' '), /in the past or already finished/); assert.match(r.json.notes.join(' '), /looks like a password or secret/);
  const ap = await post(a, '/api/import/apply', { importId: r.json.importId, approve: true });
  assert.equal(ap.json.imported.memories, 1); assert.equal(s.app.db.prepare("SELECT COUNT(*) n FROM memories WHERE text LIKE '%hunter2%'").get().n, 0);
});

test('the readable Markdown export lists tasks, notes, memories and commitments with their receipts, and only your own', async () => {
  const { s, a, b } = await setup(); fill(s, 1); s.app.db.prepare("INSERT INTO tasks (user_id, title, created_at) VALUES (2, 'Mallory secret task', 1)").run();
  const r = await a.raw('GET', '/api/export?format=md'); const md = await r.text();
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /markdown/); assert.match(r.headers.get('content-disposition'), /nova-export\.md/);
  for (const t of ['# NOVA export for', '## Tasks (2)', '- [ ] Pay the electricity bill (due 2026-10-25)', '- [x] مراجعة طلب التأشيرة 🚀', '## Notes (1)', 'Visa photos need a white background', '## Memories (1)', 'I like short answers', '## Commitments and proof receipts (2)', 'Proof receipt: Send the proposal', '### What this receipt proves', 'Lab quote'])
    assert.ok(md.includes(t), 'contains: ' + t);
  assert.doesNotMatch(md, /Mallory secret task/); assert.doesNotMatch(md, /undefined|\[object/);
  const bad = await a.get('/api/export?format=pdf'); assert.equal(bad.status, 400); assert.match(bad.json.error.message, /JSON or Markdown/);
  assert.equal((await s.client().get('/api/export?format=md')).status, 401);
});

// Privacy dashboard (server): honest counts of what NOVA stores, connected accounts and what each may do, what is encrypted, what NOVA never does,
// and deleting ONE kind of data with a preview, a typed word and an approval. Nothing of anyone else is counted or deleted.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);

const at = iso => Date.parse(iso + '+04:00'), clock = { t: at('2026-10-21T09:00:00') };
async function setup(env) { const s = await boot(Object.assign({ NOVA_RATE_API_MAX: '100000' }, env || {}), { now: () => clock.t }); const a = s.client(), b = s.client(); await a.login('roshan@example.com'); await b.login('mallory@example.com'); clock.t = at('2026-10-21T09:00:00'); return { s, a, b }; }
const T = at('2026-10-20T10:00:00');
function seed(db, uid, k) {
  for (let i = 0; i < 3 * k; i++) db.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (?, ?, 'open', ?)").run(uid, 'T' + i, T);
  db.prepare("INSERT INTO tasks (user_id, title, status, created_at, deleted_at) VALUES (?, 'gone', 'open', ?, ?)").run(uid, T, T);       // already removed: not counted
  for (let i = 0; i < 2 * k; i++) db.prepare('INSERT INTO notes (user_id, text, created_at) VALUES (?, ?, ?)').run(uid, 'N' + i, T);
  for (let i = 0; i < k; i++) db.prepare("INSERT INTO memories (user_id, kind, text, source, created_at, updated_at) VALUES (?, 'fact', ?, 'test', ?, ?)").run(uid, 'M' + i, T, T);
  db.prepare("INSERT INTO reminders (user_id, text, due_at, repeat, status, created_at) VALUES (?, 'r', ?, 'none', 'pending', ?)").run(uid, T, T);
  const h = Number(db.prepare("INSERT INTO habits (user_id, name, schedule, created_at) VALUES (?, 'Read', 'daily', ?)").run(uid, T).lastInsertRowid); for (let i = 0; i < 4; i++) db.prepare('INSERT INTO habit_checks (habit_id, user_id, day, created_at) VALUES (?, ?, ?, ?)').run(h, uid, '2026-10-1' + i, T);
  for (let i = 0; i < 5; i++) db.prepare('INSERT INTO expenses (user_id, amount_fils, category, day, created_at) VALUES (?, 100, ?, ?, ?)').run(uid, 'food', '2026-10-20', T); db.prepare("INSERT OR REPLACE INTO budgets (user_id, category, monthly_fils) VALUES (?, 'total', 300000)").run(uid);
  db.prepare("INSERT INTO focus_sessions (user_id, title, planned_min, started_at, status) VALUES (?, 'Focus', 25, ?, 'completed')").run(uid, T);
  db.prepare("INSERT INTO energy_marks (user_id, day, slot, level, updated_at) VALUES (?, '2026-10-20', 'morning', 'high', 1)").run(uid); db.prepare('UPDATE users SET energy_plan = 1 WHERE id = ?').run(uid);
  db.prepare("INSERT INTO decisions (user_id, title, expected, review_on, created_at) VALUES (?, 'D', 'x', '2026-11-01', ?)").run(uid, T);
  const d = Number(db.prepare("INSERT INTO documents (user_id, title, kind, chars, chunks, created_at, updated_at) VALUES (?, 'Doc', 'note', 10, 2, ?, ?)").run(uid, T, T).lastInsertRowid);
  for (let i = 0; i < 2; i++) { const c = Number(db.prepare('INSERT INTO chunks (document_id, user_id, seq, text) VALUES (?, ?, ?, ?)').run(d, uid, i, 'passage ' + i + ' zebra' + uid).lastInsertRowid); db.prepare('INSERT INTO chunks_fts (rowid, text, heading) VALUES (?, ?, ?)').run(c, 'passage zebra' + uid, ''); }
  const e = Number(db.prepare("INSERT INTO emails (user_id, provider_id, from_name, from_addr, subject, snippet, received_at, labels, unsubscribe, priority, category, reasons, is_demo, created_at) VALUES (?, ?, 'A', 'a@x.example', 'S', 'snip', ?, '[]', 0, 'normal', 'other', '[]', 0, ?)").run(uid, 'm' + uid, T, T).lastInsertRowid);
  db.prepare("INSERT INTO emails (user_id, provider_id, from_name, from_addr, subject, snippet, received_at, labels, unsubscribe, priority, category, reasons, is_demo, created_at) VALUES (?, 'demo1', 'D', 'd@x.example', 'Demo', 's', ?, '[]', 0, 'normal', 'other', '[]', 1, ?)").run(uid, T, T);
  db.prepare("INSERT INTO email_drafts (user_id, email_id, body, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?)").run(uid, e, T, T);
  const cv = Number(db.prepare('INSERT INTO conversations (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(uid, 'Chat', T, T).lastInsertRowid); for (let i = 0; i < 6; i++) db.prepare("INSERT INTO messages (conversation_id, user_id, role, content, created_at) VALUES (?, ?, 'user', 'hi', ?)").run(cv, uid, T);
  db.prepare("INSERT INTO notifications (user_id, kind, title, body, created_at) VALUES (?, 'x', 't', 'b', ?)").run(uid, T);
  db.prepare("INSERT INTO commitments (user_id, title, direction, source_type, status, created_at, updated_at) VALUES (?, 'P', 'i_owe', 'manual', 'task_prepared', ?, ?)").run(uid, T, T);
}
const view = c => c.get('/api/privacy').then(r => r.json), cnt = (v, id) => v.counts.find(x => x.id === id);

test('honest counts of what is stored, per kind, for you only', async () => {
  const { s, a, b } = await setup(); seed(s.app.db, 1, 2); seed(s.app.db, 2, 7); const v = await view(a);
  assert.deepEqual(v.counts.map(c => [c.id, c.count]), [['tasks', 6], ['notes', 4], ['memories', 2], ['reminders', 1], ['habits', 1], ['expenses', 5], ['focus', 1], ['energy', 1], ['decisions', 1], ['documents', 1], ['emails', 1], ['chats', 1], ['notifications', 1]], 'a removed task and the demo e-mail are not counted');
  assert.deepEqual([cnt(v, 'habits').extra, cnt(v, 'habits').extraLabel, cnt(v, 'documents').extra, cnt(v, 'chats').extra, cnt(v, 'emails').extra], [4, 'check-ins', 2, 6, 1]);
  assert.equal(v.signedInAs, 'roshan@example.com'); assert.equal(cnt(await view(b), 'tasks').count, 21); assert.equal(cnt(await view(a), 'tasks').count, 6);
  assert.equal((await s.client().get('/api/privacy')).status, 401);
});

test('accounts and what each may do; what is encrypted; what NOVA never does', async () => {
  const { s, a } = await setup({ NOVA_SECRET_KEY: 'a-long-random-test-key-0123456789' }); let v = await view(a); assert.deepEqual(v.accounts, []);
  s.app.db.prepare("INSERT INTO connections (user_id, provider, account, scope, token_enc, status, last_sync_at, created_at, updated_at) VALUES (1, 'gmail', 'me@gmail.example', 'https://www.googleapis.com/auth/gmail.readonly', 'ENCRYPTED', 'connected', ?, ?, ?)").run(at('2026-10-20T08:00:00'), T, T);
  v = await view(a); const g = v.accounts[0]; assert.deepEqual([g.provider, g.account, g.readOnly, g.tokensEncrypted, g.lastRead], ['Gmail', 'me@gmail.example', true, true, at('2026-10-20T08:00:00')]); assert.match(g.permission, /^Read only: can read headers and a short preview\. Cannot send, delete or change anything\./); assert.match(g.manage, /myaccount\.google\.com\/permissions/);
  assert.ok(!JSON.stringify(v).includes('ENCRYPTED'), 'the stored token never leaves the server');
  s.app.db.prepare("UPDATE connections SET scope = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'").run(); const wide = (await view(a)).accounts[0]; assert.equal(wide.readOnly, false); assert.match(wide.permission, /broader than read only/);
  assert.equal(v.encrypted[0].ok, true); assert.match(v.encrypted[0].how, /Encrypted with your NOVA_SECRET_KEY/); assert.match(v.notEncrypted.join(' '), /database file/);
  assert.ok(v.never.length >= 5 && v.never.every(x => /^NOVA never /.test(x))); assert.match(v.never[0], /never sends e-mail/); assert.equal(v.ai.provider, 'local'); assert.match(v.ai.note, /built-in rules/);
  const none = await setup(); const nv = await view(none.a); assert.equal(nv.encrypted[0].ok, false); assert.match(nv.encrypted[0].how, /NOVA_SECRET_KEY is not set/);
});

test('delete one kind: preview with the exact count and what stays, typed word and approval, then re-checked; only your own rows go', async () => {
  const { s, a, b } = await setup(); seed(s.app.db, 1, 2); seed(s.app.db, 2, 3); const db = s.app.db;
  const pv = await a.post('/api/privacy/delete/preview', { kind: 'tasks' }); assert.equal(pv.status, 200); const p = pv.json;
  assert.deepEqual([p.count, p.label, p.undoable, p.confirmWord], [6, 'Tasks', false, 'DELETE']); assert.equal(p.changes[0], 'Delete 6 tasks from your NOVA account.'); assert.match(p.warning, /^This cannot be undone/); assert.ok(p.notTouched.includes('Everything else you have stays as it is.'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE user_id = 1').get().n, 7, 'a preview deletes nothing');
  let r = await a.post('/api/privacy/delete/apply', { token: p.token }); assert.equal(r.status, 400); assert.match(r.json.error.message, /^Press Approve to delete\. Nothing was deleted\./);
  r = await a.post('/api/privacy/delete/apply', { token: p.token, approve: true, confirm: 'delete' }); assert.equal(r.status, 400); assert.match(r.json.error.message, /^Type DELETE to confirm\. Nothing was deleted\./); assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE user_id = 1').get().n, 7);
  r = await b.post('/api/privacy/delete/apply', { token: p.token, approve: true, confirm: 'DELETE' }); assert.equal(r.status, 404, 'a preview belongs to the person who made it'); assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE user_id = 2').get().n, 10);
  r = await a.post('/api/privacy/delete/apply', { token: p.token, approve: true, confirm: 'DELETE' }); assert.equal(r.status, 200); assert.deepEqual([r.json.removed, r.json.remaining], [6, 0]); assert.equal(r.json.message, 'Deleted 6 tasks. Checked afterwards: 0 left.');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE user_id = 1').get().n, 0); assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE user_id = 2').get().n, 10, 'the other person is untouched'); assert.equal(db.prepare('SELECT COUNT(*) n FROM notes WHERE user_id = 1').get().n, 4, 'other kinds are untouched');
  assert.equal((await a.post('/api/privacy/delete/apply', { token: p.token, approve: true, confirm: 'DELETE' })).status, 404, 'a preview works once');
  assert.match(db.prepare("SELECT detail FROM audit_log WHERE action = 'data_deleted' ORDER BY id DESC").get().detail, /^tasks \(6 removed\)/);
  const none = await a.post('/api/privacy/delete/preview', { kind: 'tasks' }); assert.equal(none.status, 409); assert.match(none.json.error.message, /^There is nothing to delete here/);
  assert.equal((await a.post('/api/privacy/delete/preview', { kind: 'everything' })).status, 400); assert.equal((await a.post('/api/privacy/delete/preview', {})).status, 400);
  clock.t = at('2026-10-21T09:00:00'); const old = (await a.post('/api/privacy/delete/preview', { kind: 'notes' })).json; clock.t += 11 * 60e3; const exp = await a.post('/api/privacy/delete/apply', { token: old.token, approve: true, confirm: 'DELETE' }); assert.equal(exp.status, 404); assert.match(exp.json.error.message, /has expired/);
});

test('every kind deletes completely, keeps what it says it keeps, and leaves the other person alone', async () => {
  const { s, a } = await setup(); seed(s.app.db, 1, 2); seed(s.app.db, 2, 3); const db = s.app.db;
  for (const id of ['tasks', 'notes', 'memories', 'reminders', 'habits', 'expenses', 'focus', 'energy', 'decisions', 'documents', 'emails', 'chats', 'notifications']) {
    const p = (await a.post('/api/privacy/delete/preview', { kind: id })).json; const r = await a.post('/api/privacy/delete/apply', { token: p.token, approve: true, confirm: 'DELETE' }); assert.equal(r.status, 200, id + ' ' + JSON.stringify(r.json)); assert.equal(r.json.remaining, 0, id);
  }
  const n = (t, u) => db.prepare('SELECT COUNT(*) n FROM ' + t + ' WHERE user_id = ' + u).get().n;
  for (const t of ['habit_checks', 'habits', 'chunks', 'documents', 'messages', 'conversations', 'email_drafts', 'focus_sessions', 'day_plans']) assert.equal(n(t, 1), 0, t);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM emails WHERE user_id = 1').get().n, 1, 'the demo e-mail is not a copy of your mail, so it stays'); assert.equal(n('budgets', 1), 1, 'the budget setting is kept'); assert.equal(n('commitments', 1), 1, 'ProofLoop is kept'); assert.equal(db.prepare('SELECT energy_plan FROM users WHERE id = 1').get().energy_plan, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM chunks_fts WHERE chunks_fts MATCH 'zebra1'").get().n, 0, 'the search index of your documents is cleaned'); assert.equal(db.prepare("SELECT COUNT(*) n FROM chunks_fts WHERE chunks_fts MATCH 'zebra2'").get().n, 2, 'and the other person\'s is not');
  for (const t of ['tasks', 'notes', 'memories', 'reminders', 'habits', 'habit_checks', 'expenses', 'focus_sessions', 'energy_marks', 'decisions', 'documents', 'chunks', 'conversations', 'messages', 'notifications', 'commitments']) assert.ok(n(t, 2) > 0, 'the other person still has ' + t);
  assert.equal(db.prepare('SELECT energy_plan FROM users WHERE id = 2').get().energy_plan, 1);
});

test('cancel: the preview is dropped and nothing is deleted', async () => {
  const { s, a } = await setup(); seed(s.app.db, 1, 2); const p = (await a.post('/api/privacy/delete/preview', { kind: 'notes' })).json;
  assert.equal((await a.post('/api/privacy/delete/cancel', { token: p.token })).status, 200); const r = await a.post('/api/privacy/delete/apply', { token: p.token, approve: true, confirm: 'DELETE' }); assert.equal(r.status, 404); assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM notes WHERE user_id = 1').get().n, 4);
});

test('reading the dashboard changes nothing', async () => {
  const { s, a } = await setup(); seed(s.app.db, 1, 2); const snap = () => JSON.stringify(['tasks', 'notes', 'memories', 'audit_log', 'notifications'].map(t => s.app.db.prepare('SELECT COUNT(*) n FROM ' + t).get().n)), before = snap(); await view(a); await view(a); assert.equal(snap(), before);
  assert.equal((await a.raw('POST', '/api/privacy/delete/preview', { kind: 'tasks' }, { 'x-nova-csrf': 'bad' })).status, 403);
});

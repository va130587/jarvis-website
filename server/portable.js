// Your data is yours: a readable Markdown export, and a safe way to bring a NOVA export back.
// Import is always two steps. 1) PREVIEW: the file is checked strictly and counted (new items, items you already have, items refused);
// nothing is written. 2) APPLY: only after you press Approve, in one all-or-nothing transaction, into YOUR account only.
// What is never imported: sessions, tokens, secrets, e-mail, notifications, other people's ids or accounts, proof evidence.
'use strict';
const crypto = require('crypto');
const { HttpError } = require('./http');
const { audit } = require('./security');
const { STATES } = require('./proofloop/machine');

const MAX_BYTES = 6 * 1024 * 1024, MAX_ITEMS = 5000, TTL = 15 * 60e3, MAX_PENDING = 3;
const KNOWN = ['tasks', 'notes', 'memories', 'commitments', 'reminders', 'habits', 'expenses', 'documents'];
const IGNORED = { user: 'account details', conversations: 'chat history', schedules: 'job times', notifications: 'notifications', briefings: 'briefings', email: 'e-mail', focusSessions: 'focus history' };
const META = ['format', 'version', 'exportedAt'];
const LABEL = { tasks: 'Tasks', notes: 'Notes', memories: 'Memories', commitments: 'ProofLoop commitments', reminders: 'Reminders', habits: 'Habits', expenses: 'Expenses', documents: 'Documents' };
const MEM_KINDS = ['preference', 'goal', 'project', 'contact', 'priority', 'app', 'recurring', 'fact'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);
const low = s => String(s).trim().replace(/\s+/g, ' ').toLowerCase();

// A commitment's proof is not part of an export, so a "verified" or "submitted" status cannot be trusted: it comes back as "awaiting confirmation".
const SAFE_STATUS = { completed: 'completed', cancelled: 'cancelled', failed: 'failed', awaiting_confirmation: 'awaiting_confirmation', verified: 'awaiting_confirmation', submitted: 'awaiting_confirmation', task_prepared: 'task_prepared' };

function refuse(msg) { throw new HttpError(400, msg, 'invalid_import'); }
function createPortable(cfg, db, { now, memory, kb, plApi }) {
  const pending = new Map();
  const sweep = () => { for (const [k, v] of pending) if (v.at + TTL < now()) pending.delete(k); };

  const isStr = (v, max, min) => typeof v === 'string' && v.trim().length >= (min === undefined ? 1 : min) && v.length <= max && !/\u0000/.test(v);
  const optStr = (v, max) => v === undefined || v === null || v === '' || (typeof v === 'string' && v.length <= max && !/\u0000/.test(v));
  const isDate = v => typeof v === 'string' && DATE.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
  const optDate = v => v === undefined || v === null || v === '' || isDate(v);
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const optInt = (v, lo, hi) => v === undefined || v === null || int(v, lo, hi);
  const dateOrNull = v => (v === undefined || v === null || v === '') ? null : v;

  // each reader returns a clean item plus its duplicate key, or null when this one item is not acceptable (it is counted as refused)
  const READ = {
    tasks: x => (isStr(x.title, 300) && optDate(x.due) && (x.status === undefined || x.status === 'open' || x.status === 'done') && optInt(x.created_at, 0, 4e12) && optInt(x.completed_at, 0, 4e12))
      ? { key: low(x.title) + '|' + (dateOrNull(x.due) || ''), v: { title: x.title.trim(), due: dateOrNull(x.due), status: x.status === 'done' ? 'done' : 'open', created: x.created_at || null, completed: x.completed_at || null } } : null,
    notes: x => isStr(x.text, 20000) && optInt(x.created_at, 0, 4e12) ? { key: low(x.text), v: { text: x.text.trim(), created: x.created_at || null } } : null,
    memories: x => (isStr(x.text, 2000) && (x.kind === undefined || MEM_KINDS.includes(x.kind)) && (x.status === undefined || x.status === 'active'))
      ? { key: low(x.text), v: { text: x.text.trim(), kind: x.kind || 'fact' } } : null,
    commitments: x => (isStr(x.title, 300) && ['i_owe', 'owed_to_me'].includes(x.direction) && optStr(x.counterparty, 200) && optDate(x.deadline) && STATES.includes(x.status) && !x.is_demo)
      ? { key: low(x.title) + '|' + x.direction + '|' + (dateOrNull(x.deadline) || ''), v: { title: x.title.trim(), direction: x.direction, counterparty: x.counterparty || null, deadline: dateOrNull(x.deadline), status: SAFE_STATUS[x.status] || 'task_prepared', downgraded: (SAFE_STATUS[x.status] || 'task_prepared') !== x.status, action: optStr(x.action, 300) ? (x.action || null) : null } } : null,
    reminders: x => (isStr(x.text, 500) && int(x.due_at, 0, 4e12) && (x.repeat === undefined || ['none', 'daily', 'weekdays'].includes(x.repeat)) && (x.status === undefined || typeof x.status === 'string'))
      ? { key: low(x.text) + '|' + x.due_at, v: { text: x.text.trim(), dueAt: x.due_at, repeat: x.repeat || 'none', status: x.status || 'pending' } } : null,
    habits: x => (isStr(x.name, 100) && (x.schedule === undefined || ['daily', 'weekdays'].includes(x.schedule)) && (x.checks === undefined || (Array.isArray(x.checks) && x.checks.length <= 4000 && x.checks.every(isDate))))
      ? { key: low(x.name), v: { name: x.name.trim(), schedule: x.schedule || 'daily', checks: [...new Set(x.checks || [])] } } : null,
    expenses: x => (int(x.amount_fils, 1, 1e10) && isStr(x.category, 50) && optStr(x.note, 200) && isDate(x.day))
      ? { key: x.amount_fils + '|' + low(x.category) + '|' + x.day + '|' + low(x.note || ''), v: { fils: x.amount_fils, category: x.category.trim(), note: x.note || null, day: x.day } } : null,
    documents: x => (isStr(x.title, 200) && (x.kind === undefined || (typeof x.kind === 'string' && x.kind.length <= 20)) && isStr(x.text, 200000))
      ? { key: low(x.title) + '|' + hash(x.text), v: { title: x.title.trim(), text: x.text } } : null
  };

  // what the signed-in person already has, as the same duplicate keys
  const HAVE = {
    tasks: uid => db.prepare('SELECT title, due FROM tasks WHERE user_id = ? AND deleted_at IS NULL').all(uid).map(r => low(r.title) + '|' + (r.due || '')),
    notes: uid => db.prepare('SELECT text FROM notes WHERE user_id = ? AND deleted_at IS NULL').all(uid).map(r => low(r.text)),
    memories: uid => db.prepare("SELECT text FROM memories WHERE user_id = ? AND status != 'deleted'").all(uid).map(r => low(r.text)),
    commitments: uid => db.prepare('SELECT title, direction, deadline FROM commitments WHERE user_id = ?').all(uid).map(r => low(r.title) + '|' + r.direction + '|' + (r.deadline || '')),
    reminders: uid => db.prepare('SELECT text, due_at FROM reminders WHERE user_id = ?').all(uid).map(r => low(r.text) + '|' + r.due_at),
    habits: uid => db.prepare('SELECT name FROM habits WHERE user_id = ? AND archived = 0').all(uid).map(r => low(r.name)),
    expenses: uid => db.prepare('SELECT amount_fils, category, note, day FROM expenses WHERE user_id = ? AND deleted_at IS NULL').all(uid).map(r => r.amount_fils + '|' + low(r.category) + '|' + r.day + '|' + low(r.note || '')),
    documents: uid => db.prepare('SELECT d.title, (SELECT group_concat(text, char(10) || char(10)) FROM (SELECT text FROM chunks WHERE document_id = d.id ORDER BY seq)) t FROM documents d WHERE d.user_id = ? AND d.is_demo = 0').all(uid).map(r => low(r.title) + '|' + hash(r.t || ''))
  };

  function check(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) refuse('This is not a NOVA export. Choose the file you downloaded from "Download everything (JSON)".');
    if (data.format !== undefined && data.format !== 'nova-export') refuse('This is not a NOVA export. Choose the file you downloaded from "Download everything (JSON)".');
    if (data.version !== undefined && data.version !== 1) refuse('This export is from a newer NOVA than this one. Update NOVA first, then try again.');
    const unknown = Object.keys(data).filter(k => !KNOWN.includes(k) && !META.includes(k) && !IGNORED[k]);
    if (unknown.length) refuse('This file has parts NOVA does not recognise (' + unknown.slice(0, 3).map(k => '"' + String(k).slice(0, 30) + '"').join(', ') + '), so it was not imported. Only files downloaded from NOVA can be imported.');
    if (!KNOWN.some(k => data[k] !== undefined)) refuse('This export has nothing NOVA can import.');
    for (const k of KNOWN) if (data[k] !== undefined && !Array.isArray(data[k])) refuse('The "' + LABEL[k].toLowerCase() + '" part of this file is damaged, so nothing was imported.');
    let total = 0; for (const k of KNOWN) total += (data[k] || []).length;
    if (total > MAX_ITEMS) refuse('This file has more than ' + MAX_ITEMS + ' items, which is more than NOVA imports at once.');
  }

  function preview(uid, email, data) {
    check(data);
    const sections = [], items = {}, notes = [];
    for (const k of KNOWN) {
      const arr = data[k] || [], have = new Set(HAVE[k](uid)), seen = new Set(), fresh = [];
      let dup = 0, bad = 0;
      for (const x of arr) {
        const r = x && typeof x === 'object' && !Array.isArray(x) ? READ[k](x) : null;
        if (!r) { bad++; continue; }
        if (have.has(r.key) || seen.has(r.key)) { dup++; continue; }
        seen.add(r.key); fresh.push(r);
      }
      if (k === 'reminders') { const before = fresh.length; items[k] = fresh.filter(r => r.v.status === 'pending' && r.v.dueAt > now()); const past = before - items[k].length; if (past) { bad += past; notes.push(past + (past === 1 ? ' reminder is' : ' reminders are') + ' in the past or already finished, so they are left out.'); } }
      else items[k] = fresh;
      sections.push({ key: k, label: LABEL[k], found: arr.length, add: items[k].length, have: dup, refused: bad });
    }
    const down = (items.commitments || []).filter(c => c.v.downgraded).length;
    if (down) notes.push(down + (down === 1 ? ' commitment was' : ' commitments were') + ' marked verified or in progress in the other NOVA. Proof is not imported, so they come in as "Awaiting confirmation" or "Task prepared".');
    const memBlocked = (items.memories || []).filter(m => memory.classify(m.v.text).blocked).length;
    if (memBlocked) notes.push(memBlocked + (memBlocked === 1 ? ' memory looks' : ' memories look') + ' like a password or secret, so NOVA will not store ' + (memBlocked === 1 ? 'it' : 'them') + '.');
    const ignored = Object.keys(IGNORED).filter(k => data[k] !== undefined).map(k => IGNORED[k]);
    const from = data.user && typeof data.user.email === 'string' ? data.user.email.slice(0, 120) : null;
    const different = !!from && from.toLowerCase() !== String(email).toLowerCase();
    if (different) notes.push('This file was made by a different account (' + from + '). Everything you approve will be added to YOUR account only; their account is not touched.');
    sweep();
    for (const [k, v] of pending) if (v.uid === uid && pending.size >= MAX_PENDING) pending.delete(k);
    const id = crypto.randomBytes(12).toString('hex');
    pending.set(id, { uid, items, at: now() });
    const add = sections.reduce((n, s) => n + s.add, 0);
    return { importId: id, sections, totalNew: add, ignored, notes, fromOtherAccount: different, expiresInMinutes: Math.round(TTL / 60e3) };
  }

  function apply(uid, ip, id) {
    sweep();
    const p = pending.get(String(id));
    if (!p || p.uid !== uid) throw new HttpError(404, 'That import preview has expired. Choose the file again to start over. Nothing was changed.', 'not_found');
    const t = now(), done = {}, skipped = {};
    db.exec('BEGIN');
    try {
      for (const r of p.items.tasks) db.prepare('INSERT INTO tasks (user_id, title, due, status, source, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid, r.v.title, r.v.due, r.v.status, 'import', r.v.created || t, r.v.status === 'done' ? (r.v.completed || t) : null);
      for (const r of p.items.notes) db.prepare('INSERT INTO notes (user_id, text, created_at) VALUES (?, ?, ?)').run(uid, r.v.text, r.v.created || t);
      skipped.memories = 0;
      for (const r of p.items.memories) { try { memory.add(uid, { text: r.v.text, kind: r.v.kind, source: 'import', status: 'active', confirmSensitive: true }); } catch (e) { if (e instanceof HttpError) skipped.memories++; else throw e; } }
      for (const r of p.items.commitments) {
        const c = Number(db.prepare('INSERT INTO commitments (user_id, title, action, direction, counterparty, deadline, source_type, status, is_demo, created_at, updated_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)')
          .run(uid, r.v.title, r.v.action, r.v.direction, r.v.counterparty, r.v.deadline, 'import', r.v.status, t, t, ['completed', 'cancelled', 'failed'].includes(r.v.status) ? t : null).lastInsertRowid);
        db.prepare('INSERT INTO commitment_events (commitment_id, user_id, seq, from_status, to_status, note, actor, ts) VALUES (?, ?, 1, NULL, ?, ?, ?, ?)').run(c, uid, r.v.status, 'Imported from a NOVA export. Earlier history and proof are not imported.', 'you', t);
      }
      for (const r of p.items.reminders) db.prepare("INSERT INTO reminders (user_id, text, due_at, repeat, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)").run(uid, r.v.text, r.v.dueAt, r.v.repeat, t);
      for (const r of p.items.habits) {
        const h = Number(db.prepare('INSERT INTO habits (user_id, name, schedule, archived, created_at) VALUES (?, ?, ?, 0, ?)').run(uid, r.v.name, r.v.schedule, t).lastInsertRowid);
        for (const d of r.v.checks) db.prepare('INSERT OR IGNORE INTO habit_checks (habit_id, user_id, day, created_at) VALUES (?, ?, ?, ?)').run(h, uid, d, t);
      }
      for (const r of p.items.expenses) db.prepare('INSERT INTO expenses (user_id, amount_fils, category, note, day, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, r.v.fils, r.v.category, r.v.note, r.v.day, t);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    for (const r of p.items.documents) { try { kb.add(uid, { title: r.v.title, kind: 'note', source: 'import', text: r.v.text }); } catch (e) { if (e instanceof HttpError) skipped.documents = (skipped.documents || 0) + 1; else throw e; } }
    for (const k of KNOWN) done[k] = p.items[k].length - (skipped[k] || 0);
    pending.delete(String(id));
    audit(db, now, uid, 'import_applied', KNOWN.map(k => k + ' ' + done[k]).join(', '), ip);
    return { ok: true, imported: done, total: Object.values(done).reduce((a, b) => a + b, 0) };
  }

  // ---- the readable export ----
  const day = ms => new Date(ms + 4 * 3600e3).toISOString().slice(0, 10);
  const oneLine = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  function markdown(user) {
    const uid = user.id, L = [];
    L.push('# NOVA export for ' + user.display_name, '', 'Made on ' + day(now()) + ' (Dubai). This file is for reading. To move your data into another NOVA, use "Download everything (JSON)" instead.', '');
    const tasks = db.prepare('SELECT title, due, status FROM tasks WHERE user_id = ? AND deleted_at IS NULL ORDER BY status = \'done\', due IS NULL, due, id').all(uid);
    L.push('## Tasks (' + tasks.length + ')', '', ...(tasks.length ? tasks.map(t => '- [' + (t.status === 'done' ? 'x' : ' ') + '] ' + oneLine(t.title) + (t.due ? ' (due ' + t.due + ')' : '')) : ['Nothing here.']), '');
    const notes = db.prepare('SELECT text, created_at FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY id').all(uid);
    L.push('## Notes (' + notes.length + ')', '', ...(notes.length ? notes.map(n => '- ' + day(n.created_at) + ': ' + oneLine(n.text)) : ['Nothing here.']), '');
    const mem = db.prepare("SELECT kind, text FROM memories WHERE user_id = ? AND status = 'active' ORDER BY id").all(uid);
    L.push('## Memories (' + mem.length + ')', '', ...(mem.length ? mem.map(m => '- **' + m.kind + ':** ' + oneLine(m.text)) : ['Nothing here.']), '');
    const com = db.prepare('SELECT id FROM commitments WHERE user_id = ? ORDER BY id').all(uid);
    L.push('## Commitments and proof receipts (' + com.length + ')', '');
    if (!com.length) L.push('Nothing here.', '');
    for (const c of com) { const d = plApi.detail(uid, c.id); L.push(plApi.receiptMd(d, user).split('\n').map(l => /^#{1,3} /.test(l) ? '##' + l : l).join('\n'), ''); }
    return L.join('\n');
  }

  function register(router) {
    router.post('/api/import/preview', { maxBody: MAX_BYTES + 4096 }, ctx => {
      const data = ctx.body.data;
      if (data === undefined) refuse('Choose a NOVA export file to import.');
      return { status: 200, body: preview(ctx.auth.user.id, ctx.auth.user.email, data) };
    });
    router.post('/api/import/apply', ctx => {
      if (ctx.body.approve !== true) throw new HttpError(400, 'Press Approve to import. Nothing was changed.', 'approval_required');
      return { status: 200, body: apply(ctx.auth.user.id, ctx.req.socket.remoteAddress, ctx.body.importId) };
    });
    router.post('/api/import/cancel', ctx => { pending.delete(String(ctx.body.importId)); return { status: 200, body: { ok: true } }; });
  }
  return { register, markdown, preview, apply, MAX_BYTES };
}
module.exports = { createPortable };

// "What does NOVA know about me?": real counts of what is stored per kind, the accounts you connected and what each may do, what is encrypted, and
// what NOVA never does. You can export everything and delete ONE kind of data: that always shows a preview (exact count, what is not touched),
// asks you to type DELETE, and runs only after you approve. Deleting cannot be undone, and the preview says so. Only your own data.
'use strict';
const crypto = require('crypto');
const { HttpError } = require('./http');
const { audit } = require('./security');

const TTL = 10 * 60e3, MAX_PENDING = 5;
// id -> label, how to count, and how to delete (every delete is limited to this person's rows)
const KINDS = {
  tasks: { label: 'Tasks', count: 'SELECT COUNT(*) n FROM tasks WHERE user_id = ? AND deleted_at IS NULL', del: ['DELETE FROM tasks WHERE user_id = ?'], note: 'Open and finished tasks.' },
  notes: { label: 'Notes', count: 'SELECT COUNT(*) n FROM notes WHERE user_id = ? AND deleted_at IS NULL', del: ['DELETE FROM notes WHERE user_id = ?'] },
  memories: { label: 'Memories', count: "SELECT COUNT(*) n FROM memories WHERE user_id = ? AND status = 'active'", del: ['DELETE FROM memories WHERE user_id = ?'], note: 'What NOVA remembers about you (Memory Vault).' },
  reminders: { label: 'Reminders', count: 'SELECT COUNT(*) n FROM reminders WHERE user_id = ?', del: ['DELETE FROM reminders WHERE user_id = ?'] },
  habits: { label: 'Habits and check-ins', count: 'SELECT COUNT(*) n FROM habits WHERE user_id = ?', extra: 'SELECT COUNT(*) n FROM habit_checks WHERE user_id = ?', extraLabel: 'check-ins', del: ['DELETE FROM habit_checks WHERE user_id = ?', 'DELETE FROM habits WHERE user_id = ?'] },
  expenses: { label: 'Expenses', count: 'SELECT COUNT(*) n FROM expenses WHERE user_id = ? AND deleted_at IS NULL', del: ['DELETE FROM expenses WHERE user_id = ?'], keeps: 'Your monthly budget setting is kept.' },
  focus: { label: 'Focus sessions and day plans', count: 'SELECT COUNT(*) n FROM focus_sessions WHERE user_id = ?', del: ['DELETE FROM focus_sessions WHERE user_id = ?', 'DELETE FROM day_plans WHERE user_id = ?'] },
  energy: { label: 'Energy marks', count: 'SELECT COUNT(*) n FROM energy_marks WHERE user_id = ?', del: ['DELETE FROM energy_marks WHERE user_id = ?', 'UPDATE users SET energy_plan = 0 WHERE id = ?'], changes: 'The planner switch for your energy is turned off.' },
  decisions: { label: 'Decision Journal entries', count: 'SELECT COUNT(*) n FROM decisions WHERE user_id = ? AND deleted_at IS NULL', del: ['DELETE FROM decisions WHERE user_id = ?'] },
  documents: { label: 'Knowledge Base documents', count: 'SELECT COUNT(*) n FROM documents WHERE user_id = ?', extra: 'SELECT COUNT(*) n FROM chunks WHERE user_id = ?', extraLabel: 'passages', del: ['DELETE FROM chunks WHERE user_id = ?', 'DELETE FROM documents WHERE user_id = ?', 'DELETE FROM chunks_fts WHERE rowid NOT IN (SELECT id FROM chunks)'] },
  emails: { label: 'E-mail copies', count: 'SELECT COUNT(*) n FROM emails WHERE user_id = ? AND is_demo = 0', extra: 'SELECT COUNT(*) n FROM email_drafts WHERE user_id = ?', extraLabel: 'drafts', del: ['DELETE FROM email_drafts WHERE user_id = ?', 'DELETE FROM emails WHERE user_id = ? AND is_demo = 0'], note: 'Only the copies kept in NOVA (sender, subject and a short preview).', keeps: 'Your real mailbox is never touched, and Gmail stays connected.' },
  chats: { label: 'Chat history', count: 'SELECT COUNT(*) n FROM conversations WHERE user_id = ?', extra: 'SELECT COUNT(*) n FROM messages WHERE user_id = ?', extraLabel: 'messages', del: ['DELETE FROM messages WHERE user_id = ?', 'DELETE FROM conversations WHERE user_id = ?'] },
  notifications: { label: 'Notifications', count: 'SELECT COUNT(*) n FROM notifications WHERE user_id = ?', del: ['DELETE FROM notifications WHERE user_id = ?'] }
};
// Kept on purpose, with the reason (so "delete" never silently leaves something behind)
const KEPT_ALWAYS = ['Your promises and their proof (ProofLoop): they are a proof record. Delete them only together with everything, in Security and Settings.', 'The activity log (what NOVA did and when): it is the record that protects you.', 'Your account and sign-in.'];
const NEVER = [
  'NOVA never sends e-mail. Gmail is connected read-only and cannot send, delete, label or archive anything.',
  'NOVA never uses a paid service on its own. The default needs no account and costs nothing.',
  'NOVA never changes your data without showing you a preview and waiting for your approval.',
  'NOVA never shows your data to another person who uses the same NOVA.',
  'NOVA never keeps full e-mail bodies, only the sender, subject and a short preview.'
];

function createPrivacy(cfg, db, { now }) {
  const pending = new Map(), sweep = () => { for (const [k, v] of pending) if (v.at + TTL < now()) pending.delete(k); };
  const n = (sql, uid) => db.prepare(sql).get(uid).n;
  function counts(uid) { return Object.keys(KINDS).map(id => { const k = KINDS[id], c = { id, label: k.label, count: n(k.count, uid), note: k.note || null }; if (k.extra) { c.extra = n(k.extra, uid); c.extraLabel = k.extraLabel; } return c; }); }
  function accounts(uid) {
    const rows = db.prepare('SELECT provider, account, scope, status, last_sync_at, created_at FROM connections WHERE user_id = ?').all(uid), keyOk = !!(cfg.secretKey && cfg.secretKey.length >= 16);
    const list = rows.map(r => ({ provider: r.provider === 'gmail' ? 'Gmail' : r.provider, account: r.account, status: r.status, since: r.created_at, lastRead: r.last_sync_at, permission: /gmail\.readonly/.test(r.scope || '') && !/gmail\.(send|modify|compose)|mail\.google\.com/.test(r.scope || '') ? 'Read only: can read headers and a short preview. Cannot send, delete or change anything.' : 'Check the permission in your Google account: it is broader than read only.', readOnly: /gmail\.readonly/.test(r.scope || '') && !/gmail\.(send|modify|compose)|mail\.google\.com/.test(r.scope || ''), tokensEncrypted: keyOk, manage: 'Remove NOVA at myaccount.google.com/permissions to cut access at Google as well.' }));
    return list;
  }
  function overview(user) {
    const uid = user.id, ai = cfg.ai.provider, keyOk = !!(cfg.secretKey && cfg.secretKey.length >= 16);
    return { counts: counts(uid), accounts: accounts(uid), encrypted: [{ what: 'Saved Gmail access (tokens)', how: keyOk ? 'Encrypted with your NOVA_SECRET_KEY before it is stored.' : 'Not stored at all: NOVA_SECRET_KEY is not set, so NOVA refuses to keep Gmail access.', ok: keyOk }],
      notEncrypted: ['Your tasks, notes, memories and the rest sit in NOVA\'s database file on the computer that runs NOVA. Protect that computer and its backups.', 'Calendar sign-ins (Google or Outlook) stay in your browser for the session and are never sent to NOVA\'s server.'],
      ai: { provider: ai, note: ai === 'claude' ? 'You switched on Claude, a paid service: what you type to NOVA is sent to it to be understood.' : ai === 'ollama' ? 'Your words are understood by an AI model running on this computer (Ollama). Nothing leaves it.' : 'NOVA understands you with built-in rules on this computer. No AI service is used.' },
      kept: KEPT_ALWAYS, never: NEVER, signedInAs: user.email, exports: [{ id: 'json', label: 'Download everything (JSON)' }, { id: 'md', label: 'Download a readable copy (Markdown)' }] };
  }
  function preview(user, kind) {
    const k = KINDS[kind]; if (!k) throw new HttpError(400, 'Choose which kind of data to delete.', 'invalid');
    const uid = user.id, c = n(k.count, uid), extra = k.extra ? n(k.extra, uid) : null;
    if (!c && !extra) throw new HttpError(409, 'There is nothing to delete here: you have no ' + k.label.toLowerCase() + '.', 'nothing_to_delete');
    sweep(); for (const [id, v] of pending) if (v.uid === uid && pending.size >= MAX_PENDING) pending.delete(id);
    const id = crypto.randomBytes(12).toString('hex'); pending.set(id, { uid, kind, at: now() });
    return { token: id, kind, label: k.label, count: c, extra, extraLabel: k.extraLabel || null, changes: ['Delete ' + c + ' ' + k.label.toLowerCase() + (extra ? ' and ' + extra + ' ' + k.extraLabel : '') + ' from your NOVA account.'].concat(k.changes ? [k.changes] : []), notTouched: (k.keeps ? [k.keeps] : []).concat(['Everything else you have stays as it is.']),
      kept: KEPT_ALWAYS.slice(0, 2), undoable: false, warning: 'This cannot be undone. Download your data first if you might want it back.', confirmWord: 'DELETE', expiresInMinutes: Math.round(TTL / 60e3) };
  }
  function apply(user, ip, body) {
    sweep(); const p = pending.get(String(body.token));
    if (!p || p.uid !== user.id) throw new HttpError(404, 'That delete preview has expired. Start again to see what would be deleted. Nothing was deleted.', 'not_found');
    if (body.approve !== true) throw new HttpError(400, 'Press Approve to delete. Nothing was deleted.', 'approval_required');
    if (body.confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm. Nothing was deleted.', 'confirm_required');
    pending.delete(String(body.token)); const k = KINDS[p.kind], before = n(k.count, user.id);
    db.exec('BEGIN');
    try { for (const sql of k.del) { const st = db.prepare(sql); if (sql.includes('?')) st.run(user.id); else st.run(); } db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    const after = n(k.count, user.id);
    audit(db, now, user.id, 'data_deleted', p.kind + ' (' + before + ' removed)', ip);
    return { ok: true, kind: p.kind, label: k.label, removed: before - after, remaining: after, message: 'Deleted ' + before + ' ' + k.label.toLowerCase() + '. Checked afterwards: ' + after + ' left.' };
  }
  function register(router) {
    router.get('/api/privacy', ctx => ({ status: 200, body: overview(ctx.auth.user) }));
    router.post('/api/privacy/delete/preview', ctx => ({ status: 200, body: preview(ctx.auth.user, ctx.body.kind) }));
    router.post('/api/privacy/delete/apply', ctx => ({ status: 200, body: apply(ctx.auth.user, ctx.req.socket.remoteAddress, ctx.body) }));
    router.post('/api/privacy/delete/cancel', ctx => { pending.delete(String(ctx.body.token)); return { status: 200, body: { ok: true } }; });
  }
  return { overview, register, KINDS };
}
module.exports = { createPrivacy };

// The Undo list: the last 20 changes NOVA made for you, each with what changed, when, and an Undo button where undoing is possible,
// or a plain reason where it is not. Undo is never one click: it shows a preview (what changes, and "what happens if" facts from your own data)
// and runs only after you approve. Only your own changes are ever listed or undone.
'use strict';
const crypto = require('crypto');
const { HttpError } = require('./http');

const LIMIT = 20, TTL = 10 * 60e3;
const parse = s => { try { return JSON.parse(s); } catch (e) { return {}; } };
const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// Why a change cannot be undone at all (the tool has no undo), in plain words
const NEVER = {
  'memory.delete': 'A deleted memory is gone for good, so it cannot be brought back. You can add it again in the Memory Vault.',
  'commitments.confirm': 'Confirming a promise is part of its proof record and is not reversed. You can cancel the commitment in ProofLoop.'
};
// What the original action did, if the saved preview is missing
const PLAIN = { 'tasks.create': 'Created a task', 'tasks.complete': 'Marked a task as done', 'tasks.delete': 'Deleted a task', 'notes.create': 'Saved a note', 'memory.add': 'Saved a memory', 'memory.delete': 'Deleted a memory',
  'commitments.create': 'Started tracking a commitment', 'commitments.confirm': 'Confirmed a commitment', 'reminders.create': 'Set a reminder', 'expenses.add': 'Recorded an expense', 'habits.check': 'Checked in a habit' };
// What undoing does, in a sentence
const WILL = { 'tasks.create': 'The task is removed.', 'tasks.complete': 'The task goes back to open.', 'tasks.delete': 'The task is restored.', 'notes.create': 'The note is removed.', 'memory.add': 'The memory is deleted.',
  'commitments.create': 'The commitment is cancelled.', 'reminders.create': 'The reminder is cancelled.', 'expenses.add': 'The expense is removed.', 'habits.check': 'The check-in is removed.' };

function createUndoList(cfg, db, { now, registry, agent, effects }) {
  const pending = new Map();
  const sweep = () => { for (const [k, v] of pending) if (v.at + TTL < now()) pending.delete(k); };

  // Is the thing still as the action left it? If not, undoing would do nothing useful, so it says why.
  function stillApplies(tool, o, uid) {
    const row = (t, id, extra) => db.prepare('SELECT * FROM ' + t + ' WHERE id = ? AND user_id = ?' + (extra || '')).get(id, uid);
    switch (tool) {
      case 'tasks.create': { const t = row('tasks', o.id); return !t || t.deleted_at ? 'That task is already gone.' : null; }
      case 'tasks.complete': { const t = row('tasks', o.id); return !t || t.deleted_at ? 'That task is gone now.' : t.status !== 'done' ? 'That task is not marked done any more.' : null; }
      case 'tasks.delete': { const t = row('tasks', o.id); return !t ? 'That task no longer exists.' : !t.deleted_at ? 'That task is already back.' : null; }
      case 'notes.create': { const n = row('notes', o.id); return !n || n.deleted_at ? 'That note is already gone.' : null; }
      case 'memory.add': return row('memories', o.id) ? null : 'That memory is already gone.';
      case 'commitments.create': { const c = row('commitments', o.id); return !c ? 'That commitment no longer exists.' : ['completed', 'failed', 'cancelled'].includes(c.status) ? 'That commitment is already closed.' : null; }
      case 'reminders.create': { const r = row('reminders', o.id); return !r ? 'That reminder no longer exists.' : r.status !== 'pending' ? 'That reminder has already gone off or been cancelled.' : null; }
      case 'expenses.add': { const e = row('expenses', o.id); return !e || e.deleted_at ? 'That expense is already removed.' : null; }
      case 'habits.check': return db.prepare('SELECT 1 FROM habit_checks WHERE habit_id = ? AND user_id = ? AND day = ?').get(o.id, uid, o.day) ? null : 'That check-in is already removed.';
      default: return null;
    }
  }
  function describe(ex) {
    const a = ex.approval_id ? db.prepare('SELECT preview FROM approvals WHERE id = ? AND user_id = ?').get(ex.approval_id, ex.user_id) : null, p = a ? parse(a.preview) : {};
    const action = p.action || PLAIN[ex.tool] || 'A change', change = Array.isArray(p.changes) && p.changes[0] ? p.changes[0] : '';
    return { action: clip(action, 80), detail: clip(change, 160) };
  }
  function item(ex, uid) {
    const d = describe(ex), tool = registry.get(ex.tool), base = { id: ex.id, tool: ex.tool, runId: ex.run_id, at: ex.finished_at || ex.started_at, action: d.action, detail: d.detail };
    if (ex.undone_at) return Object.assign(base, { state: 'undone', reason: 'Already undone.', undoneAt: ex.undone_at });
    if (ex.status === 'unverified') return Object.assign(base, { state: 'cannot', reason: 'NOVA could not confirm this change, so it cannot undo it safely. Check it on its page first.' });
    if (!tool || typeof tool.undo !== 'function' || !ex.undoable) return Object.assign(base, { state: 'cannot', reason: NEVER[ex.tool] || 'This kind of change cannot be undone.' });
    const why = stillApplies(ex.tool, parse(ex.output), uid);
    return why ? Object.assign(base, { state: 'cannot', reason: why }) : Object.assign(base, { state: 'can', reason: null });
  }
  function list(uid) {
    const rows = db.prepare("SELECT * FROM tool_executions WHERE user_id = ? AND status IN ('succeeded', 'unverified') ORDER BY id DESC LIMIT 120").all(uid)
      .filter(ex => { const t = registry.get(ex.tool); return t && t.risk !== 'read'; }).slice(0, LIMIT);
    return rows.map(ex => item(ex, uid));
  }
  function own(uid, id) {
    const ex = db.prepare('SELECT * FROM tool_executions WHERE id = ? AND user_id = ?').get(id, uid);
    if (!ex) throw new HttpError(404, 'That change could not be found.', 'not_found');
    return ex;
  }

  function preview(user, id) {
    const ex = own(user.id, id), it = item(ex, user.id);
    if (it.state !== 'can') throw new HttpError(409, it.state === 'undone' ? 'That change was already undone.' : it.reason, 'not_undoable');
    sweep(); for (const [k, v] of pending) if (v.uid === user.id && v.id === id) pending.delete(k);
    const token = crypto.randomBytes(12).toString('hex'); pending.set(token, { uid: user.id, id, at: now() });
    const fx = effects.undoEffects(user, ex.tool, parse(ex.output));
    return { token, executionId: id, action: 'Undo: ' + it.action, detail: it.detail, changes: [WILL[ex.tool] || 'The change is reversed.'], effects: fx,
      consequences: 'Nothing else is changed. NOVA keeps a record of the undo.', expiresInMinutes: Math.round(TTL / 60e3) };
  }
  function apply(user, ip, id, token) {
    sweep();
    const p = pending.get(String(token));
    if (!p || p.uid !== user.id || p.id !== id) throw new HttpError(404, 'That undo preview has expired or was already used. Open the preview again. Nothing was changed.', 'not_found');
    pending.delete(String(token));
    const ex = own(user.id, id);
    if (ex.undone_at) throw new HttpError(409, 'That change was already undone.', 'bad_state');
    const r = agent.undo({ user, ip }, id);
    return { ok: true, message: r.message, item: item(own(user.id, id), user.id) };
  }

  function register(router) {
    router.get('/api/undo', ctx => { const items = list(ctx.auth.user.id); return { status: 200, body: { items, canUndo: items.filter(i => i.state === 'can').length } }; });
    router.post('/api/undo/:id/preview', ctx => ({ status: 200, body: preview(ctx.auth.user, +ctx.params.id) }));
    router.post('/api/undo/:id/apply', ctx => {
      if (ctx.body.approve !== true) throw new HttpError(400, 'Press Approve to undo this. Nothing was changed.', 'approval_required');
      return { status: 200, body: apply(ctx.auth.user, ctx.req.socket.remoteAddress, +ctx.params.id, ctx.body.token) };
    });
  }
  return { register, list, preview, apply };
}
module.exports = { createUndoList };

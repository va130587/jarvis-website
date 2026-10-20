// Verification checks: they look at the real stored state right now. A commitment can be Verified by one of these, or by you confirming it yourself
// (which is recorded as NOT independent). Calendar, e-mail and file checks arrive with those connectors (they do not exist yet, so they are not offered).
'use strict';
function createAdapters(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  return {
    task_exists: (u, id) => one('SELECT 1 FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', id, u) ? { ok: true, independent: true } : { ok: false, reason: 'task #' + id + ' does not exist' },
    task_done: (u, id) => { const t = one('SELECT status FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', id, u); return t && t.status === 'done' ? { ok: true, independent: false } : { ok: false, reason: 'task #' + id + ' is not marked done' }; },   // marked done by you: checked, but self-reported
    note_exists: (u, id) => one('SELECT 1 FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL', id, u) ? { ok: true, independent: true } : { ok: false, reason: 'note #' + id + ' does not exist' },
    memory_exists: (u, id) => one("SELECT 1 FROM memories WHERE id = ? AND user_id = ? AND status = 'active'", id, u) ? { ok: true, independent: true } : { ok: false, reason: 'memory #' + id + ' does not exist' }
  };
}
module.exports = { createAdapters };

// "What happens if": the other things an approval would touch, worked out from your own data BEFORE you approve.
// Every line is a fact read from the database (a count, a title, a time), never a guess. Nothing here writes anything.
// An empty list means nothing else is affected; null means the check itself failed (the preview then says so).
'use strict';
const { parts } = require('./daily/clock');
const { TERMINAL, LABEL } = require('./proofloop/machine');

const DAY = 86400e3;
const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const q = s => '“' + clip(s, 60) + '”';
const niceDay = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const hm = ms => new Date(ms + 4 * 3600e3).toISOString().slice(11, 16);
const aed = f => 'AED ' + (f / 100).toFixed(f % 100 ? 2 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const minOf = s => +s.slice(0, 2) * 60 + +s.slice(3, 5);

function createEffects(db, { now }) {
  const today = () => parts(now()).iso;
  const task = (uid, id) => db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, uid);
  const open = (c) => !TERMINAL.includes(c.status);
  const plan = (uid, day) => { const r = db.prepare('SELECT data FROM day_plans WHERE user_id = ? AND day = ?').get(uid, day); try { return r ? JSON.parse(r.data) : null; } catch (e) { return null; } };
  const linked = (uid, taskId) => db.prepare('SELECT id, title, status FROM commitments WHERE user_id = ? AND task_id = ?').all(uid, taskId);

  // other things that fall on a date: open tasks (not the ones that back a commitment, which are counted as the commitment) and open promises you owe
  function sameDay(uid, iso, skipTaskId, runId) {
    const backed = new Set(db.prepare('SELECT task_id FROM commitments WHERE user_id = ? AND task_id IS NOT NULL').all(uid).map(r => r.task_id));
    const t = db.prepare("SELECT id, title FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'open' AND due = ?").all(uid, iso).filter(x => x.id !== skipTaskId && !backed.has(x.id)).map(x => x.title);
    const c = db.prepare("SELECT title, status, run_id FROM commitments WHERE user_id = ? AND direction = 'i_owe' AND deadline = ?").all(uid, iso).filter(x => open(x) && !(runId && x.run_id === runId)).map(x => x.title);   // not the one made for this very request
    return t.concat(c);
  }
  function dayLine(uid, iso, skipTaskId, runId) {
    const items = sameDay(uid, iso, skipTaskId, runId); if (!items.length) return null;
    return plural(items.length, 'other item is', 'other items are') + ' already due on ' + niceDay(iso) + ': ' + items.slice(0, 3).map(q).join(', ') + (items.length > 3 ? ' and ' + (items.length - 3) + ' more' : '') + '.';
  }
  function planLine(uid, iso, what) {
    const p = plan(uid, iso); if (!p || !Array.isArray(p.blocks)) return null;
    return 'You have a saved plan for ' + niceDay(iso) + ' (' + plural(p.blocks.filter(b => b.kind !== 'lunch' && b.kind !== 'break').length, 'work block', 'work blocks') + '). ' + what;
  }

  const BY_TOOL = {
    'tasks.create': (u, i, runId) => {
      const out = [], uid = u.id;
      const dup = db.prepare("SELECT id FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'open' AND lower(title) = lower(?)").get(uid, String(i.title).trim());
      if (dup) out.push('You already have an open task with the same title (#' + dup.id + ').');
      if (i.due) {
        const t = today();
        if (i.due < t) out.push('That date has already passed (' + plural(Math.round((Date.parse(t + 'T12:00:00Z') - Date.parse(i.due + 'T12:00:00Z')) / DAY), 'day', 'days') + ' ago), so the task will be overdue as soon as it is created.');
        const d = dayLine(uid, i.due, null, runId); if (d) out.push(d);
        out.push('NOVA will also track it in ProofLoop as something you owe, due ' + i.due + '. It will wait in Awaiting Confirmation: NOVA cannot see whether you did it.');
        const p = planLine(uid, i.due, 'This task is not in it; plan the day again to include it.'); if (p) out.push(p);
      }
      return out;
    },
    'tasks.complete': (u, i) => {
      const t = task(u.id, i.id); if (!t) return []; const out = [];
      for (const c of linked(u.id, t.id)) {
        if (['submitted', 'awaiting_confirmation'].includes(c.status)) out.push('It closes your ProofLoop commitment ' + q(c.title) + ' (#' + c.id + '): your confirmation is recorded as self-reported evidence, then the commitment is Completed.');
        else if (open(c)) out.push('Your ProofLoop commitment ' + q(c.title) + ' (#' + c.id + ') is linked to this task, but it is ' + LABEL[c.status] + ', so it will not be changed.');
      }
      const f = db.prepare("SELECT title FROM focus_sessions WHERE user_id = ? AND task_id = ? AND status = 'running'").get(u.id, t.id);
      if (f) out.push('A focus session on this task is running; it keeps running until you stop it.');
      const p = plan(u.id, today()); const b = p && Array.isArray(p.blocks) ? p.blocks.find(x => x.taskId === t.id) : null;
      if (b) out.push('It is a block in your saved plan for today (' + b.start + ' to ' + b.end + '); the plan is not changed.');
      return out;
    },
    'tasks.delete': (u, i) => {
      const t = task(u.id, i.id); if (!t) return []; const out = [];
      for (const c of linked(u.id, t.id)) if (open(c)) out.push('Your ProofLoop commitment ' + q(c.title) + ' (#' + c.id + ') is linked to this task. Deleting the task does not close it: it stays ' + LABEL[c.status] + '.');
      const f = db.prepare("SELECT 1 FROM focus_sessions WHERE user_id = ? AND task_id = ? AND status = 'running'").get(u.id, t.id);
      if (f) out.push('A focus session on this task is running; deleting the task does not stop it.');
      const p = plan(u.id, today()); const b = p && Array.isArray(p.blocks) ? p.blocks.find(x => x.taskId === t.id) : null;
      if (b) out.push('It is a block in your saved plan for today (' + b.start + ' to ' + b.end + '); the plan is not changed.');
      return out;
    },
    'commitments.create': (u, i) => {
      const out = [];
      if (i.deadline) { const t = today(); if (i.deadline < t) out.push('That date has already passed, so it will be overdue as soon as it is created.'); const d = dayLine(u.id, i.deadline); if (d) out.push(d); }
      return out;
    },
    'commitments.confirm': (u, i) => {
      const c = db.prepare('SELECT id, task_id FROM commitments WHERE id = ? AND user_id = ?').get(i.id, u.id); if (!c || !c.task_id) return [];
      const t = db.prepare("SELECT id, title FROM tasks WHERE id = ? AND user_id = ? AND status = 'open' AND deleted_at IS NULL").get(c.task_id, u.id);
      return t ? ['Task #' + t.id + ' ' + q(t.title) + ' will also be marked done.'] : [];
    },
    'reminders.create': (u, i) => {
      const out = [], at = i.dueAt, day = parts(at).iso;
      for (const r of db.prepare("SELECT text FROM reminders WHERE user_id = ? AND status = 'pending' AND due_at >= ? AND due_at < ?").all(u.id, at - 60e3 + 1, at + 60e3)) out.push('Another reminder is set for the same time: ' + q(r.text) + '.');
      for (const f of db.prepare("SELECT title, started_at, planned_min FROM focus_sessions WHERE user_id = ? AND status = 'running'").all(u.id)) { const end = f.started_at + f.planned_min * 60e3; if (at >= f.started_at && at < end) out.push('A focus session (' + q(f.title) + ') will still be running then; it ends at ' + hm(end) + '.'); }
      const p = plan(u.id, day), m = parts(at).h * 60 + parts(at).mi;
      for (const b of p && Array.isArray(p.blocks) ? p.blocks : []) if (m >= minOf(b.start) && m < minOf(b.end)) out.push('At that time your saved plan has ' + q(b.title) + ' (' + b.start + ' to ' + b.end + ').');
      return out;
    },
    'expenses.add': (u, i) => {
      const b = db.prepare("SELECT monthly_fils FROM budgets WHERE user_id = ? AND category = 'total'").get(u.id); if (!b) return [];
      const month = today().slice(0, 7), spent = db.prepare('SELECT COALESCE(SUM(amount_fils), 0) s FROM expenses WHERE user_id = ? AND deleted_at IS NULL AND day >= ? AND day <= ?').get(u.id, month + '-01', month + '-31').s;
      const after = spent + i.fils, pct = f => Math.round(100 * f / b.monthly_fils), out = ['This month\'s spending goes from ' + aed(spent) + ' to ' + aed(after) + ' of your ' + aed(b.monthly_fils) + ' budget (' + pct(spent) + '% to ' + pct(after) + '%).'];
      if (spent < b.monthly_fils && after >= b.monthly_fils) out.push('This reaches 100% of your budget: NOVA will warn you.');
      else if (spent < b.monthly_fils * 0.8 && after >= b.monthly_fils * 0.8) out.push('This passes 80% of your budget: NOVA will warn you.');
      return out;
    }
  };
  function effects(user, tool, input, runId) {
    try { const f = BY_TOOL[tool]; return f ? f(user, input || {}, runId).map(s => clip(s, 260)) : []; } catch (e) { return null; }
  }

  // The same kind of facts for UNDOING a change: what else the undo touches, and what it does not bring back. `o` is what the original action returned.
  const UNDO = {
    'tasks.create': (u, o) => {
      const out = [], t = task(u.id, o.id); if (!t) return out;
      for (const c of linked(u.id, t.id)) if (open(c)) out.push('Its ProofLoop commitment ' + q(c.title) + ' (#' + c.id + ') will be cancelled too.');
      const p = plan(u.id, today()), b = p && Array.isArray(p.blocks) ? p.blocks.find(x => x.taskId === t.id) : null;
      if (b) out.push('It is a block in your saved plan for today (' + b.start + ' to ' + b.end + '); the plan is not changed.');
      return out;
    },
    'tasks.complete': (u, o) => {
      const out = [], t = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(o.id, u.id); if (!t) return out;
      for (const c of linked(u.id, t.id)) if (c.status === 'completed') out.push('Your ProofLoop commitment ' + q(c.title) + ' (#' + c.id + ') was closed when this task was marked done. Undoing does not reopen it: it stays Completed.');
      return out;
    },
    'tasks.delete': (u, o) => {
      const out = [], t = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(o.id, u.id); if (!t) return out;
      for (const c of linked(u.id, t.id)) if (open(c)) out.push('Your ProofLoop commitment ' + q(c.title) + ' (#' + c.id + ') was never closed, so it stays ' + LABEL[c.status] + '.');
      if (t.due && t.due < today() && t.status === 'open') out.push('Its date (' + t.due + ') has passed, so it will be overdue as soon as it is back.');
      return out;
    },
    'commitments.create': (u, o) => {
      const c = db.prepare('SELECT task_id FROM commitments WHERE id = ? AND user_id = ?').get(o.id, u.id), out = [];
      if (c && c.task_id) { const t = task(u.id, c.task_id); if (t && t.status === 'open') out.push('Its linked task #' + t.id + ' ' + q(t.title) + ' stays open; only the commitment is cancelled.'); }
      return out;
    },
    'reminders.create': (u, o) => { const r = db.prepare('SELECT text, due_at FROM reminders WHERE id = ? AND user_id = ?').get(o.id, u.id); return r ? ['The reminder ' + q(r.text) + ' for ' + hm(r.due_at) + ' will not go off.'] : []; },
    'expenses.add': (u, o) => {
      const e = db.prepare('SELECT amount_fils, day FROM expenses WHERE id = ? AND user_id = ?').get(o.id, u.id), out = [];
      const b = db.prepare("SELECT monthly_fils FROM budgets WHERE user_id = ? AND category = 'total'").get(u.id);
      if (e && b && e.day.slice(0, 7) === today().slice(0, 7)) {
        const month = today().slice(0, 7), spent = db.prepare('SELECT COALESCE(SUM(amount_fils), 0) s FROM expenses WHERE user_id = ? AND deleted_at IS NULL AND day >= ? AND day <= ?').get(u.id, month + '-01', month + '-31').s, pct = f => Math.round(100 * f / b.monthly_fils);
        out.push('This month\'s spending goes from ' + aed(spent) + ' to ' + aed(spent - e.amount_fils) + ' of your ' + aed(b.monthly_fils) + ' budget (' + pct(spent) + '% to ' + pct(spent - e.amount_fils) + '%).');
      }
      return out;
    },
    'habits.check': (u, o) => { const h = db.prepare('SELECT name FROM habits WHERE id = ? AND user_id = ?').get(o.id, u.id); return h ? ['The habit ' + q(h.name) + ' will show as not done on ' + niceDay(o.day) + '.'] : []; }
  };
  function undoEffects(user, tool, output) {
    try { const f = UNDO[tool]; return f ? f(user, output || {}).map(s => clip(s, 260)) : []; } catch (e) { return null; }
  }
  return { effects, undoEffects };
}
module.exports = { createEffects };

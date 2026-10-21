// Promise Orbit: one read-only list of what is open and has a date (or should have one): ProofLoop commitments and tasks,
// nearest first, with a state a picture can show. Nothing here changes data. Dubai dates. Items are the user's own only.
'use strict';
const { TERMINAL, dubaiToday } = require('./proofloop/machine');

const DAY = 86400e3, MAX = 12;
const days = (iso, today) => Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / DAY);
const WAITING = ['awaiting_approval', 'submitted', 'awaiting_confirmation'];

function when(d) { return d === null ? 'no date' : d < 0 ? 'overdue ' + (-d) + (d === -1 ? ' day' : ' days') : d === 0 ? 'due today' : d === 1 ? 'due tomorrow' : 'due in ' + d + ' days'; }

function createOrbit(cfg, db, { now }) {
  function orbit(userId) {
    const today = dubaiToday(now());
    const items = [];
    for (const c of db.prepare('SELECT id, title, status, deadline, direction, counterparty, task_id FROM commitments WHERE user_id = ?').all(userId)) {
      if (TERMINAL.includes(c.status)) continue;
      const d = c.deadline ? days(c.deadline, today) : null;
      const state = d !== null && d < 0 && c.status !== 'verified' ? 'overdue' : c.status === 'verified' ? 'verified' : WAITING.includes(c.status) ? 'waiting' : 'normal';
      const word = state === 'verified' ? 'verified' : state === 'waiting' ? 'waiting for proof' : null;
      items.push({ kind: 'commitment', id: c.id, taskId: c.task_id, title: c.title, state, due: c.deadline || null, days: d,
        who: c.direction === 'owed_to_me' ? 'owed to you' + (c.counterparty ? ' by ' + c.counterparty : '') : 'you owe' + (c.counterparty ? ' ' + c.counterparty : ''),
        label: c.title + ', ' + (state === 'overdue' ? when(d) : (word ? word + (d === null ? '' : ', ' + when(d)) : when(d))) });
    }
    const backed = new Set(items.map(i => i.taskId).filter(Boolean));          // a task that already backs a commitment is shown once
    for (const t of db.prepare("SELECT id, title, due FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'open'").all(userId)) {
      if (backed.has(t.id)) continue;
      const d = t.due ? days(t.due, today) : null;
      items.push({ kind: 'task', id: t.id, title: t.title, state: d !== null && d < 0 ? 'overdue' : 'normal', due: t.due || null, days: d, who: 'task',
        label: t.title + ', ' + when(d) });
    }
    const rank = i => (i.state === 'overdue' ? 0 : 1);
    items.sort((a, b) => rank(a) - rank(b) || (a.days === null) - (b.days === null) || (a.days - b.days) || a.title.localeCompare(b.title) || a.id - b.id);
    const shown = items.slice(0, MAX).map(({ taskId, ...rest }) => rest);
    return { today, total: items.length, shown, more: Math.max(0, items.length - MAX), overdue: items.filter(i => i.state === 'overdue').length };
  }
  function register(router) {
    router.get('/api/orbit', ctx => ({ status: 200, body: orbit(ctx.auth.user.id) }));
  }
  return { orbit, register, MAX };
}
module.exports = { createOrbit };

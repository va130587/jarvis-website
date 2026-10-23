// Life Timeline: one page that merges, per day, what happened across NOVA: tasks finished, promises kept, expenses, habits, notes and the actions
// NOVA took for you (Day Replay). Read-only, newest first, loaded in pages with a cursor so thousands of events stay fast, with type filters and a search.
// Each row links to its own page. Only your own data, Dubai time.
'use strict';
const { HttpError } = require('./http');
const { dubaiToday } = require('./proofloop/machine');

const TYPES = { task: 'Tasks finished', promise: 'Promises kept', expense: 'Expenses', habit: 'Habits', note: 'Notes', action: 'What NOVA did' };
const LINK = { task: '#hub', promise: '#proofloop', expense: '#life', habit: '#life', note: '#hub', action: '#replay' };
const DEFAULT = 50, MAX = 100, MAX_Q = 80;
const hm = ms => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
const aed = f => 'AED ' + (f / 100).toFixed(f % 100 ? 2 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const like = q => '%' + q.replace(/[\\%_]/g, c => '\\' + c) + '%';

function createTimeline(cfg, db) {
  const now = cfg.now;
  const RANK = Object.keys(TYPES);
  function parseCursor(c) {
    if (c === null || c === undefined || c === '') return { ts: now() + 864e5, rank: 99, n: Infinity };
    const m = /^(\d{1,15})_([a-z]+)_(\d{1,15})$/.exec(String(c)); if (!m || !TYPES[m[2]]) throw new HttpError(400, 'That page marker is not valid. Reload the timeline.', 'invalid');
    return { ts: +m[1], rank: RANK.indexOf(m[2]), n: +m[3] };
  }
  // The time an event is placed at: when it was recorded, or noon of its own day when it was logged on a different day.
  const DAY_TS = (day, created) => "(CASE WHEN strftime('%Y-%m-%d', " + created + " / 1000 + 14400, 'unixepoch') = " + day + " THEN " + created + " ELSE (CAST(strftime('%s', " + day + " || ' 12:00:00') AS INTEGER) - 14400) * 1000 END)";
  function compute(uid, q) {
    const types = q.types ? String(q.types).split(',').filter(t => TYPES[t]) : RANK.slice();
    if (q.types && !types.length) throw new HttpError(400, 'Choose at least one kind of event to show.', 'invalid');
    const limit = Math.min(MAX, Math.max(1, parseInt(q.limit, 10) || DEFAULT)), cur = parseCursor(q.before), term = String(q.q || '').trim().slice(0, MAX_Q), L = term ? like(term) : null, take = limit + 1;
    const rows = [];
    // Every source asks only for events AFTER the cursor, in the same order (time, then kind, then id), so paging never repeats or skips an event.
    function fetch(type, from, where, params, ts, id, cols, groupBy) {
      const rank = RANK.indexOf(type), tie = rank === cur.rank ? ' OR (' + ts + ' = ? AND ' + id + ' < ?)' : '', op = rank < cur.rank ? '<=' : '<', cond = '(' + ts + ' ' + (tie ? '<' : op) + ' ?' + tie + ')';
      const args = [uid].concat(params, [cur.ts], tie ? [cur.ts, cur.n] : []);
      const sql = 'SELECT ' + cols + ', ' + ts + ' AS ts, ' + id + ' AS n FROM ' + from + ' WHERE ' + where + ' AND ' + cond + (groupBy || '') + ' ORDER BY ts DESC, n DESC LIMIT ' + take;
      for (const r of db.prepare(sql).all(...args)) rows.push({ type, rank, n: r.n, ts: r.ts, r });
    }
    const likeTask = L ? " AND title LIKE ? ESCAPE '\\'" : '', lp = L ? [L] : [];
    if (types.includes('task')) fetch('task', 'tasks', "user_id = ? AND status = 'done' AND deleted_at IS NULL" + likeTask, lp, 'completed_at', 'id', 'id, title, due');
    if (types.includes('promise')) {
      const rank = RANK.indexOf('promise'), kept = 'MIN(e.ts)', tie = rank === cur.rank ? ' OR (' + kept + ' = ? AND c.id < ?)' : '', op = rank < cur.rank ? '<=' : '<';
      const sql = "SELECT c.id n, c.title, c.counterparty, c.direction, " + kept + " ts FROM commitments c JOIN commitment_events e ON e.commitment_id = c.id AND e.to_status IN ('verified', 'completed') WHERE c.user_id = ?" + (L ? " AND c.title LIKE ? ESCAPE '\\'" : '') +
        ' GROUP BY c.id HAVING (' + kept + ' ' + (tie ? '<' : op) + ' ?' + tie + ') ORDER BY ts DESC, n DESC LIMIT ' + take;
      for (const r of db.prepare(sql).all(...[uid].concat(lp, [cur.ts], tie ? [cur.ts, cur.n] : []))) rows.push({ type: 'promise', rank, n: r.n, ts: r.ts, r });
    }
    if (types.includes('expense')) fetch('expense', 'expenses', 'user_id = ? AND deleted_at IS NULL' + (L ? " AND (COALESCE(note, '') LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')" : ''), L ? [L, L] : [], DAY_TS('day', 'created_at'), 'id', 'id, amount_fils, category, note, day, created_at');
    if (types.includes('habit')) fetch('habit', 'habit_checks k JOIN habits h ON h.id = k.habit_id', 'k.user_id = ?' + (L ? " AND h.name LIKE ? ESCAPE '\\'" : ''), lp, DAY_TS('k.day', 'k.created_at'), 'h.id', 'h.id, h.name, k.day, k.created_at');
    if (types.includes('note')) fetch('note', 'notes', 'user_id = ? AND deleted_at IS NULL' + (L ? " AND text LIKE ? ESCAPE '\\'" : ''), lp, 'created_at', 'id', 'id, text');
    if (types.includes('action')) fetch('action', 'tool_executions te JOIN runs r ON r.id = te.run_id', "te.user_id = ? AND te.status = 'succeeded'" + (L ? " AND r.request LIKE ? ESCAPE '\\'" : ''), lp, 'te.finished_at', 'te.id', 'te.id, te.tool, te.undone_at, r.request');
    const events = rows.sort((a, b) => b.ts - a.ts || b.rank - a.rank || b.n - a.n).map(({ type, n, ts, r }) => {
      const base = { type, typeLabel: TYPES[type], link: LINK[type], ts };
      if (type === 'task') return Object.assign(base, { key: 'task:' + n, what: 'Task finished', title: r.title, detail: r.due ? 'Due ' + r.due : null, day: dubaiToday(ts), time: hm(ts) });
      if (type === 'promise') return Object.assign(base, { key: 'promise:' + n, what: r.direction === 'owed_to_me' ? 'Promise to me kept' : 'Promise kept', title: r.title, detail: r.counterparty ? (r.direction === 'owed_to_me' ? 'From ' : 'To ') + r.counterparty : null, day: dubaiToday(ts), time: hm(ts) });
      if (type === 'expense') return Object.assign(base, { key: 'expense:' + n, what: 'Expense', title: aed(r.amount_fils) + (r.note ? ' on ' + r.note : ''), detail: r.category, day: r.day, time: r.created_at === ts ? hm(ts) : null });
      if (type === 'habit') return Object.assign(base, { key: 'habit:' + n + '-' + r.day, what: 'Habit checked in', title: r.name, detail: null, day: r.day, time: r.created_at === ts ? hm(ts) : null });
      if (type === 'note') return Object.assign(base, { key: 'note:' + n, what: 'Note saved', title: clip(r.text, 160), detail: null, day: dubaiToday(ts), time: hm(ts) });
      return Object.assign(base, { key: 'action:' + n, what: 'NOVA did this for you', title: clip(r.request, 160), detail: r.tool + (r.undone_at ? ' (undone)' : ''), day: dubaiToday(ts), time: hm(ts) });
    });
    const page = events.slice(0, limit), more = events.length > limit, last = page[page.length - 1];
    return { events: page, next: more && last ? last.ts + '_' + last.type + '_' + (last.type === 'habit' ? last.key.split(':')[1].split('-')[0] : last.key.split(':')[1]) : null, limit, types: RANK.map(k => ({ id: k, label: TYPES[k] })), selected: types, query: term, today: dubaiToday(now()) };
  }
  function register(router) { router.get('/api/timeline', ctx => ({ status: 200, body: compute(ctx.auth.user.id, Object.fromEntries(ctx.url.searchParams)) })); }
  return { compute, register };
}
module.exports = { createTimeline };

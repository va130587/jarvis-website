// The free planner: turns clear requests into one tool call using fixed patterns. No AI model, no cost, deterministic.
// It is used when a pattern matches; anything else goes to a configured model (if any). Either way the backend decides what actually runs.
'use strict';
const { tokens } = require('../memory');
const { P } = require('../../intents');

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function dubaiDate(ms) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); }
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function parseDue(word, now) {
  const w = String(word || '').toLowerCase(), today = dubaiDate(now);
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  if (w === 'today') return today;
  if (w === 'tomorrow') return addDays(today, 1);
  const i = DAYS.indexOf(w); if (i < 0) return null;
  const cur = new Date(today + 'T12:00:00Z').getUTCDay();
  return addDays(today, ((i - cur + 7) % 7) || 7);
}
const DUE_RX = /\s+(?:by|on|before|due|for)\s+(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{4}-\d{2}-\d{2})\s*$/i;

function bestMatch(rows, query, field) {
  const q = new Set(tokens(query)); if (!q.size) return { none: true };
  const scored = rows.map(r => { const t = tokens(r[field]); const hit = t.filter(w => q.has(w)).length; return { r, s: hit / Math.max(1, Math.max(t.length, q.size)) }; }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  if (!scored.length) return { none: true };
  if (scored.length > 1 && scored[0].s === scored[1].s) return { ambiguous: scored.slice(0, 3).map(x => x.r) };
  return { row: scored[0].r };
}

// Returns null when no pattern applies; otherwise { understood, call:{name,input} } or { understood, final } (for example "I could not find that task").
function matchIntent(message, ctx) {
  const m0 = require('../../intents').clean(message);
  let m;
  const title = t => { let due = null, s = t.trim().replace(/[.!]+$/, ''); const d = DUE_RX.exec(s); if (d) { due = parseDue(d[1], ctx.now()); s = s.slice(0, d.index).trim(); } return { title: s, due }; };
  if ((m = P.create[0].exec(m0)) || (m = P.create[1].exec(m0))) {
    const t = title(m[1]); if (!t.title) return null;
    return { understood: 'Create a task "' + t.title + '"' + (t.due ? ' due ' + t.due : ''), call: { name: 'tasks.create', input: t.due ? { title: t.title, due: t.due } : { title: t.title } } };
  }
  if ((m = P.list.exec(m0))) {
    const st = (m[1] || '').trim().toLowerCase() || (/done/i.test(m0) ? 'done' : 'open');
    return { understood: 'List your ' + st + ' tasks', call: { name: 'tasks.list', input: { status: st } } };
  }
  if ((m = P.complete.exec(m0)) && !/^(?:note|memory)/i.test(m[1])) {
    const rows = ctx.db.prepare("SELECT id, title FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'open'").all(ctx.user.id), b = bestMatch(rows, m[1], 'title');
    if (b.none) return { understood: 'Complete a task: "' + m[1] + '"', final: 'I could not find an open task matching "' + m[1] + '". Nothing was changed.' };
    if (b.ambiguous) return { understood: 'Complete a task: "' + m[1] + '"', final: 'More than one task matches: ' + b.ambiguous.map(t => '#' + t.id + ' ' + t.title).join('; ') + '. Please say which one. Nothing was changed.' };
    return { understood: 'Complete task #' + b.row.id + ' "' + b.row.title + '"', call: { name: 'tasks.complete', input: { id: b.row.id } } };
  }
  if ((m = P.del.exec(m0))) {
    const rows = ctx.db.prepare('SELECT id, title FROM tasks WHERE user_id = ? AND deleted_at IS NULL').all(ctx.user.id), b = bestMatch(rows, m[1], 'title');
    if (b.none) return { understood: 'Delete a task: "' + m[1] + '"', final: 'I could not find a task matching "' + m[1] + '". Nothing was changed.' };
    if (b.ambiguous) return { understood: 'Delete a task: "' + m[1] + '"', final: 'More than one task matches: ' + b.ambiguous.map(t => '#' + t.id + ' ' + t.title).join('; ') + '. Please say which one. Nothing was changed.' };
    return { understood: 'Delete task #' + b.row.id + ' "' + b.row.title + '"', call: { name: 'tasks.delete', input: { id: b.row.id } } };
  }
  if ((m = P.note[0].exec(m0)) || (m = P.note[1].exec(m0))) return { understood: 'Save a note', call: { name: 'notes.create', input: { text: m[1].trim().replace(/[.!]+$/, '') } } };
  if (P.notes.test(m0)) return { understood: 'List your notes', call: { name: 'notes.list', input: {} } };
  if ((m = P.search.exec(m0))) return { understood: 'Search your memories for "' + m[1] + '"', call: { name: 'memory.search', input: { query: m[1].trim() } } };
  if ((m = P.commitList.exec(m0))) { const f = /owed to me|owes me/i.test(m0) ? 'owed_to_me' : /overdue/i.test(m0) ? 'overdue' : /do i owe/i.test(m0) ? 'i_owe' : 'open'; return { understood: 'List your ' + f.replace('_', ' ') + ' commitments', call: { name: 'commitments.list', input: { filter: f } } }; }
  if ((m = P.oweMe.exec(m0)) && !/^(?:i|you|we)$/i.test(m[1].trim())) { const due = m[3] ? parseDue(m[3], ctx.now()) : null; return { understood: m[1].trim() + ' owes you "' + m[2].trim() + '"', call: { name: 'commitments.create', input: Object.assign({ title: m[2].trim().replace(/[.!]+$/, ''), direction: 'owed_to_me', counterparty: m[1].trim() }, due ? { deadline: due } : {}) } }; }
  if ((m = P.iPromised.exec(m0))) { const due = m[3] ? parseDue(m[3], ctx.now()) : null; return { understood: 'You promised ' + m[1].trim() + ': "' + m[2].trim() + '"', call: { name: 'commitments.create', input: Object.assign({ title: m[2].trim().replace(/[.!]+$/, ''), direction: 'i_owe', counterparty: m[1].trim() }, due ? { deadline: due } : {}) } }; }
  if ((m = P.confirm.exec(m0))) {
    const rows = ctx.db.prepare("SELECT id, title FROM commitments WHERE user_id = ? AND status IN ('submitted', 'awaiting_confirmation')").all(ctx.user.id), b = bestMatch(rows, m[1], 'title');
    if (!b.none && !b.ambiguous) return { understood: 'Confirm commitment #' + b.row.id + ' "' + b.row.title + '" is done', call: { name: 'commitments.confirm', input: { id: b.row.id } } };
    if (b.ambiguous) return { understood: 'Confirm a commitment: "' + m[1] + '"', final: 'More than one commitment matches: ' + b.ambiguous.map(t => '#' + t.id + ' ' + t.title).join('; ') + '. Please say which one. Nothing was changed.' };
    const trows = ctx.db.prepare("SELECT id, title FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'open'").all(ctx.user.id), tb = bestMatch(trows, m[1], 'title');
    if (!tb.none && !tb.ambiguous) return { understood: 'Complete task #' + tb.row.id + ' "' + tb.row.title + '"', call: { name: 'tasks.complete', input: { id: tb.row.id } } };
    return { understood: 'Confirm that "' + m[1] + '" is done', final: 'I could not find an open commitment or task matching "' + m[1] + '" (or more than one matched). Nothing was changed.' };
  }
  if (P.briefing.test(m0)) return { understood: 'Read your daily briefing', call: { name: 'briefing.today', input: {} } };
  if (P.email.test(m0)) return { understood: 'Check your e-mail', call: { name: 'email.list', input: { filter: /reply|replies|answer/i.test(m0) ? 'needs_reply' : /important|urgent/i.test(m0) ? 'important' : /^(?:check|read|show|list)/i.test(m0) || /new|unread/i.test(m0) ? 'all' : 'important' } } };
  if ((m = P.forget.exec(m0))) {
    const rows = ctx.db.prepare("SELECT id, text FROM memories WHERE user_id = ? AND status = 'active'").all(ctx.user.id), b = bestMatch(rows, m[1], 'text');
    if (b.none) return { understood: 'Forget: "' + m[1] + '"', final: 'I could not find a saved memory matching that. Nothing was changed.' };
    if (b.ambiguous) return { understood: 'Forget: "' + m[1] + '"', final: 'More than one memory matches: ' + b.ambiguous.map(x => '#' + x.id + ' ' + x.text).join('; ') + '. Please be more specific. Nothing was changed.' };
    return { understood: 'Delete memory #' + b.row.id + ' "' + b.row.text + '"', call: { name: 'memory.delete', input: { id: b.row.id } } };
  }
  return null;
}
module.exports = { matchIntent, parseDue, dubaiDate };

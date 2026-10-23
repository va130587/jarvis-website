// "Can people rely on me?": reliability worked out ONLY from ProofLoop, with the rule shown next to every number.
// A promise counts as kept on time when it first reached Verified or Completed on or before its deadline (Dubai date).
// Too little data says so: a score needs at least MIN promises that have a result or a missed deadline. Read-only.
'use strict';
const { TERMINAL, dubaiToday } = require('./machine');

const MIN = 3, MAX_PEOPLE = 50;
const RULE = 'Kept on time = reached Verified or Completed on or before its deadline. Counted = kept on time + late + failed + past its deadline and still open. Promises with no deadline, not due yet, or cancelled are shown but not counted.';

const mondayOf = iso => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const blank = () => ({ onTime: 0, late: 0, notKept: 0, overdue: 0, open: 0, doneNoDeadline: 0, cancelled: 0 });

function createTrust(db, now) {
  const keptAt = id => (db.prepare("SELECT MIN(ts) t FROM commitment_events WHERE commitment_id = ? AND to_status IN ('verified', 'completed')").get(id) || {}).t || null;

  function bucket(c, today) {
    if (c.status === 'cancelled') return 'cancelled';
    if (c.status === 'failed') return 'notKept';
    if (c.status === 'verified' || c.status === 'completed') {
      if (!c.deadline) return 'doneNoDeadline';
      const t = keptAt(c.id); if (!t) return 'doneNoDeadline';
      return dubaiToday(t) <= c.deadline ? 'onTime' : 'late';
    }
    return c.deadline && c.deadline < today ? 'overdue' : 'open';
  }
  const decided = n => n.onTime + n.late + n.notKept + n.overdue;
  const pct = n => { const d = decided(n); return d >= MIN ? Math.round(100 * n.onTime / d) : null; };

  function summarise(rows, dir, today) {
    const total = blank(), people = new Map();
    for (const c of rows) {
      const b = bucket(c, today); total[b]++;
      const name = (c.counterparty || '').trim(); if (!name) continue;
      const key = name.toLowerCase(), p = people.get(key) || Object.assign(blank(), { name }); p[b]++; p.name = name; people.set(key, p);
    }
    const line = (n, who) => {
      const d = decided(n);
      if (d < MIN) return 'Not enough data yet: at least ' + MIN + ' promises with a result or a missed deadline are needed' + (d ? ' (so far ' + d + ').' : '.');
      return dir === 'i_owe' ? 'You kept ' + n.onTime + ' of ' + d + ' promises' + (who ? ' to ' + who : '') + ' on time.' : (who ? who + ' kept ' : 'People kept ') + n.onTime + ' of ' + d + ' promises' + (who ? ' to you' : ' to you') + ' on time.';
    };
    const out = { total: Object.assign({ counted: decided(total), percent: pct(total), line: line(total, '') }, total), people: [] };
    out.people = [...people.values()].map(p => Object.assign({ name: p.name, counted: decided(p), percent: pct(p), line: line(p, p.name) }, p)).sort((a, b) => b.counted - a.counted || a.name.localeCompare(b.name)).slice(0, MAX_PEOPLE);
    return out;
  }

  function compute(userId) {
    const today = dubaiToday(now()), rows = db.prepare('SELECT * FROM commitments WHERE user_id = ?').all(userId);
    return { asOf: today, min: MIN, rule: RULE, iOwe: summarise(rows.filter(c => c.direction === 'i_owe'), 'i_owe', today), owedToMe: summarise(rows.filter(c => c.direction === 'owed_to_me'), 'owed_to_me', today), promises: rows.length };
  }

  // "Before you promise": how many of MY open promises already fall in the same Monday to Sunday week as this deadline.
  function headsUp(userId, deadline) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deadline || ''))) return null;
    const from = mondayOf(deadline), to = addDays(from, 6);
    const open = db.prepare("SELECT title, counterparty, deadline FROM commitments WHERE user_id = ? AND direction = 'i_owe' AND deadline BETWEEN ? AND ? AND status NOT IN ('verified', 'completed', 'failed', 'cancelled') ORDER BY deadline, id").all(userId, from, to);
    return { week: { from, to }, open: open.length, items: open.slice(0, 10).map(c => ({ title: c.title, counterparty: c.counterparty, deadline: c.deadline })),
      message: open.length >= MIN ? 'You already have ' + open.length + ' open promises due the week of ' + from + ': ' + open.slice(0, 3).map(c => c.title).join('; ') + (open.length > 3 ? '; and ' + (open.length - 3) + ' more.' : '.') + ' Think about whether a new one fits.' : null };
  }
  return { compute, headsUp, MIN, RULE, TERMINAL };
}
module.exports = { createTrust, MIN };

// Life Radar: five measures for this week and last week, each scaled 0 to 100 by a rule written next to it. A measure with no
// data is null ("not enough data yet"), never a made-up number. Read-only, Dubai weeks (Monday to Sunday), the user's own rows only.
'use strict';
const { parts } = require('./daily/clock');

const DAY = 86400e3, FOCUS_GOAL_MIN = 300, OVERDUE_COST = 10;
const addIso = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const at = iso => Date.parse(iso + 'T00:00:00+04:00');
const dim = iso => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7), 0)).getUTCDate();
const isWeekend = iso => [0, 6].includes(new Date(iso + 'T12:00:00Z').getUTCDay());
const aed = f => 'AED ' + (f / 100).toFixed(f % 100 ? 2 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const dur = m => m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min';

const SPOKES = [
  { id: 'kept', name: 'Promises kept on time', rule: 'Promises you owe that had a deadline in that week: the share closed on or before the deadline. Needs at least one.' },
  { id: 'focus', name: 'Focus time', rule: '100 = 5 hours (300 minutes) of focus in the week. Needs at least one focus session ever recorded.' },
  { id: 'habits', name: 'Habits done', rule: 'Check-ins done out of the days your active habits counted that week (weekday habits skip weekends), up to today. Needs a habit.' },
  { id: 'money', name: 'Spending within budget', rule: 'Needs a monthly budget and at least one expense that week. 100 = at or under that week\'s share of the budget; 0 = double or more.' },
  { id: 'overdue', name: 'Nothing overdue', rule: '100 = nothing overdue at the end of the week; each overdue item costs 10 points; 0 at ten or more.' }
];

function createRadar(cfg, db, { now }) {
  function week(uid, start, today) {
    const end = addIso(start, 6), through = end < today ? end : today;              // the days that have happened
    const t0 = at(start), t1 = at(addIso(through, 1)), asOf = Math.min(t1, now());
    const out = {};

    // 1. promises kept on time (promises you owe with a deadline in this week, judged by now)
    const rows = db.prepare("SELECT deadline, status, closed_at, updated_at FROM commitments WHERE user_id = ? AND direction = 'i_owe' AND deadline >= ? AND deadline <= ? AND status NOT IN ('cancelled', 'failed')").all(uid, start, through);
    let kept = 0, judged = 0;
    for (const c of rows) {
      const doneAt = c.status === 'completed' ? c.closed_at : c.status === 'verified' ? c.updated_at : null, dl = at(addIso(c.deadline, 1));
      if (doneAt !== null && doneAt < dl) { kept++; judged++; } else if (doneAt !== null || c.deadline < today) judged++;     // closed late, or still open after its day
    }
    out.kept = judged ? { score: Math.round(100 * kept / judged), detail: 'kept ' + kept + ' of ' + judged } : null;

    // 2. focus time
    const ever = db.prepare("SELECT COUNT(*) n FROM focus_sessions WHERE user_id = ? AND status != 'running'").get(uid).n;
    const mins = db.prepare("SELECT started_at, ended_at, planned_min FROM focus_sessions WHERE user_id = ? AND status != 'running' AND started_at >= ? AND started_at < ?").all(uid, t0, t1)
      .reduce((a, f) => a + Math.round(((f.ended_at || f.started_at + f.planned_min * 60e3) - f.started_at) / 60e3), 0);
    out.focus = ever ? { score: Math.min(100, Math.round(100 * mins / FOCUS_GOAL_MIN)), detail: dur(mins) + ' of focus' } : null;

    // 3. habits
    let possible = 0, done = 0;
    for (const h of db.prepare('SELECT id, schedule, created_at FROM habits WHERE user_id = ? AND archived = 0 AND created_at < ?').all(uid, t1)) {
      const from = (d => d > start ? d : start)(new Date(h.created_at + 4 * 3600e3).toISOString().slice(0, 10));
      const days = []; for (let d = from; d <= through; d = addIso(d, 1)) if (!(h.schedule === 'weekdays' && isWeekend(d))) days.push(d);
      const checks = new Set(db.prepare('SELECT day FROM habit_checks WHERE habit_id = ? AND day >= ? AND day <= ?').all(h.id, from, through).map(r => r.day));
      possible += days.length; done += days.filter(d => checks.has(d)).length;
    }
    out.habits = possible ? { score: Math.round(100 * done / possible), detail: done + ' of ' + possible + ' check-ins' } : null;

    // 4. spending within budget (this week's share of the monthly budget, prorated for the days so far)
    const b = db.prepare("SELECT monthly_fils FROM budgets WHERE user_id = ? AND category = 'total'").get(uid);
    const sp = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(amount_fils), 0) s FROM expenses WHERE user_id = ? AND deleted_at IS NULL AND day >= ? AND day <= ?').get(uid, start, through);
    if (b && sp.n) {
      const days = Math.round((Date.parse(through + 'T12:00:00Z') - Date.parse(start + 'T12:00:00Z')) / DAY) + 1, allowance = b.monthly_fils * days / dim(start), ratio = sp.s / allowance;
      out.money = { score: ratio <= 1 ? 100 : Math.max(0, Math.round(100 * (2 - ratio))), detail: aed(sp.s) + ' spent of ' + aed(Math.round(allowance / 100) * 100) };
    } else out.money = null;

    // 5. nothing overdue at the end of the week (or now, for this week)
    const asOfDay = through, endTs = asOf;
    const tasks = db.prepare("SELECT COUNT(*) n FROM tasks WHERE user_id = ? AND due IS NOT NULL AND due < ? AND created_at < ? AND (deleted_at IS NULL OR deleted_at >= ?) AND (status = 'open' OR completed_at IS NULL OR completed_at >= ?)").get(uid, asOfDay, endTs, endTs, endTs).n;
    const proms = db.prepare("SELECT COUNT(*) n FROM commitments WHERE user_id = ? AND direction = 'i_owe' AND deadline IS NOT NULL AND deadline < ? AND created_at < ? AND status NOT IN ('failed', 'cancelled') AND ((status NOT IN ('completed', 'verified')) OR (status = 'completed' AND closed_at >= ?) OR (status = 'verified' AND updated_at >= ?))").get(uid, asOfDay, endTs, endTs, endTs).n;
    const over = tasks + proms;
    out.overdue = { score: Math.max(0, 100 - OVERDUE_COST * over), detail: over === 0 ? 'nothing overdue' : over + ' overdue' };
    return { start, end, through, spokes: out };
  }
  function radar(userId) {
    const today = parts(now()).iso, monday = addIso(today, -((parts(now()).wd + 6) % 7));
    const th = week(userId, monday, today), la = week(userId, addIso(monday, -7), today);
    return { today, weeks: { this: { start: th.start, end: th.end, through: th.through }, last: { start: la.start, end: la.end, through: la.through } },
      spokes: SPOKES.map(s => ({ id: s.id, name: s.name, rule: s.rule, this: th.spokes[s.id], last: la.spokes[s.id] })) };
  }
  function register(router) { router.get('/api/radar', ctx => ({ status: 200, body: radar(ctx.auth.user.id) })); }
  return { radar, register, SPOKES };
}
module.exports = { createRadar };

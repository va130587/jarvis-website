// Weekly Review: the last full Dubai week (Monday to Sunday), built only from NOVA's own data. Each section says "not enough data yet" when there is
// nothing to show, and the three suggested priorities come from fixed rules that are printed next to them. Read-only: it changes nothing.
// "Copy as text" and "Download as Markdown" use the text and markdown built here, so what you copy is what you saw.
'use strict';
const { HttpError } = require('./http');
const { createTrust } = require('./proofloop/trust');
const { dubaiToday } = require('./proofloop/machine');

const addIso = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = iso => addIso(iso, -((new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7));
const dayStart = iso => Date.parse(iso + 'T00:00:00+04:00');
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const wd = iso => WD[new Date(iso + 'T12:00:00Z').getUTCDay()];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const nice = iso => +iso.slice(8) + ' ' + MON[+iso.slice(5, 7) - 1];
const aed = f => 'AED ' + (f / 100).toFixed(f % 100 ? 2 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const mins = m => m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min';
const days = n => n + ' day' + (n === 1 ? '' : 's');
const NOT_ENOUGH = what => 'Not enough data yet: ' + what;
const MAX_LIST = 10, WEEKS = 12;

function createReview(cfg, db) {
  const now = cfg.now, trust = createTrust(db, now);
  const dubai = ms => dubaiToday(ms);

  function weekRange(param) {
    const today = dubai(now()), thisMonday = mondayOf(today);
    let from;
    if (param === undefined || param === null || param === '') from = addIso(thisMonday, -7);                // the last full week
    else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(param) || isNaN(Date.parse(param + 'T12:00:00Z'))) throw new HttpError(400, 'Choose a week by a date in it, for example 2026-10-14.', 'invalid');
      from = mondayOf(param);
    }
    if (from > thisMonday) throw new HttpError(400, 'That week has not started yet. Choose this week or an earlier one.', 'invalid');
    return { from, to: addIso(from, 6), today, inProgress: addIso(from, 6) >= today };
  }
  const streakAt = (set, schedule, end) => {
    const counts = d => schedule === 'weekdays' ? ![0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay()) : true;
    let cur = 0, d = end; if (!set.has(d) && counts(d)) d = addIso(d, -1);
    for (let i = 0; i < 800; i++, d = addIso(d, -1)) { if (!counts(d)) continue; if (set.has(d)) cur++; else break; }
    return cur;
  };

  function compute(userId, param) {
    const w = weekRange(param), { from, to, today } = w, t0 = dayStart(from), t1 = dayStart(addIso(to, 1)), p0 = dayStart(addIso(from, -7));
    const dayList = Array.from({ length: 7 }, (_, i) => addIso(from, i));

    // what I finished
    const done = db.prepare("SELECT title, completed_at FROM tasks WHERE user_id = ? AND status = 'done' AND deleted_at IS NULL AND completed_at >= ? AND completed_at < ? ORDER BY completed_at").all(userId, t0, t1);
    const byDay = dayList.map(d => ({ date: d, weekday: wd(d), count: done.filter(x => dubai(x.completed_at) === d).length }));
    const finished = { total: done.length, byDay, items: done.slice(0, MAX_LIST * 3).map(x => ({ title: x.title, date: dubai(x.completed_at) })), empty: !done.length, message: done.length ? null : NOT_ENOUGH('no tasks were finished this week.') };

    // promises (ProofLoop, the ones I made) with a deadline this week, and how they went
    const rows = db.prepare("SELECT * FROM commitments WHERE user_id = ? AND direction = 'i_owe'").all(userId);
    const due = rows.filter(c => c.deadline && c.deadline >= from && c.deadline <= to);
    const tally = { onTime: 0, late: 0, notKept: 0, stillOpen: 0, cancelled: 0, doneNoDeadline: 0 }, items = [];
    for (const c of due) {
      let b = trust.bucket(c, today); if (b === 'overdue' || b === 'open') b = 'stillOpen'; tally[b] = (tally[b] || 0) + 1;
      items.push({ title: c.title, counterparty: c.counterparty, deadline: c.deadline, result: b });
    }
    const keptThisWeek = rows.filter(c => ['verified', 'completed'].includes(c.status)).filter(c => { const k = trust.keptAt(c.id); return k && k >= t0 && k < t1; }).length;
    const counted = tally.onTime + tally.late + tally.notKept + tally.stillOpen;
    const promises = { onTime: tally.onTime, late: tally.late, notKept: tally.notKept, stillOpen: tally.stillOpen, cancelled: tally.cancelled, counted, keptThisWeek, items: items.slice(0, MAX_LIST),
      empty: !counted && !keptThisWeek, message: !counted && !keptThisWeek ? NOT_ENOUGH('none of your promises had a deadline this week, and none was kept.') : null,
      rule: 'Promises you made with a deadline from Monday to Sunday of this week. Kept on time = reached Verified or Completed on or before the deadline. Still open = not finished yet, now.' };

    // focus time
    const sess = db.prepare("SELECT started_at, ended_at, planned_min FROM focus_sessions WHERE user_id = ? AND status != 'running' AND started_at >= ? AND started_at < ?").all(userId, t0, t1);
    const m = f => Math.round(((f.ended_at || f.started_at + f.planned_min * 60e3) - f.started_at) / 60e3);
    const focusDays = dayList.map(d => ({ date: d, weekday: wd(d), minutes: sess.filter(f => dubai(f.started_at) === d).reduce((a, f) => a + m(f), 0) }));
    const focusTotal = focusDays.reduce((a, x) => a + x.minutes, 0);
    const focus = { totalMin: focusTotal, sessions: sess.length, byDay: focusDays, empty: !sess.length, message: sess.length ? null : NOT_ENOUGH('no focus sessions were recorded this week.') };

    // habits, with streaks counted up to the end of the week
    const habits = db.prepare('SELECT * FROM habits WHERE user_id = ? AND archived = 0 ORDER BY id').all(userId).map(h => {
      const set = new Set(db.prepare('SELECT day FROM habit_checks WHERE habit_id = ?').all(h.id).map(r => r.day));
      const scheduled = dayList.filter(d => h.schedule === 'weekdays' ? ![0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay()) : true);
      const prev = Array.from({ length: 7 }, (_, i) => addIso(from, i - 7)).filter(d => h.schedule === 'weekdays' ? ![0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay()) : true);
      const doneN = scheduled.filter(d => set.has(d)).length, prevN = prev.filter(d => set.has(d)).length;
      return { id: h.id, name: h.name, schedule: h.schedule, done: doneN, of: scheduled.length, previousDone: prevN, previousOf: prev.length, streak: streakAt(set, h.schedule, to > today ? today : to), createdBeforeWeek: h.created_at < t0 };
    });
    const habitsSec = { items: habits, empty: !habits.length, message: habits.length ? null : NOT_ENOUGH('you have no habits yet. Add one in Life Tracker.') };

    // spending vs budget
    const exp = db.prepare('SELECT amount_fils f, category c FROM expenses WHERE user_id = ? AND deleted_at IS NULL AND day >= ? AND day <= ?').all(userId, from, to);
    const total = exp.reduce((a, x) => a + x.f, 0), cat = {}; exp.forEach(x => { cat[x.c] = (cat[x.c] || 0) + x.f; });
    const budget = db.prepare("SELECT monthly_fils FROM budgets WHERE user_id = ? AND category = 'total'").get(userId);
    const mStart = to.slice(0, 7) + '-01', monthSpent = db.prepare('SELECT COALESCE(SUM(amount_fils), 0) f FROM expenses WHERE user_id = ? AND deleted_at IS NULL AND day >= ? AND day <= ?').get(userId, mStart, to).f;
    const spending = { totalFils: total, totalLabel: aed(total), count: exp.length, byCategory: Object.keys(cat).sort((a, b) => cat[b] - cat[a] || a.localeCompare(b)).map(k => ({ category: k, fils: cat[k], label: aed(cat[k]) })),
      budget: budget ? { monthlyFils: budget.monthly_fils, monthlyLabel: aed(budget.monthly_fils), monthToDateFils: monthSpent, monthToDateLabel: aed(monthSpent), usedPct: Math.round(100 * monthSpent / budget.monthly_fils), month: to.slice(0, 7), note: 'Month to date, up to the end of this week, against your monthly budget.' } : null,
      empty: !exp.length, message: exp.length ? null : NOT_ENOUGH('no spending was recorded this week.') , budgetMessage: budget ? null : 'No monthly budget is set, so nothing to compare with. Set one in Life Tracker.' };

    // things that slipped: past their due date at the end of this week and not finished by then
    const slipT = db.prepare("SELECT title, due, status, completed_at FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND due IS NOT NULL AND due <= ?").all(userId, to)
      .filter(x => x.status !== 'done' || (x.completed_at && x.completed_at >= dayStart(addIso(to, 1)))).map(x => ({ kind: 'Task', title: x.title, due: x.due, daysLate: Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(x.due + 'T12:00:00Z')) / 864e5) })).filter(x => x.daysLate >= 1);
    const slipP = rows.filter(c => c.deadline && c.deadline < to && (!['verified', 'completed', 'failed', 'cancelled'].includes(c.status) || (['verified', 'completed'].includes(c.status) && (trust.keptAt(c.id) || 0) >= dayStart(addIso(to, 1))))).map(c => ({ kind: 'Promise', title: c.title + (c.counterparty ? ' (to ' + c.counterparty + ')' : ''), due: c.deadline, daysLate: Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(c.deadline + 'T12:00:00Z')) / 864e5) }));
    const slippedAll = slipT.concat(slipP).sort((a, b) => b.daysLate - a.daysLate || a.title.localeCompare(b.title));
    const slipped = { total: slippedAll.length, items: slippedAll.slice(0, MAX_LIST), empty: !slippedAll.length, message: slippedAll.length ? null : 'Nothing slipped: no task or promise was past its date at the end of this week.' };

    // three suggestions for next week, by fixed rules (each printed with the item)
    const nextFrom = addIso(to, 1), nextTo = addIso(to, 7), cur = [];
    const rule1 = 'Rule 1: the item that is the most overdue.', rule2 = 'Rule 2: the open item with the nearest deadline in the next 7 days (' + nice(nextFrom) + ' to ' + nice(nextTo) + ').', rule3 = 'Rule 3: a habit you did at least 2 fewer times than the week before.';
    const openT = db.prepare("SELECT title, due FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'open' AND due IS NOT NULL").all(userId).map(x => ({ title: x.title, due: x.due, kind: 'Task' }));
    const openP = rows.filter(c => c.deadline && !['verified', 'completed', 'failed', 'cancelled'].includes(c.status)).map(c => ({ title: c.title + (c.counterparty ? ' (to ' + c.counterparty + ')' : ''), due: c.deadline, kind: 'Promise' }));
    const open = openT.concat(openP), over = open.filter(x => x.due <= to).sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title))[0];
    const taken = new Set();
    if (over) { cur.push({ rule: rule1, title: over.title, kind: over.kind, why: 'Due ' + nice(over.due) + ', ' + days(Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(over.due + 'T12:00:00Z')) / 864e5)) + ' overdue at the end of the week.' }); taken.add(over.kind + over.title); }
    else cur.push({ rule: rule1, title: null, kind: null, why: 'Nothing was overdue.' });
    const near = open.filter(x => x.due >= nextFrom && x.due <= nextTo && !taken.has(x.kind + x.title)).sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title))[0];
    cur.push(near ? { rule: rule2, title: near.title, kind: near.kind, why: 'Due ' + wd(near.due) + ' ' + nice(near.due) + '.' } : { rule: rule2, title: null, kind: null, why: 'Nothing is due in the next 7 days.' });
    const dropped = habits.filter(h => h.createdBeforeWeek && h.previousDone - h.done >= 2).sort((a, b) => (b.previousDone - b.done) - (a.previousDone - a.done) || a.name.localeCompare(b.name))[0];
    cur.push(dropped ? { rule: rule3, title: dropped.name, kind: 'Habit', why: 'Done ' + dropped.done + ' times this week, ' + dropped.previousDone + ' the week before.' } : { rule: rule3, title: null, kind: null, why: 'No habit dropped.' });
    const priorities = { items: cur, note: 'These are suggestions from three fixed rules. NOVA does not add anything for you.' };

    const week = { from, to, label: nice(from) + ' to ' + nice(to) + ' ' + to.slice(0, 4), inProgress: w.inProgress, note: w.inProgress ? 'This week is not over yet, so the numbers are so far.' : null };
    const weeks = Array.from({ length: WEEKS }, (_, i) => { const f = addIso(mondayOf(today), -7 * i), t = addIso(f, 6); return { from: f, to: t, label: nice(f) + ' to ' + nice(t) + ' ' + t.slice(0, 4) + (i === 0 ? ' (this week)' : i === 1 ? ' (last week)' : '') }; });
    const out = { week, weeks, finished, promises, focus, habits: habitsSec, spending, slipped, priorities };
    out.text = textOf(out); out.markdown = markdownOf(out);
    return out;
  }

  function lines(o, md) {
    const h = t => md ? '\n## ' + t + '\n' : '\n' + t.toUpperCase() + '\n', b = t => (md ? '- ' : '  - ') + t, out = [];
    out.push(md ? '# Weekly Review: ' + o.week.label : 'WEEKLY REVIEW: ' + o.week.label); if (o.week.note) out.push(o.week.note);
    out.push(h('What I finished')); out.push(o.finished.empty ? o.finished.message : 'Finished ' + o.finished.total + ' task' + (o.finished.total === 1 ? '' : 's') + '.'); if (!o.finished.empty) { o.finished.byDay.filter(x => x.count).forEach(x => out.push(b(x.weekday + ' ' + nice(x.date) + ': ' + x.count))); o.finished.items.slice(0, MAX_LIST).forEach(x => out.push(b(x.title))); }
    out.push(h('Promises')); if (o.promises.empty) out.push(o.promises.message); else { out.push('Kept on time ' + o.promises.onTime + ', late ' + o.promises.late + ', not kept ' + o.promises.notKept + ', still open ' + o.promises.stillOpen + '. Kept this week: ' + o.promises.keptThisWeek + '.'); o.promises.items.forEach(x => out.push(b(x.title + (x.counterparty ? ' (to ' + x.counterparty + ')' : '') + ', due ' + nice(x.deadline) + ': ' + ({ onTime: 'kept on time', late: 'kept late', notKept: 'not kept', stillOpen: 'still open', cancelled: 'cancelled', doneNoDeadline: 'done' }[x.result])))); }
    out.push(h('Focus time')); out.push(o.focus.empty ? o.focus.message : mins(o.focus.totalMin) + ' in ' + o.focus.sessions + ' session' + (o.focus.sessions === 1 ? '' : 's') + '.');
    out.push(h('Habits')); if (o.habits.empty) out.push(o.habits.message); else o.habits.items.forEach(x => out.push(b(x.name + ': ' + x.done + ' of ' + x.of + ' days, streak ' + days(x.streak) + ' (the week before: ' + x.previousDone + ' of ' + x.previousOf + ')')));
    out.push(h('Spending')); out.push(o.spending.empty ? o.spending.message : 'Spent ' + o.spending.totalLabel + ' in ' + o.spending.count + ' purchase' + (o.spending.count === 1 ? '' : 's') + '.'); o.spending.byCategory.forEach(x => out.push(b(x.category + ': ' + x.label)));
    out.push(o.spending.budget ? 'Month so far: ' + o.spending.budget.monthToDateLabel + ' of ' + o.spending.budget.monthlyLabel + ' (' + o.spending.budget.usedPct + '%).' : o.spending.budgetMessage);
    out.push(h('Things that slipped')); out.push(o.slipped.empty ? o.slipped.message : o.slipped.total + ' item' + (o.slipped.total === 1 ? '' : 's') + ' past their date at the end of the week.'); o.slipped.items.forEach(x => out.push(b(x.kind + ': ' + x.title + ', due ' + nice(x.due) + ', ' + days(x.daysLate) + ' late')));
    out.push(h('Three priorities for next week')); o.priorities.items.forEach((x, i) => out.push((md ? (i + 1) + '. ' : '  ' + (i + 1) + '. ') + (x.title ? x.kind + ': ' + x.title + '. ' : '') + x.why + ' (' + x.rule + ')')); out.push(o.priorities.note);
    return out.join('\n');
  }
  const textOf = o => lines(o, false) + '\n', markdownOf = o => lines(o, true) + '\n';

  function register(router) {
    router.get('/api/review', ctx => ({ status: 200, body: compute(ctx.auth.user.id, ctx.url.searchParams.get('week')) }));
  }
  return { compute, register, weekRange };
}
module.exports = { createReview, mondayOf };

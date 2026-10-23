// Productivity: "Plan my day" (fits your tasks and promises into today's working hours, with reasons), focus sessions
// (a timer on a task, recorded), and Weekly Insights (reliability score, done per day, focus per day, trends in plain words).
// Everything is computed from NOVA's own data, with Dubai time. No AI, no cost. Plans are suggestions: nothing is changed by planning.
'use strict';
const { HttpError, str } = require('./http');
const { audit } = require('./security');
const { parts, DAY, DAY_NAMES } = require('./daily/clock');
const { relDay } = require('./daily/briefing');

const addIso = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const at = (iso, min) => Date.parse(iso + 'T00:00:00+04:00') + min * 60e3;      // Dubai wall-clock minute of a day -> ms
const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const toMin = s => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : null; };
const dur = m => m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '') : m + 'm';

// Calendar events for the planned day, sent by the browser with the request (read from the calendar already in your browser).
// They are used for this one answer and never stored by NOVA. Timed events become fixed blocks; all-day events are only mentioned.
function cleanEvents(raw) {
  if (raw === undefined || raw === null) return null;
  const bad = () => new HttpError(400, 'The calendar events could not be read, so the plan was not changed. Try again without them.', 'invalid');
  if (!Array.isArray(raw) || raw.length > 40) throw bad();
  const timed = [], allDay = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw bad();
    const title = typeof e.title === 'string' && e.title.trim() ? e.title.replace(/\s+/g, ' ').trim().slice(0, 80) : 'Busy';
    if (e.allDay === true) { allDay.push(title); continue; }
    const s = toMin(e.start), en = e.end === '24:00' ? 1440 : toMin(e.end);
    if (s === null || en === null) throw bad();
    if (en > s) timed.push({ s, e: en, title });
  }
  timed.sort((a, b) => a.s - b.s || a.e - b.e);
  return { timed, allDay };
}

// A sensible guess when you have not set an estimate. It is always labelled as a guess.
function guessMinutes(title) {
  const t = String(title).toLowerCase();
  if (/\b(call|phone|ring|text|reply|email|e-mail|message|send|book|pay|confirm|remind)\b/.test(t)) return 15;
  if (/\b(review|check|read|update|fix|clean|organi[sz]e|plan)\b/.test(t)) return 30;
  if (/\b(write|prepare|study|draft|report|project|research|design|build|practi[sc]e|revise|presentation|essay|chapter)\b/.test(t)) return 60;
  return 30;
}

function createProductivity(cfg, db, deps) {
  const now = cfg.now, energy = (deps && deps.energy) || null;

  /* ---------------- plan my day ---------------- */
  function plan(user, o) {
    o = o || {};
    const start = toMin(o.start) ?? 9 * 60, end = toMin(o.end) ?? 18 * 60, lunch = o.lunch === false ? null : [13 * 60, 14 * 60];
    if (end - start < 60) throw new HttpError(400, 'The working day must be at least one hour long.', 'invalid');
    const t = now(), p = parts(t), nowMin = p.h * 60 + p.mi;
    let day = p.iso, from = start, note = null;
    if (nowMin >= end - 15) { day = addIso(p.iso, 1); note = 'Your working day is over, so this is a plan for tomorrow.'; }
    else if (nowMin > start) from = Math.ceil((nowMin + 5) / 15) * 15;
    const soon = addIso(day, 2), uid = user.id;
    const tasks = db.prepare("SELECT id, title, due, estimate_min, created_at FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'open'").all(uid);
    const promises = db.prepare("SELECT id, title, counterparty, deadline FROM commitments WHERE user_id = ? AND direction = 'i_owe' AND task_id IS NULL AND deadline IS NOT NULL AND deadline <= ? AND status NOT IN ('completed', 'failed', 'cancelled', 'verified', 'awaiting_confirmation')").all(uid, soon);
    const items = [];
    const push = (x, rank) => items.push(Object.assign(x, { rank }));
    tasks.filter(x => x.due && x.due < day).sort((a, b) => a.due.localeCompare(b.due)).forEach(x => push({ kind: 'task', taskId: x.id, title: x.title, why: 'Overdue (' + relDay(x.due, day) + ')', est: x.estimate_min }, 0));
    promises.filter(c => c.deadline < day).forEach(c => push({ kind: 'promise', commitmentId: c.id, title: c.title, why: 'You promised ' + (c.counterparty || 'someone') + ' and it is ' + relDay(c.deadline, day), est: 30 }, 0));
    tasks.filter(x => x.due === day).forEach(x => push({ kind: 'task', taskId: x.id, title: x.title, why: 'Due today', est: x.estimate_min }, 1));
    promises.filter(c => c.deadline === day).forEach(c => push({ kind: 'promise', commitmentId: c.id, title: c.title, why: 'Promised to ' + (c.counterparty || 'someone') + ' for today', est: 30 }, 1));
    promises.filter(c => c.deadline > day).forEach(c => push({ kind: 'promise', commitmentId: c.id, title: c.title, why: 'Promised to ' + (c.counterparty || 'someone') + ' for ' + relDay(c.deadline, day), est: 30 }, 2));
    tasks.filter(x => x.due && x.due > day && x.due <= soon).sort((a, b) => a.due.localeCompare(b.due)).forEach(x => push({ kind: 'task', taskId: x.id, title: x.title, why: 'Due ' + relDay(x.due, day), est: x.estimate_min }, 2));
    tasks.filter(x => !x.due).sort((a, b) => a.created_at - b.created_at).slice(0, 3).forEach(x => push({ kind: 'task', taskId: x.id, title: x.title, why: 'No date; one of your oldest open tasks', est: x.estimate_min }, 3));

    if (o.eventsDay && o.eventsDay !== day) throw new HttpError(409, 'The planned day changed while your calendar was being read. Try again.', 'day_changed');
    const ev = o.events || null, busy = [];
    if (ev) for (const x of ev.timed) { const s = Math.max(x.s, from), e = Math.min(x.e, end); if (e > s) busy.push([s, e, x.title]); }
    const blocks = [], unscheduled = [], skipped = []; let cur = from, sinceBreak = 0, lunchDone = !lunch || from >= lunch[1];
    for (const b of busy) blocks.push({ start: hm(b[0]), end: hm(b[1]), kind: 'event', title: b[2], why: 'Fixed: a calendar event', fixed: true });
    // Lunch is protected: a block that would reach into it starts after it, and the lunch block is shown once.
    const pastLunch = (s0, minutes) => {
      if (lunchDone || (s0 < lunch[0] && s0 + minutes <= lunch[0])) return s0;
      blocks.push({ start: hm(Math.max(s0, lunch[0], from)), end: hm(lunch[1]), kind: 'lunch', title: 'Lunch', why: 'Protected time' }); lunchDone = true; sinceBreak = 0;
      return Math.max(s0, lunch[1]);
    };
    // My own energy pattern (only when I switched it on and there are 7 days of marks): hard tasks (60 minutes or more) are tried in my high-energy hours.
    // Urgency still comes first: the order only changes inside a group of items with the same urgency.
    const wins = energy ? energy.windows(uid) : null, HARD = 60, inHigh = m => !!wins && wins.some(w => m >= w[0] && m < w[1]);
    const minOf = it => Math.min(it.est || guessMinutes(it.title), 180);
    let ordered = items;
    if (wins && wins.length) {
      ordered = []; let cursor = from, lunchSeen = !lunch || from >= lunch[1];
      for (const rank of [0, 1, 2, 3]) {
        const group = items.filter(x => x.rank === rank), hard = group.filter(x => minOf(x) >= HARD), easy = group.filter(x => minOf(x) < HARD);
        while (hard.length || easy.length) {
          const pick = (inHigh(cursor) ? (hard.length ? hard : easy) : (easy.length ? easy : hard)).shift();
          ordered.push(pick); cursor += minOf(pick) + 10;
          if (!lunchSeen && lunch && cursor > lunch[0]) { cursor += lunch[1] - lunch[0]; lunchSeen = true; }
        }
      }
    }
    for (const it of ordered) {
      const minutes = Math.min(it.est || guessMinutes(it.title), 180), guessed = !it.est;
      if (sinceBreak >= 90 && cur + 10 <= end && (lunchDone || cur + 10 <= lunch[0])) { blocks.push({ start: hm(cur), end: hm(cur + 10), kind: 'break', title: 'Short break', why: 'After 90 minutes of focus' }); cur += 10; sinceBreak = 0; }
      const before = blocks.length, wasDone = lunchDone; let s0 = pastLunch(cur, minutes);
      for (let guard = 0; guard < 60; guard++) { const hit = busy.find(b => b[0] < s0 + minutes && b[1] > s0); if (!hit) break; s0 = pastLunch(hit[1], minutes); }      // never over a fixed event
      if (s0 + minutes > end) {
        if (blocks.length > before) { blocks.length = before; lunchDone = wasDone; }        // do not add lunch just for an item that is skipped
        skipped.push({ it, minutes, guessed });
        unscheduled.push({ title: it.title, why: it.why + '. Needs ' + dur(minutes) + (guessed ? ' (estimated)' : '') + ', which does not fit in the time left.', taskId: it.taskId || null });
        continue;
      }
      blocks.push({ start: hm(s0), end: hm(s0 + minutes), kind: it.kind, title: it.title, why: it.why + (minutes >= HARD && inHigh(s0) ? '. Placed in your high-energy time' : ''), minutes, guessed, taskId: it.taskId || null, commitmentId: it.commitmentId || null });
      cur = s0 + minutes + 10; sinceBreak += minutes;
    }
    // With calendar events there can be free gaps between them: what did not fit in order may still fit in an earlier gap (most urgent first).
    if (busy.length && skipped.length) {
      for (const sk of skipped) {
        const taken = blocks.filter(b => b.kind !== 'break').map(b => [toMin(b.start), toMin(b.end)]).sort((a, b) => a[0] - b[0]);
        const starts = [from].concat(taken.map(t => t[1])).filter(x => x >= from).sort((a, b) => a - b);
        const s0 = starts.find(s => s + sk.minutes <= end && !taken.some(t => t[0] < s + sk.minutes && t[1] > s));
        if (s0 === undefined) continue;
        blocks.push({ start: hm(s0), end: hm(s0 + sk.minutes), kind: sk.it.kind, title: sk.it.title, why: sk.it.why, minutes: sk.minutes, guessed: sk.guessed, taskId: sk.it.taskId || null, commitmentId: sk.it.commitmentId || null });
        const i = unscheduled.findIndex(u => u.title === sk.it.title && u.taskId === (sk.it.taskId || null)); if (i >= 0) unscheduled.splice(i, 1);
      }
    }
    blocks.sort((a, b) => a.start.localeCompare(b.start));
    const planned = blocks.filter(b => b.minutes).reduce((a, b) => a + b.minutes, 0), windowMin = end - from - (lunch && from < lunch[1] ? lunch[1] - Math.max(from, lunch[0]) : 0);
    // minutes taken by events (overlaps counted once, and the lunch hour not counted twice)
    let busyMin = 0, edge = -1;
    for (const b of busy) { const s = Math.max(b[0], edge), e = b[1]; if (e > s) { busyMin += e - s; if (lunch) busyMin -= Math.max(0, Math.min(e, lunch[1]) - Math.max(s, lunch[0])); edge = Math.max(edge, e); } }
    busyMin = Math.max(0, busyMin);
    const work = blocks.find(b => b.minutes);
    const cal = ev ? { used: true, events: busy.length, allDay: ev.allDay.slice(0, 10), busyMin } : null;
    const around = cal && (cal.events || cal.allDay.length) ? ' Planned around ' + (cal.events ? cal.events + ' calendar event' + (cal.events === 1 ? '' : 's') + ' (' + dur(busyMin) + ' busy)' : 'no timed calendar events') + (cal.allDay.length ? ', plus ' + cal.allDay.length + ' all-day event' + (cal.allDay.length === 1 ? '' : 's') + ' that do not block time' : '') + '.' : '';
    const summary = (!items.length ? 'Nothing is due or overdue. Your time is yours: pick something you care about.' :
      'Planned ' + blocks.filter(b => b.minutes).length + ' of ' + items.length + ' item' + (items.length === 1 ? '' : 's') + ' (' + dur(planned) + ' of focused work)' + (unscheduled.length ? '; ' + unscheduled.length + ' do' + (unscheduled.length === 1 ? 'es' : '') + ' not fit.' : '.') + (work ? ' Start with "' + work.title + '" at ' + work.start + '.' : '')) + around;
    return { energy: wins && wins.length ? { used: true, windows: wins.map(w => hm(w[0]) + ' to ' + hm(w[1])), note: 'Hard tasks (60 minutes or more) are placed in your usual high-energy time when they fit. Urgent items still come first.' } : null, day, weekday: DAY_NAMES[new Date(day + 'T12:00:00Z').getUTCDay()], window: { start: hm(start), end: hm(end), from: hm(from), lunch: lunch ? [hm(lunch[0]), hm(lunch[1])] : null }, blocks, unscheduled, totals: { plannedMin: planned, freeMin: Math.max(0, windowMin - planned - busyMin) }, calendar: cal, note, summary, generatedAt: t };
  }

  /* ---------------- focus sessions ---------------- */
  function settle(userId) {      // a session left running long past its end (you walked away) is closed at its planned end
    db.prepare("UPDATE focus_sessions SET status = 'completed', ended_at = started_at + planned_min * 60000, note = COALESCE(note, 'Closed automatically at its planned end.') WHERE user_id = ? AND status = 'running' AND ? > started_at + (planned_min + 60) * 60000").run(userId, now());
  }
  const fview = f => ({ id: f.id, title: f.title, taskId: f.task_id, plannedMin: f.planned_min, startedAt: f.started_at, endsAt: f.started_at + f.planned_min * 60e3, endedAt: f.ended_at, status: f.status, note: f.note,
    minutes: Math.round(((f.ended_at || Math.min(now(), f.started_at + f.planned_min * 60e3)) - f.started_at) / 60e3), remainingMs: f.status === 'running' ? Math.max(0, f.started_at + f.planned_min * 60e3 - now()) : 0 });
  function focusState(userId) {
    settle(userId);
    const p = parts(now()), dayStart = at(p.iso, 0), weekStart = at(addIso(p.iso, -((p.wd + 6) % 7)), 0);
    const running = db.prepare("SELECT * FROM focus_sessions WHERE user_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1").get(userId);
    const today = db.prepare('SELECT * FROM focus_sessions WHERE user_id = ? AND started_at >= ? ORDER BY id DESC').all(userId, dayStart).map(fview);
    const week = db.prepare("SELECT * FROM focus_sessions WHERE user_id = ? AND started_at >= ? AND status != 'running'").all(userId, weekStart).map(fview);
    return { running: running ? fview(running) : null, today, todayMin: today.filter(f => f.status !== 'running').reduce((a, f) => a + f.minutes, 0), weekMin: week.reduce((a, f) => a + f.minutes, 0) };
  }

  /* ---------------- weekly insights ---------------- */
  function insights(user) {
    const uid = user.id, t = now(), p = parts(t), monday = addIso(p.iso, -((p.wd + 6) % 7)), lastMonday = addIso(monday, -7);
    const span = (iso, days) => [at(iso, 0), at(addIso(iso, days), 0)];
    const doneIn = (a, b) => db.prepare("SELECT title, due, completed_at FROM tasks WHERE user_id = ? AND status = 'done' AND deleted_at IS NULL AND completed_at >= ? AND completed_at < ?").all(uid, a, b);
    const focusIn = (a, b) => db.prepare("SELECT started_at, ended_at, planned_min, status FROM focus_sessions WHERE user_id = ? AND status != 'running' AND started_at >= ? AND started_at < ?").all(uid, a, b)
      .reduce((acc, f) => acc + Math.round(((f.ended_at || f.started_at + f.planned_min * 60e3) - f.started_at) / 60e3), 0);
    const [w0, w1] = span(monday, 7), [l0, l1] = span(lastMonday, 7);
    const days = Array.from({ length: 7 }, (_, i) => { const iso = addIso(monday, i), [a, b] = span(iso, 1); return { day: iso, label: DAY_NAMES[new Date(iso + 'T12:00:00Z').getUTCDay()].slice(0, 3), done: doneIn(a, b).length, focusMin: focusIn(a, b), future: iso > p.iso }; });
    const thisDone = doneIn(w0, w1), lastDone = doneIn(l0, l1);
    const onTime = list => list.filter(x => x.due).length ? Math.round(100 * list.filter(x => x.due && x.completed_at < at(addIso(x.due, 1), 0)).length / list.filter(x => x.due).length) : null;
    const thisFocus = focusIn(w0, w1), lastFocus = focusIn(l0, l1);
    // Reliability: promises with a deadline that you closed in the last 28 days, kept on or before the deadline.
    const closed = db.prepare("SELECT title, deadline, closed_at, status FROM commitments WHERE user_id = ? AND direction = 'i_owe' AND deadline IS NOT NULL AND status IN ('completed', 'verified') AND closed_at >= ?").all(uid, t - 28 * DAY);
    const late = db.prepare("SELECT title, deadline FROM commitments WHERE user_id = ? AND direction = 'i_owe' AND deadline IS NOT NULL AND deadline < ? AND status NOT IN ('completed', 'verified', 'failed', 'cancelled') ORDER BY deadline").all(uid, p.iso);
    const kept = closed.filter(c => c.closed_at < at(addIso(c.deadline, 1), 0)).length, judged = closed.length + late.length;
    const reliability = judged >= 3 ? Math.round(100 * kept / judged) : null;
    const overdueTasks = db.prepare("SELECT title, due FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'open' AND due IS NOT NULL AND due < ? ORDER BY due").all(uid, p.iso);
    const lines = [];
    if (thisFocus || lastFocus) lines.push(lastFocus && thisFocus ? 'Focus time is ' + (thisFocus >= lastFocus ? 'up ' : 'down ') + Math.abs(Math.round(100 * (thisFocus - lastFocus) / lastFocus)) + '% on last week (' + dur(thisFocus) + ' vs ' + dur(lastFocus) + ').' : thisFocus ? dur(thisFocus) + ' of focused work so far this week.' : 'No focus sessions yet this week (' + dur(lastFocus) + ' last week).');
    const best = days.filter(d => d.done >= 2).sort((a, b) => b.done - a.done)[0];
    if (best) lines.push(DAY_NAMES[new Date(best.day + 'T12:00:00Z').getUTCDay()] + ' was your most productive day (' + best.done + ' tasks done).');
    if (lastDone.length || thisDone.length) lines.push('You finished ' + thisDone.length + ' task' + (thisDone.length === 1 ? '' : 's') + ' this week' + (lastDone.length ? ' (' + lastDone.length + ' last week)' : '') + '.');
    if (reliability !== null) lines.push('You kept ' + kept + ' of ' + judged + ' promises on time over the last four weeks (' + reliability + '%).');
    else if (judged) lines.push('Not enough closed promises yet for a reliability score (it needs at least 3).');
    const lateAll = overdueTasks.map(x => ({ title: x.title, date: x.due })).concat(late.map(c => ({ title: c.title, date: c.deadline }))).sort((a, b) => a.date.localeCompare(b.date));
    if (lateAll.length) lines.push(lateAll.length + ' item' + (lateAll.length === 1 ? ' is' : 's are') + ' overdue; the oldest is "' + lateAll[0].title + '" (' + relDay(lateAll[0].date, p.iso) + ').');
    if (!lines.length) lines.push('A quiet week so far. "Plan my day" is a good way to start.');
    return { week: { start: monday, end: addIso(monday, 6) }, days, totals: { done: thisDone.length, doneLastWeek: lastDone.length, onTimePct: onTime(thisDone), focusMin: thisFocus, focusMinLastWeek: lastFocus, overdue: lateAll.length },
      reliability: { score: reliability, kept, judged, windowDays: 28 }, lines, spoken: lines.join(' '), generatedAt: t };
  }

  function register(router) {
    router.get('/api/plan', ctx => {
      const q = ctx.url.searchParams, o = { start: q.get('start') || undefined, end: q.get('end') || undefined, lunch: q.get('lunch') === 'off' ? false : true };
      if ((o.start && toMin(o.start) === null) || (o.end && toMin(o.end) === null)) throw new HttpError(400, 'Times must be HH:MM (24-hour, Dubai time).', 'invalid');
      const proposal = plan(ctx.auth.user, o), saved = db.prepare('SELECT data, created_at FROM day_plans WHERE user_id = ? AND day = ?').get(ctx.auth.user.id, proposal.day);
      return { status: 200, body: { proposal, saved: saved ? Object.assign(JSON.parse(saved.data), { savedAt: saved.created_at }) : null } };
    });
    // The same proposal, planned around the calendar events the browser sends for that one day. Read-only: the events are not stored.
    router.post('/api/plan/propose', ctx => {
      const b = ctx.body, o = { start: b.start, end: b.end, lunch: b.lunch !== false, events: cleanEvents(b.events), eventsDay: typeof b.day === 'string' ? b.day : undefined };
      if ((o.start && toMin(o.start) === null) || (o.end && toMin(o.end) === null)) throw new HttpError(400, 'Times must be HH:MM (24-hour, Dubai time).', 'invalid');
      const proposal = plan(ctx.auth.user, o), saved = db.prepare('SELECT data, created_at FROM day_plans WHERE user_id = ? AND day = ?').get(ctx.auth.user.id, proposal.day);
      return { status: 200, body: { proposal, saved: saved ? Object.assign(JSON.parse(saved.data), { savedAt: saved.created_at }) : null } };
    });
    router.post('/api/plan', ctx => {
      const o = { start: ctx.body.start, end: ctx.body.end, lunch: ctx.body.lunch !== false, events: cleanEvents(ctx.body.events), eventsDay: typeof ctx.body.day === 'string' ? ctx.body.day : undefined }, pr = plan(ctx.auth.user, o);
      // Calendar events are never kept: the saved plan keeps only that the time was busy (no title), and all-day titles are dropped.
      for (const b of pr.blocks) if (b.kind === 'event') b.title = 'Busy (calendar)';
      if (pr.calendar) pr.calendar.allDay = pr.calendar.allDay.map(() => 'All-day event');
      db.prepare('INSERT INTO day_plans (user_id, day, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET data = excluded.data, created_at = excluded.created_at').run(ctx.auth.user.id, pr.day, JSON.stringify(pr), now());
      audit(db, now, ctx.auth.user.id, 'day_plan_saved', pr.day + ': ' + pr.blocks.length + ' blocks', ctx.req.socket.remoteAddress);
      return { status: 201, body: { saved: pr } };
    });
    router.patch('/api/tasks/:id/estimate', ctx => {
      const m = ctx.body.minutes;
      if (m !== null && !(Number.isInteger(m) && m >= 5 && m <= 480)) throw new HttpError(400, 'Choose a whole number of minutes from 5 to 480, or leave it empty.', 'invalid');
      const r = db.prepare('UPDATE tasks SET estimate_min = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL').run(m, +ctx.params.id, ctx.auth.user.id);
      if (!r.changes) throw new HttpError(404, 'Task not found.', 'not_found');
      return { status: 200, body: { ok: true, minutes: m } };
    });
    router.get('/api/focus', ctx => ({ status: 200, body: focusState(ctx.auth.user.id) }));
    router.post('/api/focus/start', ctx => {
      const uid = ctx.auth.user.id; settle(uid);
      if (db.prepare("SELECT id FROM focus_sessions WHERE user_id = ? AND status = 'running'").get(uid)) throw new HttpError(409, 'A focus session is already running. Stop it first.', 'already_running');
      const minutes = ctx.body.minutes === undefined ? 25 : ctx.body.minutes;
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 180) throw new HttpError(400, 'Choose a whole number of minutes from 5 to 180.', 'invalid');
      let title = ctx.body.title === undefined ? null : str(ctx.body.title, 'title', { max: 200 }), taskId = null;
      if (ctx.body.taskId !== undefined && ctx.body.taskId !== null) {
        const tk = db.prepare("SELECT id, title FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(+ctx.body.taskId, uid);
        if (!tk) throw new HttpError(404, 'Task not found.', 'not_found');
        taskId = tk.id; title = title || tk.title;
      }
      const r = db.prepare("INSERT INTO focus_sessions (user_id, task_id, title, planned_min, started_at, status) VALUES (?, ?, ?, ?, ?, 'running')").run(uid, taskId, title || 'Focus', minutes, now());
      return { status: 201, body: { session: fview(db.prepare('SELECT * FROM focus_sessions WHERE id = ?').get(Number(r.lastInsertRowid))) } };
    });
    router.post('/api/focus/:id/stop', ctx => {
      const uid = ctx.auth.user.id, f = db.prepare("SELECT * FROM focus_sessions WHERE id = ? AND user_id = ?").get(+ctx.params.id, uid);
      if (!f) throw new HttpError(404, 'Focus session not found.', 'not_found');
      if (f.status !== 'running') return { status: 200, body: { session: fview(f) } };
      const end = Math.min(now(), f.started_at + f.planned_min * 60e3), full = end >= f.started_at + f.planned_min * 60e3 || ctx.body.completed === true;
      db.prepare('UPDATE focus_sessions SET status = ?, ended_at = ?, note = ? WHERE id = ?').run(full ? 'completed' : 'stopped', end, ctx.body.note ? String(ctx.body.note).slice(0, 300) : null, f.id);
      return { status: 200, body: { session: fview(db.prepare('SELECT * FROM focus_sessions WHERE id = ?').get(f.id)) } };
    });
    router.get('/api/insights', ctx => ({ status: 200, body: insights(ctx.auth.user) }));
  }
  return { plan, insights, focusState, register, guessMinutes };
}
module.exports = { createProductivity, guessMinutes };

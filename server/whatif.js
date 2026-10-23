// "What if I say yes?": type a possible commitment ("Join the Friday workshop 2pm to 5pm") and see, WITHOUT changing anything, what it would do to
// that day: clashes with your calendar, free hours left, tasks and promises that become tight, and the one most at-risk item. Fixed rules, Dubai time,
// every number comes with the rule behind it. Calendar events are sent by the browser for this one answer and are never stored.
'use strict';
const { HttpError } = require('./http');
const { parts } = require('./daily/clock');
const { parseDue } = require('./agent/planner');
const { guessMinutes } = require('./productivity');

const WORK = [[9 * 60, 13 * 60], [14 * 60, 18 * 60]], CAPACITY = 480, TIGHT_BELOW = 60, PROMISE_TIGHT_BELOW = 120, PROMISE_GUESS = 30, MAX_TEXT = 300, MAX_EVENTS = 100;
const RULES = [
  'Working time is 09:00 to 18:00 with 13:00 to 14:00 off: 8 hours a day.',
  'Busy time = your calendar events that day plus the new commitment, overlaps counted once.',
  'Work waiting = open tasks due that day (their estimate, or a labelled guess) plus 30 minutes for each of your open promises due that day.',
  'Free time = 8 hours minus busy time minus work waiting. Under 1 hour is "tight"; below zero is "overbooked".',
  'A clash is any overlap in time with a calendar event; back-to-back is not a clash.'
];
const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const toMin = s => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : s === '24:00' ? 1440 : null; };
const hours = m => (Math.round(m / 6) / 10) + ' h';
const DAYW = '(?:today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\\d{4}-\\d{2}-\\d{2})';

function clock(h, mi, ap) {
  h = +h; mi = +(mi || 0); if (mi > 59 || h > 24) return null;
  if (ap) { if (h < 1 || h > 12) return null; h = h % 12 + (/^p/i.test(ap) ? 12 : 0); }
  return h * 60 + mi;
}
// Finds the day, the time (a range, or a start plus "for 2 hours") and the length. Returns { title, date, start, end, minutes, timed, guess }.
function parseProposal(text, nowMs) {
  let t = ' ' + String(text).replace(/\s+/g, ' ').trim() + ' ';
  if (!t.trim()) throw new HttpError(400, 'Type what you might say yes to, for example "Join the Friday workshop 2pm to 5pm".', 'invalid');
  if (t.length > MAX_TEXT + 2) throw new HttpError(400, 'That is too long. Keep it to one sentence (under ' + MAX_TEXT + ' characters).', 'too_long');
  const dm = new RegExp('\\s(?:on|by|this|next|for)?\\s*(' + DAYW + ')\\b', 'i').exec(t);
  if (!dm) throw new HttpError(400, 'Say which day it is, for example "Friday", "tomorrow" or 2026-10-30.', 'invalid');
  const date = parseDue(dm[1].toLowerCase(), nowMs);
  if (!date) throw new HttpError(400, 'Say which day it is, for example "Friday", "tomorrow" or 2026-10-30.', 'invalid');
  if (date < parts(nowMs).iso) throw new HttpError(400, 'That day has already passed. Choose today or a later day.', 'invalid');
  t = t.replace(dm[0], ' ');
  let start = null, end = null, minutes = null, timed = false, guess = false;
  const rg = /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|until|till|-|–)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(t);
  if (rg) {
    let ap1 = rg[3], ap2 = rg[6];
    if (!ap1 && ap2) ap1 = ap2;                                         // "2-5pm" is 2pm to 5pm
    let s = clock(rg[1], rg[2], ap1), e = clock(rg[4], rg[5], ap2 || ap1);
    if (s === null || e === null) throw new HttpError(400, 'I could not read that time. Try "2pm to 5pm" or "14:00 to 17:00".', 'invalid');
    if (!ap1 && !ap2 && +rg[1] <= 12 && +rg[4] <= 12 && +rg[1] < 7) { s += 720; e += 720; guess = true; }   // "2-5" with no am or pm: afternoon (said in the rules)
    if (!ap1 && !ap2 && e <= s && +rg[4] <= 12) { e += 720; guess = true; }
    if (e <= s) throw new HttpError(400, 'The end time must be after the start time.', 'invalid');
    start = s; end = e; minutes = e - s; timed = true; t = t.replace(rg[0], ' ');
  } else {
    const st = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\bat\s+(\d{1,2}):(\d{2})\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/i.exec(t);
    const du = /\bfor\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i.exec(t);
    if (du) { minutes = Math.round(parseFloat(du[1]) * (/^h/i.test(du[2]) ? 60 : 1)); t = t.replace(du[0], ' '); }
    if (st) {
      const s = st[3] ? clock(st[1], st[2], st[3]) : st[4] ? clock(st[4], st[5]) : clock(st[6], st[7]);
      if (s === null) throw new HttpError(400, 'I could not read that time. Try "2pm" or "14:00".', 'invalid');
      if (minutes === null) { minutes = 60; guess = true; }
      start = s; end = s + minutes; timed = true; t = t.replace(st[0], ' ');
      if (end > 1440) throw new HttpError(400, 'It would run past midnight. Choose an earlier start or a shorter length.', 'invalid');
    }
  }
  if (minutes === null) { minutes = guessMinutes(t); guess = true; }
  if (minutes < 5 || minutes > 720) throw new HttpError(400, 'The length must be between 5 minutes and 12 hours.', 'invalid');
  const title = t.replace(/\b(?:at|on|from|for|by)\s*$/i, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:please\s+|i\s+(?:could|might|may|would)\s+)/i, '').slice(0, 120) || 'New commitment';
  return { title, date, start, end, minutes, timed, guess };
}

function cleanEvents(raw, date) {
  if (raw === undefined || raw === null) return null;
  const bad = () => new HttpError(400, 'The calendar events could not be read, so nothing was checked against them. Try again without them.', 'invalid');
  if (!Array.isArray(raw) || raw.length > MAX_EVENTS) throw bad();
  const timed = []; let allDay = 0;
  for (const e of raw) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw bad();
    if (e.date !== date) continue;
    const title = typeof e.title === 'string' && e.title.trim() ? e.title.replace(/\s+/g, ' ').trim().slice(0, 80) : 'Busy';
    if (e.allDay === true) { allDay++; continue; }
    const s = toMin(e.start), en = toMin(e.end);
    if (s === null || en === null) throw bad();
    if (en > s) timed.push({ s, e: en, title });
  }
  return { timed: timed.sort((a, b) => a.s - b.s || a.e - b.e), allDay };
}
// minutes of working time covered by the intervals, overlaps counted once
function busyMin(intervals) {
  let total = 0;
  for (const [ws, we] of WORK) {
    const clip = intervals.map(i => [Math.max(i.s, ws), Math.min(i.e, we)]).filter(i => i[1] > i[0]).sort((a, b) => a[0] - b[0]);
    let cur = null;
    for (const i of clip) { if (!cur || i[0] > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = i.slice(); } else cur[1] = Math.max(cur[1], i[1]); }
    if (cur) total += cur[1] - cur[0];
  }
  return total;
}

function createWhatIf(cfg, db) {
  const now = cfg.now;
  function simulate(user, body) {
    const p = parseProposal(body.text, now()), ev = body.calendar === true ? cleanEvents(body.events, p.date) : null;
    const events = ev ? ev.timed : [];
    const tasks = db.prepare("SELECT title, estimate_min FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'open' AND due = ?").all(user.id, p.date).map(x => ({ title: x.title, minutes: x.estimate_min || guessMinutes(x.title), guess: !x.estimate_min }));
    const promises = db.prepare("SELECT title, counterparty, deadline FROM commitments WHERE user_id = ? AND direction = 'i_owe' AND task_id IS NULL AND deadline IN (?, ?) AND status NOT IN ('verified', 'completed', 'failed', 'cancelled') ORDER BY deadline, id").all(user.id, p.date, nextDay(p.date));
    const dueToday = promises.filter(c => c.deadline === p.date);
    const need = tasks.reduce((n, x) => n + x.minutes, 0) + dueToday.length * PROMISE_GUESS;
    const me = p.timed ? [{ s: p.start, e: p.end, title: p.title }] : [];
    const busyBefore = busyMin(events), busyAfter = busyMin(events.concat(me));
    const usesWork = p.timed ? busyAfter - busyBefore : 0;                // untimed items take their minutes as work waiting instead
    const extra = p.timed ? 0 : p.minutes;
    const freeBefore = CAPACITY - busyBefore - need, freeAfter = CAPACITY - busyAfter - need - extra;
    const clashes = p.timed ? events.filter(e => e.s < p.end && e.e > p.start).map(e => ({ title: e.title, start: hm(e.s), end: hm(Math.min(e.e, 1440)) })) : [];
    const lateOrEarly = p.timed && !(p.start < 18 * 60 && p.end > 9 * 60) ? 'It is outside your working hours (09:00 to 18:00), so it uses no working time.' : null;
    const tightTasks = freeAfter < TIGHT_BELOW ? tasks : [], tightPromises = freeAfter < PROMISE_TIGHT_BELOW ? promises : [];
    let atRisk = null;
    if (freeAfter < 0 && tasks.length) { const big = tasks.slice().sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title))[0]; atRisk = { kind: 'task', title: big.title, why: 'After this there is not enough time for everything due that day, and this is the biggest task (about ' + big.minutes + ' min' + (big.guess ? ', a guess' : '') + ').' }; }
    else if (freeAfter < 0 && dueToday.length) atRisk = { kind: 'promise', title: dueToday[0].title, why: 'After this there is not enough time for everything due that day, and this promise is due that day' + (dueToday[0].counterparty ? ' to ' + dueToday[0].counterparty : '') + '.' };
    else if (tightPromises.length) atRisk = { kind: 'promise', title: tightPromises[0].title, why: 'Free time that day would drop to ' + hours(Math.max(freeAfter, 0)) + ' and this promise is due ' + (tightPromises[0].deadline === p.date ? 'that day' : 'the next day') + (tightPromises[0].counterparty ? ' to ' + tightPromises[0].counterparty : '') + '.' };
    const verdict = clashes.length ? 'clash' : freeAfter < 0 ? 'overbooked' : freeAfter < TIGHT_BELOW ? 'tight' : 'fits';
    const say = { clash: 'It clashes with ' + clashes.map(c => '"' + c.title + '" (' + c.start + ' to ' + c.end + ')').join(' and ') + '.', overbooked: 'It would overbook that day: ' + hours(-freeAfter) + ' more work than there is time for.', tight: 'It fits, but that day would be tight: only ' + hours(freeAfter) + ' free.', fits: 'It fits. You would still have ' + hours(freeAfter) + ' free that day.' };
    return {
      proposal: { title: p.title, date: p.date, start: p.timed ? hm(p.start) : null, end: p.timed ? hm(p.end) : null, minutes: p.minutes, timed: p.timed, guess: p.guess, note: p.guess ? 'The length or the am/pm was guessed from your words. Say it exactly to be sure.' : null },
      verdict, summary: say[verdict] + (ev && !p.timed ? ' It has no time of day, so its ' + p.minutes + ' minutes count as work waiting.' : ''), outsideHours: lateOrEarly,
      calendar: { checked: !!ev, events: events.length, allDay: ev ? ev.allDay : 0, clashes, note: ev ? null : 'No calendar is connected in this browser, so clashes with a calendar could not be checked.' },
      capacity: { workMin: CAPACITY, busyBeforeMin: busyBefore, busyAfterMin: busyAfter, workWaitingMin: need + extra, freeBeforeMin: freeBefore, freeAfterMin: freeAfter, freeHoursAfter: Math.round(freeAfter / 6) / 10, usesWorkMin: usesWork },
      tight: { tasks: tightTasks.map(x => ({ title: x.title, minutes: x.minutes, guess: x.guess })), promises: tightPromises.map(c => ({ title: c.title, counterparty: c.counterparty, deadline: c.deadline })) },
      atRisk, rules: RULES, changed: 'Nothing was added or changed.'
    };
  }
  const nextDay = iso => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  function register(router) {
    router.post('/api/whatif', ctx => ({ status: 200, body: simulate(ctx.auth.user, ctx.body || {}) }));
  }
  return { simulate, register };
}
module.exports = { createWhatIf, parseProposal };

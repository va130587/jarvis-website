// Life tracker: timed reminders (delivered by the server: bell, browser pop-up, phone push), habits with daily check-ins
// and streaks, and expenses in AED with monthly budgets. Dubai time throughout. Free, no AI: phrases are parsed by fixed rules.
// Rule of thumb for reminders: a request with a CLOCK TIME ("at 6pm", "in 20 minutes") is a timed reminder;
// a request with only a DATE ("by Friday", "tomorrow") stays a task.
'use strict';
const { HttpError, str } = require('./http');
const { audit } = require('./security');
const { parts, DAY, DAY_NAMES, label } = require('./daily/clock');

const OFFSET = 4 * 3600e3, MIN = 60e3;
const addIso = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const at = (iso, minutes) => Date.parse(iso + 'T00:00:00+04:00') + minutes * MIN;
const WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PARTS_OF_DAY = { morning: 9 * 60, afternoon: 15 * 60, evening: 19 * 60, night: 21 * 60, tonight: 21 * 60 };
const aed = f => 'AED ' + (f / 100).toFixed(f % 100 ? 2 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// "6pm", "6:30 pm", "18:30", "noon", "midnight" -> minutes after midnight, or null
function clock(s) {
  s = String(s || '').trim().toLowerCase().replace(/\./g, '');
  if (s === 'noon' || s === 'midday') return 12 * 60;
  if (s === 'midnight') return 0;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s); if (!m) return null;
  let h = +m[1], mi = m[2] ? +m[2] : 0;
  if (mi > 59 || h > 23) return null;
  if (m[3]) { if (h < 1 || h > 12) return null; if (m[3] === 'pm' && h !== 12) h += 12; if (m[3] === 'am' && h === 12) h = 0; }
  else if (!m[2] && h <= 7) h += 12;                                   // "at 6" means 6 pm; nobody wants a 6 am surprise
  return h * 60 + mi;
}

// When should a reminder fire? Returns { dueAt, repeat } or null. Understands: in 20 minutes / in 2 hours / at 6pm / tonight /
// tomorrow at 9 / tomorrow morning / (on) friday at 10 / every day at 8 / every weekday at 7:30 / this evening.
function parseWhen(text, now) {
  const w = String(text || '').toLowerCase().trim().replace(/\s+/g, ' '), p = parts(now), today = p.iso;
  let m;
  if ((m = /^in (\d{1,3}|an?|one|half an) ?(minutes?|mins?|hours?|hrs?)$/.exec(w))) {
    const n = /^(an?|one)$/.test(m[1]) ? 1 : m[1] === 'half an' ? 0.5 : +m[1], ms = /^h/.test(m[2]) ? n * 60 * MIN : n * MIN;
    if (ms < MIN || ms > 30 * DAY) return null;
    return { dueAt: now + ms, repeat: 'none' };
  }
  const nextAt = (iso, minutes) => { let t = at(iso, minutes); if (t <= now) t = at(addIso(iso, 1), minutes); return t; };
  if ((m = /^(?:every day|daily|each day|every (morning|evening|night)) ?(?:at (.+))?$/.exec(w))) {
    const c = m[2] ? clock(m[2]) : m[1] ? PARTS_OF_DAY[m[1]] : null; if (c === null) return null;
    return { dueAt: nextAt(today, c), repeat: 'daily' };
  }
  if ((m = /^(?:every weekday|on weekdays|every working day) at (.+)$/.exec(w))) {
    const c = clock(m[1]); if (c === null) return null;
    let t = nextAt(today, c); while ([0, 6].includes(parts(t).wd)) t += DAY;
    return { dueAt: t, repeat: 'weekdays' };
  }
  if ((m = /^at (.+)$/.exec(w))) { const c = clock(m[1]); return c === null ? null : { dueAt: nextAt(today, c), repeat: 'none' }; }
  if (w === 'tonight' || w === 'this evening' || w === 'this afternoon' || w === 'this morning') {
    const c = PARTS_OF_DAY[w.replace('this ', '')]; const t = at(today, c); return t > now ? { dueAt: t, repeat: 'none' } : null;
  }
  if ((m = /^(?:(?:this )?(morning|afternoon|evening|tonight) )?at (.+?) (?:today|tonight)$/.exec(w))) { const c = clock(m[2]); return c === null ? null : { dueAt: nextAt(today, c), repeat: 'none' }; }
  if ((m = /^tomorrow (?:at (.+)|(morning|afternoon|evening|night))$/.exec(w))) {
    const c = m[1] ? clock(m[1]) : PARTS_OF_DAY[m[2]]; return c === null ? null : { dueAt: at(addIso(today, 1), c), repeat: 'none' };
  }
  if ((m = /^(?:on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?: (morning|afternoon|evening|night)| at (.+))$/.exec(w))) {
    const c = m[3] ? clock(m[3]) : PARTS_OF_DAY[m[2]]; if (c === null) return null;
    let d = (WD.indexOf(m[1]) - p.wd + 7) % 7, t = at(addIso(today, d), c); if (t <= now) t = at(addIso(today, d + 7), c);
    return { dueAt: t, repeat: 'none' };
  }
  return null;
}

// "45 aed", "AED 45.50", "45 dirhams", "45dhs", "45" -> fils (integer), or null
function parseMoney(s) {
  const m = /^(?:aed|dhs?|dirhams?)?\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*(?:aed|dhs?|dirhams?|dh)?$/i.exec(String(s || '').trim()); if (!m) return null;
  const v = Math.round(parseFloat(m[1].replace(',', '.')) * 100); return v > 0 && v <= 100000000 ? v : null;
}
const CATS = { food: /lunch|dinner|breakfast|coffee|cafe|restaurant|food|snack|meal|shawarma|karak|pizza|burger|talabat|deliveroo|noon food/i, transport: /taxi|careem|uber|metro|bus|nol|fuel|petrol|parking|salik|tram|ride/i,
  groceries: /grocer|supermarket|carrefour|lulu|spinneys|waitrose|vegetables|fruit|milk|bread/i, bills: /rent|dewa|electric|water bill|internet|du\b|etisalat|e&|phone bill|mobile|bill|insurance/i,
  shopping: /clothes|shoes|amazon|noon\b|shopping|mall|gift|electronics|laptop|headphones/i, health: /pharmacy|doctor|medicine|clinic|gym|dentist|hospital/i,
  learning: /book|course|udemy|coursera|exam|fees|tuition|stationery/i, fun: /cinema|movie|game|concert|netflix|spotify|outing|trip|ticket/i };
const CATEGORIES = Object.keys(CATS).concat('other');
const categorize = note => { for (const [c, rx] of Object.entries(CATS)) if (rx.test(note || '')) return c; return 'other'; };

function createLife(cfg, db, deps) {
  const now = cfg.now, notifier = deps.notifier;

  /* ---------------- reminders ---------------- */
  const rview = r => ({ id: r.id, text: r.text, dueAt: r.due_at, dueLabel: label(r.due_at) + ' (Dubai)', repeat: r.repeat, status: r.status, sentCount: r.sent_count, lastSentAt: r.last_sent_at });
  function nextDue(r) {
    let t = r.due_at;
    if (r.repeat === 'daily') { while (t <= now()) t += DAY; return t; }
    if (r.repeat === 'weekdays') { do { t += DAY; } while (t <= now() || [0, 6].includes(parts(t).wd)); return t; }
    return null;
  }
  // Called on every scheduler tick (every 30 s): delivers due reminders once each (the dedupe key covers retries and two processes).
  async function deliver() {
    for (const r of db.prepare("SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ? ORDER BY due_at LIMIT 50").all(now())) {
      const nd = nextDue(r);
      const claimed = db.prepare("UPDATE reminders SET status = ?, due_at = ?, sent_count = sent_count + 1, last_sent_at = ? WHERE id = ? AND status = 'pending' AND due_at = ?")
        .run(nd ? 'pending' : 'sent', nd || r.due_at, now(), r.id, r.due_at).changes;
      if (!claimed) continue;
      const late = now() - r.due_at > 15 * MIN;
      await notifier.notify(r.user_id, { kind: 'reminder', title: 'Reminder: ' + r.text, body: (late ? 'This was due ' + label(r.due_at) + ' (NOVA was not running then). ' : '') + (nd ? 'Next time: ' + label(nd) + '.' : 'Set by you in NOVA.'), link: '#life', dedupe: 'reminder-' + r.id + '-' + r.due_at, priority: 'high', tags: 'alarm_clock' });
    }
  }
  function createReminder(userId, o) {
    const r = db.prepare('INSERT INTO reminders (user_id, text, due_at, repeat, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, o.text, o.dueAt, o.repeat || 'none', now());
    return rview(db.prepare('SELECT * FROM reminders WHERE id = ?').get(Number(r.lastInsertRowid)));
  }

  /* ---------------- habits ---------------- */
  function habitStats(h, today) {
    const days = new Set(db.prepare('SELECT day FROM habit_checks WHERE habit_id = ?').all(h.id).map(r => r.day));
    const counts = d => h.schedule === 'weekdays' ? ![0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay()) : true;
    // current streak: consecutive scheduled days up to today (today may still be open without breaking it)
    let cur = 0, d = today; if (!days.has(d)) d = addIso(d, -1);
    for (let i = 0; i < 800; i++, d = addIso(d, -1)) { if (!counts(d)) continue; if (days.has(d)) cur++; else break; }
    let best = 0, run = 0; const sorted = [...days].sort(), first = sorted[0];
    if (first) for (let x = first; x <= today; x = addIso(x, 1)) { if (!counts(x)) continue; if (days.has(x)) { run++; best = Math.max(best, run); } else run = 0; }
    const grid = []; const start = addIso(today, -84 - ((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7));   // 12 full weeks + this week, Monday first
    for (let x = start; x <= today; x = addIso(x, 1)) grid.push({ day: x, done: days.has(x), scheduled: counts(x) });
    const last30 = Array.from({ length: 30 }, (_, i) => addIso(today, -i)).filter(counts), rate = last30.length ? Math.round(100 * last30.filter(x => days.has(x)).length / last30.length) : 0;
    return { id: h.id, name: h.name, schedule: h.schedule, doneToday: days.has(today), streak: cur, best, rate30: rate, total: days.size, grid };
  }
  const ownHabit = (uid, id) => { const h = db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ? AND archived = 0').get(id, uid); if (!h) throw new HttpError(404, 'Habit not found.', 'not_found'); return h; };
  function bestHabit(uid, name) {
    const q = String(name).toLowerCase().replace(/^my\s+/, '').trim(), all = db.prepare('SELECT * FROM habits WHERE user_id = ? AND archived = 0').all(uid);
    return all.find(h => h.name.toLowerCase() === q) || all.find(h => h.name.toLowerCase().includes(q) || q.includes(h.name.toLowerCase())) || null;
  }

  /* ---------------- money ---------------- */
  function monthSummary(uid, month) {         // month = 'YYYY-MM'
    const rows = db.prepare("SELECT category, SUM(amount_fils) f, COUNT(*) n FROM expenses WHERE user_id = ? AND deleted_at IS NULL AND substr(day, 1, 7) = ? GROUP BY category ORDER BY f DESC").all(uid, month);
    const total = rows.reduce((a, r) => a + r.f, 0);
    const [y, mo] = month.split('-').map(Number), prev = (mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0'));
    const prevTotal = db.prepare("SELECT COALESCE(SUM(amount_fils), 0) f FROM expenses WHERE user_id = ? AND deleted_at IS NULL AND substr(day, 1, 7) = ?").get(uid, prev).f;
    const budget = db.prepare("SELECT monthly_fils FROM budgets WHERE user_id = ? AND category = 'total'").get(uid);
    const p = parts(now()), dim = new Date(Date.UTC(y, mo, 0)).getUTCDate(), elapsed = month === p.iso.slice(0, 7) ? p.d : dim;
    return { month, total, totalLabel: aed(total), prevMonth: prev, prevTotal, prevLabel: aed(prevTotal), byCategory: rows.map(r => ({ category: r.category, fils: r.f, label: aed(r.f), count: r.n, share: total ? Math.round(100 * r.f / total) : 0 })),
      budget: budget ? { fils: budget.monthly_fils, label: aed(budget.monthly_fils), usedPct: Math.round(100 * total / budget.monthly_fils), leftLabel: aed(Math.max(0, budget.monthly_fils - total)), pacePct: Math.round(100 * elapsed / dim) } : null };
  }
  async function budgetCheck(uid) {
    const p = parts(now()), s = monthSummary(uid, p.iso.slice(0, 7)); if (!s.budget) return;
    for (const th of [100, 80]) if (s.budget.usedPct >= th) {
      await notifier.notify(uid, { kind: 'budget', title: th === 100 ? 'Budget used up for ' + s.month : '80% of your ' + s.month + ' budget is used', body: 'Spent ' + s.totalLabel + ' of ' + s.budget.label + (th === 100 ? '.' : ' with ' + (100 - s.budget.pacePct) + '% of the month still to go.'), link: '#life', dedupe: 'budget-' + s.month + '-' + th, tags: 'moneybag' });
      break;
    }
  }
  function addExpense(uid, o) {
    const r = db.prepare('INSERT INTO expenses (user_id, amount_fils, category, note, day, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, o.fils, o.category, o.note || null, o.day || parts(now()).iso, now());
    return Number(r.lastInsertRowid);
  }
  const eview = e => ({ id: e.id, fils: e.amount_fils, label: aed(e.amount_fils), category: e.category, note: e.note, day: e.day });

  /* ---------------- HTTP ---------------- */
  function register(router) {
    router.get('/api/life', ctx => {
      const uid = ctx.auth.user.id, today = parts(now()).iso;
      return { status: 200, body: {
        reminders: db.prepare("SELECT * FROM reminders WHERE user_id = ? AND (status = 'pending' OR last_sent_at > ?) ORDER BY status = 'pending' DESC, due_at LIMIT 60").all(uid, now() - 7 * DAY).map(rview),
        habits: db.prepare('SELECT * FROM habits WHERE user_id = ? AND archived = 0 ORDER BY id').all(uid).map(h => habitStats(h, today)),
        money: Object.assign(monthSummary(uid, today.slice(0, 7)), { recent: db.prepare('SELECT * FROM expenses WHERE user_id = ? AND deleted_at IS NULL ORDER BY day DESC, id DESC LIMIT 20').all(uid).map(eview) }),
        categories: CATEGORIES, today } };
    });
    router.post('/api/reminders', ctx => {
      const text = str(ctx.body.text, 'text', { max: 200 });
      let when;
      if (ctx.body.when !== undefined) { when = parseWhen(ctx.body.when, now()); if (!when) throw new HttpError(400, 'I could not understand that time. Try "at 6pm", "in 20 minutes", "tomorrow at 9" or "every weekday at 7:30".', 'invalid'); }
      else {
        const t = +ctx.body.dueAt, rep = ctx.body.repeat || 'none';
        if (!Number.isFinite(t) || t <= now() || t > now() + 366 * DAY) throw new HttpError(400, 'Pick a time in the future (within a year).', 'invalid');
        if (!['none', 'daily', 'weekdays'].includes(rep)) throw new HttpError(400, 'Choose how often to repeat: never, daily or weekdays.', 'invalid');
        when = { dueAt: t, repeat: rep };
      }
      const r = createReminder(ctx.auth.user.id, { text, dueAt: when.dueAt, repeat: when.repeat });
      audit(db, now, ctx.auth.user.id, 'reminder_created', '#' + r.id, ctx.req.socket.remoteAddress);
      return { status: 201, body: { reminder: r } };
    });
    router.post('/api/reminders/:id/cancel', ctx => {
      const r = db.prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending'").run(+ctx.params.id, ctx.auth.user.id);
      if (!r.changes) throw new HttpError(404, 'No pending reminder with that number.', 'not_found');
      return { status: 200, body: { ok: true } };
    });
    router.post('/api/reminders/:id/snooze', ctx => {
      const r = db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?').get(+ctx.params.id, ctx.auth.user.id);
      if (!r || r.status === 'cancelled') throw new HttpError(404, 'Reminder not found.', 'not_found');
      const mins = ctx.body.minutes === undefined ? 10 : ctx.body.minutes;
      if (!Number.isInteger(mins) || mins < 1 || mins > 1440) throw new HttpError(400, 'Choose a number of minutes from 1 to 1440.', 'invalid');
      const s = createReminder(ctx.auth.user.id, { text: r.text, dueAt: now() + mins * MIN, repeat: 'none' });
      return { status: 201, body: { reminder: s } };
    });
    router.post('/api/habits', ctx => {
      const name = str(ctx.body.name, 'name', { max: 60 }), schedule = ctx.body.schedule === 'weekdays' ? 'weekdays' : 'daily';
      if (db.prepare('SELECT COUNT(*) n FROM habits WHERE user_id = ? AND archived = 0').get(ctx.auth.user.id).n >= 20) throw new HttpError(400, 'You can track up to 20 habits.', 'invalid');
      if (bestHabit(ctx.auth.user.id, name) && bestHabit(ctx.auth.user.id, name).name.toLowerCase() === name.toLowerCase()) throw new HttpError(409, 'You already track that habit.', 'exists');
      const r = db.prepare('INSERT INTO habits (user_id, name, schedule, created_at) VALUES (?, ?, ?, ?)').run(ctx.auth.user.id, name, schedule, now());
      return { status: 201, body: { habit: habitStats(db.prepare('SELECT * FROM habits WHERE id = ?').get(Number(r.lastInsertRowid)), parts(now()).iso) } };
    });
    router.post('/api/habits/:id/check', ctx => {
      const h = ownHabit(ctx.auth.user.id, +ctx.params.id), today = parts(now()).iso, day = ctx.body.day || today;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today || day < addIso(today, -6)) throw new HttpError(400, 'You can check in for today or the last 6 days.', 'invalid');
      if (ctx.body.done === false) db.prepare('DELETE FROM habit_checks WHERE habit_id = ? AND day = ?').run(h.id, day);
      else db.prepare('INSERT OR IGNORE INTO habit_checks (habit_id, user_id, day, created_at) VALUES (?, ?, ?, ?)').run(h.id, h.user_id, day, now());
      return { status: 200, body: { habit: habitStats(h, today) } };
    });
    router.post('/api/habits/:id/archive', ctx => { const h = ownHabit(ctx.auth.user.id, +ctx.params.id); db.prepare('UPDATE habits SET archived = 1 WHERE id = ?').run(h.id); return { status: 200, body: { ok: true } }; });
    router.post('/api/expenses', ctx => {
      const fils = typeof ctx.body.amount === 'number' ? Math.round(ctx.body.amount * 100) : parseMoney(ctx.body.amount);
      if (!fils || fils <= 0 || fils > 100000000) throw new HttpError(400, 'Enter an amount in AED, for example 45 or 45.50.', 'invalid');
      const note = ctx.body.note ? str(ctx.body.note, 'note', { max: 120 }) : null, category = ctx.body.category || categorize(note);
      if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Unknown category.', 'invalid');
      const today = parts(now()).iso, day = ctx.body.day || today;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today) throw new HttpError(400, 'The date must be today or earlier (YYYY-MM-DD).', 'invalid');
      const id = addExpense(ctx.auth.user.id, { fils, category, note, day });
      return budgetCheck(ctx.auth.user.id).then(() => ({ status: 201, body: { expense: eview(db.prepare('SELECT * FROM expenses WHERE id = ?').get(id)) } }));
    });
    router.del('/api/expenses/:id', ctx => {
      const r = db.prepare('UPDATE expenses SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL').run(now(), +ctx.params.id, ctx.auth.user.id);
      if (!r.changes) throw new HttpError(404, 'Expense not found.', 'not_found');
      return { status: 200, body: { ok: true } };
    });
    router.post('/api/budget', ctx => {
      const fils = ctx.body.amount === null ? null : (typeof ctx.body.amount === 'number' ? Math.round(ctx.body.amount * 100) : parseMoney(ctx.body.amount));
      if (fils === null) { db.prepare("DELETE FROM budgets WHERE user_id = ? AND category = 'total'").run(ctx.auth.user.id); return { status: 200, body: { budget: null } }; }
      if (!fils || fils < 100) throw new HttpError(400, 'Enter a monthly budget in AED, for example 3000.', 'invalid');
      db.prepare("INSERT INTO budgets (user_id, category, monthly_fils) VALUES (?, 'total', ?) ON CONFLICT(user_id, category) DO UPDATE SET monthly_fils = excluded.monthly_fils").run(ctx.auth.user.id, fils);
      return budgetCheck(ctx.auth.user.id).then(() => ({ status: 200, body: { budget: monthSummary(ctx.auth.user.id, parts(now()).iso.slice(0, 7)).budget } }));
    });
  }

  /* ---------------- agent tools ---------------- */
  function registerTools(registry) {
    registry.register({ name: 'reminders.create', risk: 'write', description: 'Set a timed reminder for the owner. dueAt is a Unix time in milliseconds (Dubai is UTC+4). NOVA only notifies the owner.',
      schema: { type: 'object', required: ['text', 'dueAt'], properties: { text: { type: 'string', minLength: 1, maxLength: 200 }, dueAt: { type: 'integer', minimum: 1 }, repeat: { type: 'string', enum: ['none', 'daily', 'weekdays'] } } },
      preview: (ctx, i) => ({ action: 'Set a reminder', target: 'NOVA reminders (delivered by the server)', changes: ['Remind you "' + i.text + '" at ' + label(i.dueAt) + ' (Dubai)' + (i.repeat && i.repeat !== 'none' ? ', repeating ' + (i.repeat === 'daily' ? 'every day' : 'Monday to Friday') : '')],
        consequences: 'At that time NOVA notifies you (bell, browser pop-up, phone push if set up). Nobody else is contacted.', undoable: true, undoNote: 'You can undo this: the reminder is cancelled.' }),
      run: (ctx, i) => { if (i.dueAt <= ctx.now()) throw new Error('That time has already passed.'); return createReminder(ctx.user.id, { text: i.text.trim(), dueAt: i.dueAt, repeat: i.repeat || 'none' }); },
      verify: (ctx, i, o) => { const r = db.prepare("SELECT * FROM reminders WHERE id = ? AND user_id = ? AND status = 'pending'").get(o.id, ctx.user.id); return r ? { ok: true, evidence: 'Read back from the database: reminder #' + r.id + ' is scheduled for ' + label(r.due_at) + ' (Dubai).' } : { ok: false, evidence: 'The reminder is not scheduled.' }; },
      undo: (ctx, o) => { db.prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ? AND user_id = ?").run(o.id, ctx.user.id); return 'Reminder #' + o.id + ' cancelled.'; },
      summarize: o => 'I will remind you "' + o.text + '" at ' + o.dueLabel + (o.repeat !== 'none' ? ', ' + (o.repeat === 'daily' ? 'every day' : 'every weekday') : '') + '.' });
    registry.register({ name: 'expenses.add', risk: 'write', description: 'Record an expense in AED for the owner (amount in fils: 1 AED = 100 fils).',
      schema: { type: 'object', required: ['fils', 'category'], properties: { fils: { type: 'integer', minimum: 1, maximum: 100000000 }, category: { type: 'string', enum: CATEGORIES }, note: { type: 'string', maxLength: 120 } } },
      preview: (ctx, i) => ({ action: 'Record an expense', target: 'NOVA money tracker', changes: ['Spent ' + aed(i.fils) + ' on ' + (i.note || i.category) + ' (category: ' + i.category + '), today'], consequences: 'It is added to this month\'s spending. Nothing is paid or sent.', undoable: true, undoNote: 'You can undo this: the expense is removed.' }),
      run: (ctx, i) => { const id = addExpense(ctx.user.id, { fils: i.fils, category: i.category, note: i.note }); budgetCheck(ctx.user.id).catch(() => {}); return eview(db.prepare('SELECT * FROM expenses WHERE id = ?').get(id)); },
      verify: (ctx, i, o) => { const e = db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(o.id, ctx.user.id); return e ? { ok: true, evidence: 'Read back from the database: expense #' + e.id + ' ' + aed(e.amount_fils) + ' (' + e.category + ') is recorded.' } : { ok: false, evidence: 'The expense was not found.' }; },
      undo: (ctx, o) => { db.prepare('UPDATE expenses SET deleted_at = ? WHERE id = ? AND user_id = ?').run(ctx.now(), o.id, ctx.user.id); return 'Expense #' + o.id + ' removed.'; },
      summarize: o => 'Recorded ' + o.label + ' for ' + (o.note || o.category) + ' (' + o.category + ').' });
    registry.register({ name: 'expenses.summary', risk: 'read', description: 'How much the owner spent this month, by category, with the budget if set.', schema: { type: 'object', properties: {} },
      preview: () => ({ action: 'Summarise your spending', target: 'NOVA money tracker', changes: [], consequences: 'Nothing changes.', undoable: true }),
      run: ctx => monthSummary(ctx.user.id, parts(ctx.now()).iso.slice(0, 7)),
      summarize: o => !o.total ? 'No spending recorded this month.' : 'This month you spent ' + o.totalLabel + (o.byCategory.length ? ', mostly on ' + o.byCategory.slice(0, 3).map(c => c.category + ' (' + c.label + ')').join(', ') : '') + '.' + (o.prevTotal ? ' Last month: ' + o.prevLabel + '.' : '') + (o.budget ? ' Budget: ' + o.budget.usedPct + '% used, ' + o.budget.leftLabel + ' left.' : '') });
    registry.register({ name: 'habits.check', risk: 'write', description: 'Check in one of the owner\'s habits for today.', schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } },
      preview: (ctx, i) => { const h = db.prepare('SELECT name FROM habits WHERE id = ? AND user_id = ?').get(i.id, ctx.user.id); return { action: 'Check in a habit', target: 'NOVA habits', changes: [h ? '"' + h.name + '": done today' : 'Habit #' + i.id + ' (not found)'], consequences: 'Your streak is updated.', undoable: true, undoNote: 'You can undo this: the check-in is removed.' }; },
      run: (ctx, i) => { const h = ownHabit(ctx.user.id, i.id), d = parts(ctx.now()).iso; db.prepare('INSERT OR IGNORE INTO habit_checks (habit_id, user_id, day, created_at) VALUES (?, ?, ?, ?)').run(h.id, ctx.user.id, d, ctx.now()); return Object.assign(habitStats(h, d), { day: d }); },
      verify: (ctx, i, o) => db.prepare('SELECT 1 FROM habit_checks WHERE habit_id = ? AND day = ?').get(o.id, o.day) ? { ok: true, evidence: 'Read back from the database: "' + o.name + '" is checked in for ' + o.day + '.' } : { ok: false, evidence: 'The check-in was not found.' },
      undo: (ctx, o) => { db.prepare('DELETE FROM habit_checks WHERE habit_id = ? AND day = ?').run(o.id, o.day); return 'Check-in removed.'; },
      summarize: o => 'Checked in "' + o.name + '". Streak: ' + o.streak + ' day' + (o.streak === 1 ? '' : 's') + (o.best > o.streak ? ' (best ' + o.best + ')' : o.streak > 1 ? ', your best yet' : '') + '.' });
  }
  return { register, registerTools, deliver, parseWhen, parseMoney, categorize, bestHabit, monthSummary, CATEGORIES };
}
module.exports = { createLife, parseWhen, parseMoney, categorize, clock, CATEGORIES };

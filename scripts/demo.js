// NOVA demo mode: a separate, clearly labelled demo database with fictional data, so you can show NOVA without touching your own.
//   npm run demo          start NOVA on http://127.0.0.1:8788 with the demo data (created on first run)
//   npm run demo:reset    delete the demo database and create it again
// Sign in with demo@nova.local (development sign-in, this computer only). Everything in the demo is fictional and marked "demo".
'use strict';
require('./check-node').ensure();               // plain words if Node.js is too old (before anything that needs it)
const fs = require('fs');
const path = require('path');
const { createApp } = require('../server');
const { loadDemo } = require('../server/proofloop/demo');
const { createAdapters } = require('../server/proofloop/verify');
const { dubaiDate } = require('../server/agent/planner');

const ROOT = path.join(__dirname, '..'), DB = process.env.NOVA_DEMO_DB || path.join(ROOT, '.nova', 'demo.db');
const EMAIL = 'demo@nova.local';
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Fictional requests, focus sessions and times of day used to make the last 14 days look lived in (everything is labelled "demo").
const DEMO_ASKS = ['add a task to send the portfolio link to Sara', 'remind me at 3pm to call mum', 'note that the study group moved to 7pm', 'I spent 25 dirhams on lunch', 'add a task to renew the library card',
  'add a task to prepare the interview slides', 'remind me tomorrow at 9am to submit the form', 'add a task to email Dr. Mansour the outline'];
const DEMO_FOCUS = ['Practise SQL joins', 'Write the report', 'Revise statistics chapter 3', 'Interview preparation', 'Update the CV', 'Read the research paper'];
const DEMO_HOURS = [[8, 45], [9, 20], [10, 5], [11, 40], [13, 15], [14, 30], [16, 10], [17, 25], [19, 50], [21, 15]];
const DAYMS = 86400e3;
const dayStart = iso => Date.parse(iso + 'T00:00:00+04:00');
const weekdayOf = iso => new Date(iso + 'T12:00:00Z').getUTCDay();

// The last 14 days: sign-ins, requests with approvals (most approved and checked, some rejected), focus sessions, morning briefings and
// finished tasks, at different times of each day, so Day Replay and the Life Radar have real shapes. Nothing is in the future.
function spreadActivity(db, uid, now, today) {
  const at = (iso, h, m, s) => dayStart(iso) + ((h * 60 + m) * 60 + (s || 0)) * 1000;
  const sched = db.prepare("SELECT id FROM schedules WHERE user_id = ? AND kind = 'briefing'").get(uid);
  let n = 0;
  for (let d = 1; d <= 14; d++) {
    const iso = addDays(today, -d), wk = ![0, 6].includes(weekdayOf(iso)), count = wk ? 2 + (d % 3) : 1 + (d % 2);
    db.prepare("INSERT OR IGNORE INTO notifications (user_id, kind, title, body, link, dedupe, push, created_at, read_at) VALUES (?, 'briefing', ?, ?, '#briefing', ?, NULL, ?, ?)")
      .run(uid, 'Your daily briefing (demo)', 'Demo briefing for ' + iso + '.', 'demo-briefing-' + iso, at(iso, 7, 30, 2), at(iso, 8, 40));
    if (sched) db.prepare("INSERT OR IGNORE INTO schedule_runs (schedule_id, user_id, kind, due_at, trigger, status, attempts, started_at, finished_at, summary) VALUES (?, ?, 'briefing', ?, 'schedule', 'succeeded', 1, ?, ?, 'Briefing built (demo).')").run(sched.id, uid, at(iso, 7, 30), at(iso, 7, 30, 1), at(iso, 7, 30, 3));
    for (let k = 0; k < count; k++) {
      const [h, m] = DEMO_HOURS[(d * 3 + k * 4) % DEMO_HOURS.length], t0 = at(iso, h, m, (d * 7 + k) % 50), ask = DEMO_ASKS[(d + k * 3) % DEMO_ASKS.length], rejected = (d + k) % 5 === 0;
      if (k === 0) db.prepare("INSERT INTO audit_log (user_id, ts, action, detail, ip) VALUES (?, ?, 'login', 'demo sign-in', '127.0.0.1')").run(uid, t0 - 3 * 60e3);
      const run = Number(db.prepare("INSERT INTO runs (user_id, request, status, planner, state, result, created_at, updated_at) VALUES (?, ?, 'completed', 'demo', '{}', 'DEMO', ?, ?)").run(uid, ask + ' (demo)', t0, t0 + 70e3).lastInsertRowid);
      const steps = rejected ? [['request', 'You asked: ' + ask + ' (demo)', 0], ['approval_requested', 'Waiting for your approval (demo).', 2], ['approval_rejected', 'You rejected it (demo). Nothing was changed.', 41]]
        : [['request', 'You asked: ' + ask + ' (demo)', 0], ['approval_requested', 'Waiting for your approval (demo).', 2], ['approval_granted', 'You approved it (demo).', 38], ['verified', 'Read back from the database (demo): it exists.', 40]];
      steps.forEach(([kind, summary, sec], i) => db.prepare('INSERT INTO run_steps (run_id, user_id, seq, kind, summary, ts) VALUES (?, ?, ?, ?, ?, ?)').run(run, uid, i + 1, kind, summary, t0 + sec * 1000));
      n++;
    }
    if (wk || d % 3 === 0) {
      const [h, m] = DEMO_HOURS[(d * 2 + 1) % DEMO_HOURS.length], min = [25, 50, 25, 90][d % 4], st = at(iso, h, m) + 11 * 60e3;
      if (st + min * 60e3 < now) db.prepare("INSERT INTO focus_sessions (user_id, title, planned_min, started_at, ended_at, status) VALUES (?, ?, ?, ?, ?, 'completed')").run(uid, DEMO_FOCUS[d % DEMO_FOCUS.length] + ' (demo)', min, st, st + min * 60e3);
    }
  }
  return n;
}

// Spread the fictional ProofLoop scenarios over the last two weeks, so a receipt's timeline spans hours and days, not one second.
function spreadProofLoop(db, uid, now, today) {
  const BACK = [9, 8, 6, 13, 5, 11, 4, 7, 10], cs = db.prepare('SELECT id FROM commitments WHERE user_id = ? AND is_demo = 1 ORDER BY id').all(uid);
  cs.forEach((c, i) => {
    const base = dayStart(addDays(today, -BACK[i % BACK.length])) + (9 + (i % 7)) * 3600e3, STEP = 37 * 60e3;
    let last = base;
    db.prepare('SELECT id FROM commitment_events WHERE commitment_id = ? ORDER BY seq').all(c.id).forEach((e, k) => { last = base + k * STEP; db.prepare('UPDATE commitment_events SET ts = ? WHERE id = ?').run(last, e.id); });
    db.prepare('SELECT id FROM evidence WHERE commitment_id = ? ORDER BY id').all(c.id).forEach((e, k) => db.prepare('UPDATE evidence SET ts = ? WHERE id = ?').run(base + (k + 1) * STEP - 9 * 60e3, e.id));
    db.prepare('SELECT id, run_id FROM tool_executions WHERE commitment_id = ? ORDER BY id').all(c.id).forEach((e, k) => {
      db.prepare('UPDATE tool_executions SET started_at = ?, finished_at = ? WHERE id = ?').run(base + (k + 1) * STEP - 14 * 60e3, base + (k + 1) * STEP - 13 * 60e3, e.id);
      if (e.run_id) db.prepare('UPDATE runs SET created_at = ?, updated_at = ? WHERE id = ?').run(base + (k + 1) * STEP - 15 * 60e3, base + (k + 1) * STEP - 13 * 60e3, e.run_id);
    });
    db.prepare('SELECT id FROM approvals WHERE commitment_id = ? ORDER BY id').all(c.id).forEach((a, k) => db.prepare('UPDATE approvals SET created_at = ?, expires_at = ?, decided_at = CASE WHEN decided_at IS NULL THEN NULL ELSE ? END WHERE id = ?').run(base + STEP - 20 * 60e3, now + DAYMS, base + 2 * STEP - 20 * 60e3, a.id));
    db.prepare('UPDATE commitments SET created_at = ?, updated_at = ?, closed_at = CASE WHEN closed_at IS NULL THEN NULL ELSE ? END WHERE id = ?').run(base, last, last, c.id);
  });
}

function seed(app, opts) {
  const db = app.db, now = (opts && opts.now) || Date.now(), today = dubaiDate(now);
  db.prepare('INSERT OR IGNORE INTO users (email, display_name, created_at, last_login_at) VALUES (?, ?, ?, ?)').run(EMAIL, 'Roshan', now, now);
  const uid = db.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL).id;
  if (db.prepare('SELECT COUNT(*) n FROM tasks WHERE user_id = ?').get(uid).n) return { uid, seeded: false };
  const task = (title, due, status) => db.prepare('INSERT INTO tasks (user_id, title, due, status, source, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid, title, due, status || 'open', 'demo', now, status === 'done' ? now - 86400e3 : null);
  task('Update CV with the data project', addDays(today, -2)); task('Prepare for the Junior Data Analyst interview', today); task('Pay the utilities bill', addDays(today, 3));
  task('Book the study room for Wednesday', addDays(today, 1)); task('Send thank-you note to Dr. Mansour', null, 'done');
  // a realistic week so far: tasks finished on earlier days, focus sessions, an estimate
  const dayMs = 86400e3, wd = (new Date(now + 4 * 3600e3).getUTCDay() + 6) % 7;          // 0 = Monday (Dubai)
  [['Submit the internship form', 0, 30], ['Email Dr. Mansour the outline', 1, 15], ['Revise statistics chapter 3', 1, 60], ['Update LinkedIn headline', 2, 15], ['Practise SQL joins', 3, 50]].forEach(([title, back, focus], i) => {
    const iso = addDays(today, -back - 1), [hh, mm] = DEMO_HOURS[(i * 3 + 1) % DEMO_HOURS.length], t0 = dayStart(iso) + (hh * 60 + mm) * 60e3;      // a different time of day each day
    db.prepare("INSERT INTO tasks (user_id, title, due, status, source, created_at, completed_at) VALUES (?, ?, ?, 'done', 'demo', ?, ?)").run(uid, title, addDays(today, -back - 1), t0 - dayMs, t0);
    db.prepare("INSERT INTO focus_sessions (user_id, title, planned_min, started_at, ended_at, status) VALUES (?, ?, ?, ?, ?, 'completed')").run(uid, title, focus, t0 - focus * 60e3, t0);
  });
  if (wd === 0) db.prepare("INSERT INTO focus_sessions (user_id, title, planned_min, started_at, ended_at, status) VALUES (?, 'Morning planning', 25, ?, ?, 'completed')").run(uid, now - 3 * 3600e3, now - 3 * 3600e3 + 25 * 60e3);
  // life tracker: two habits with history, a few reminders, a month of spending and a budget (all fictional)
  // two habits with different streaks on purpose: 9 days in a row (every day), and 3 weekdays in a row
  [['Read 10 pages', 'daily', 9, 0.75], ['Gym', 'weekdays', 3, 0.6]].forEach(([name, sched, streak, rate], hi) => {
    const hid = Number(db.prepare('INSERT INTO habits (user_id, name, schedule, created_at) VALUES (?, ?, ?, ?)').run(uid, name, sched, now - 90 * dayMs).lastInsertRowid);
    let run = 0;
    for (let i = 1; i <= 84; i++) { const d = addDays(today, -i), wday = new Date(d + 'T12:00:00Z').getUTCDay(); if (sched === 'weekdays' && (wday === 0 || wday === 6)) continue;
      if (run < streak) { run++; db.prepare('INSERT INTO habit_checks (habit_id, user_id, day, created_at) VALUES (?, ?, ?, ?)').run(hid, uid, d, now); continue; }
      if (run === streak) { run++; continue; }                                                                     // the day that ends the streak is not checked
      if (((i * 7 + hi * 3) % 10) / 10 < rate) db.prepare('INSERT INTO habit_checks (habit_id, user_id, day, created_at) VALUES (?, ?, ?, ?)').run(hid, uid, d, now); }
  });
  [['Call mum', 19 * 60, 'none'], ['Take vitamins', 8 * 60, 'daily']].forEach(([text, mins, rep]) => { let t = Date.parse(today + 'T00:00:00+04:00') + mins * 60e3; if (t <= now) t += dayMs; db.prepare('INSERT INTO reminders (user_id, text, due_at, repeat, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, text, t, rep, now); });
  const month = today.slice(0, 7), dom = +today.slice(8, 10);
  [[2500, 'food', 'Lunch with the study group'], [1800, 'transport', 'Careem to the interview'], [32000, 'groceries', 'Carrefour weekly shop'], [4500, 'food', 'Karak and shawarma'], [15000, 'bills', 'du mobile bill'], [9900, 'learning', 'SQL course'], [6000, 'fun', 'Cinema'], [700, 'transport', 'Metro top-up']].forEach(([fils, cat, note], i) => {
    const day = month + '-' + String(Math.max(1, dom - i * 2)).padStart(2, '0');
    db.prepare('INSERT INTO expenses (user_id, amount_fils, category, note, day, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, fils, cat, note, day, now);
  });
  // the monthly budget is set so this month's spending sits near 80% of it, on any day of the month
  const spent = db.prepare('SELECT COALESCE(SUM(amount_fils), 0) s FROM expenses WHERE user_id = ?').get(uid).s;
  db.prepare("INSERT INTO budgets (user_id, category, monthly_fils) VALUES (?, 'total', ?)").run(uid, Math.round(spent / 0.8 / 100) * 100);
  db.prepare("UPDATE tasks SET estimate_min = 90 WHERE user_id = ? AND title = 'Prepare for the Junior Data Analyst interview'").run(uid);
  db.prepare('INSERT INTO notes (user_id, text, created_at) VALUES (?, ?, ?)').run(uid, 'Interview tips: prepare two stories about the data project (problem, action, result).', now);
  for (const m of ['I am a fresh graduate looking for data analyst roles in Dubai.', 'I prefer short, direct answers.', 'My study group meets on Wednesday evenings.'])
    db.prepare("INSERT INTO memories (user_id, kind, text, source, status, sensitive, created_at, updated_at) VALUES (?, 'fact', ?, 'demo', 'active', 0, ?, ?)").run(uid, m, now, now);
  loadDemo({ db, pl: app.pl, adapters: createAdapters(db), now: () => now }, uid);
  app.email.loadDemo(uid);
  for (const d of app.kb.DEMO) app.kb.add(uid, { title: d.title, text: d.text, isDemo: true, source: 'demo' });
  app.scheduler.ensureDefaults(uid);
  [['Reply to the lab coordinator', 4], ['Back up the laptop', 5], ['Plan the study group agenda', 7], ['Read the chapter on regression', 9], ['Order the lab notebook', 11], ['Renew the library card', 13]].forEach(([title, back], i) => {
    const iso = addDays(today, -back), [h, m] = DEMO_HOURS[(i * 3 + 2) % DEMO_HOURS.length], done = dayStart(iso) + (h * 60 + m) * 60e3;
    db.prepare("INSERT INTO tasks (user_id, title, due, status, source, created_at, completed_at) VALUES (?, ?, ?, 'done', 'demo', ?, ?)").run(uid, title, iso, done - DAYMS, done);
  });
  spreadActivity(db, uid, now, today); spreadProofLoop(db, uid, now, today); spreadNewPages(db, uid, now, today);
  app.briefing.create(db.prepare('SELECT * FROM users WHERE id = ?').get(uid), 'schedule');
  app.notifier.notify(uid, { kind: 'briefing', title: 'Your briefing is ready (demo)', body: 'Open Daily Briefing to see what matters today.', link: '#briefing', push: false });
  return { uid, seeded: true };
}

// The newer pages look alive in the demo: eight days of energy marks (high in the morning on six of them), and a Decision Journal with five answered
// decisions (so the record shows), one waiting for its answer today and two coming up. All of it is only in the demo database.
function spreadNewPages(db, uid, now, today) {
  for (let i = 1; i <= 8; i++) {
    const day = addDays(today, -i), put = (slot, level) => db.prepare('INSERT OR REPLACE INTO energy_marks (user_id, day, slot, level, updated_at) VALUES (?, ?, ?, ?, ?)').run(uid, day, slot, level, now);
    put('morning', i <= 6 ? 'high' : 'low'); put('afternoon', i % 3 === 0 ? 'low' : 'medium'); if (i <= 5) put('evening', 'low');
  }
  const add = (title, why, expected, reviewOn, status, outcome) => db.prepare('INSERT INTO decisions (user_id, title, why, expected, review_on, status, outcome, reviewed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(uid, title, why, expected, reviewOn, status, outcome || null, outcome ? now - DAYMS : null, now - 20 * DAYMS);
  [['Join the study group', 'as_expected'], ['Start the data course early', 'better'], ['Apply to five roles a week', 'as_expected'], ['Skip the career fair', 'worse'], ['Use flash cards for revision', 'as_expected']].forEach(([t, o], i) => add(t, 'A choice I made this term', 'It helps me prepare', addDays(today, -3 - i * 4), 'reviewed', o));
  add('Take the evening interview slot', 'It is the only slot this week', 'I will be calm and prepared', addDays(today, -1), 'open'); add('Move my notes into NOVA', 'One place for everything', 'I stop losing notes', addDays(today, 9), 'open'); add('Buy a second monitor', 'Study comfort', 'Longer focus sessions', addDays(today, 24), 'open');
}

async function main() {
  const reset = process.argv.includes('--reset');
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  if (reset) for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
  const app = createApp({ NOVA_DB: DB, AUTH_MODE: 'dev', OWNER_EMAILS: EMAIL, HOST: '127.0.0.1', PORT: process.env.NOVA_DEMO_PORT || '8788', NOVA_DEMO: '1', NOVA_NTFY_TOPIC: '', NOVA_SECRET_KEY: process.env.NOVA_SECRET_KEY || 'demo-only-key-not-for-real-accounts' });
  const s = seed(app);
  if (process.argv.includes('--seed-only')) { await app.close(); console.log((s.seeded ? 'Demo data created' : 'Demo data already present') + ' in ' + DB); return; }
  const port = await app.listen(); app.scheduler.start();
  console.log('\n  NOVA demo is running at http://127.0.0.1:' + port);
  console.log('  Sign in with: ' + EMAIL + '   (development sign-in, this computer only)');
  console.log('  ' + (s.seeded ? 'Fresh demo data was created.' : 'Using the existing demo data (npm run demo:reset to start over).') + ' Your real NOVA database is not touched.');
  console.log('  Walkthrough: NOVA_DEMO_GUIDE.md.   Stop with Ctrl+C.\n');
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { seed, EMAIL, spreadActivity };

// NOVA demo mode: a separate, clearly labelled demo database with fictional data, so you can show NOVA without touching your own.
//   npm run demo          start NOVA on http://127.0.0.1:8788 with the demo data (created on first run)
//   npm run demo:reset    delete the demo database and create it again
// Sign in with demo@nova.local (development sign-in, this computer only). Everything in the demo is fictional and marked "demo".
'use strict';
const fs = require('fs');
const path = require('path');
const { createApp } = require('../server');
const { loadDemo } = require('../server/proofloop/demo');
const { createAdapters } = require('../server/proofloop/verify');
const { dubaiDate } = require('../server/agent/planner');

const ROOT = path.join(__dirname, '..'), DB = process.env.NOVA_DEMO_DB || path.join(ROOT, '.nova', 'demo.db');
const EMAIL = 'demo@nova.local';
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function seed(app) {
  const db = app.db, now = Date.now(), today = dubaiDate(now);
  db.prepare('INSERT OR IGNORE INTO users (email, display_name, created_at, last_login_at) VALUES (?, ?, ?, ?)').run(EMAIL, 'Roshan', now, now);
  const uid = db.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL).id;
  if (db.prepare('SELECT COUNT(*) n FROM tasks WHERE user_id = ?').get(uid).n) return { uid, seeded: false };
  const task = (title, due, status) => db.prepare('INSERT INTO tasks (user_id, title, due, status, source, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid, title, due, status || 'open', 'demo', now, status === 'done' ? now - 86400e3 : null);
  task('Update CV with the data project', addDays(today, -2)); task('Prepare for the Junior Data Analyst interview', today); task('Pay the utilities bill', addDays(today, 3));
  task('Book the study room for Wednesday', addDays(today, 1)); task('Send thank-you note to Dr. Mansour', null, 'done');
  // a realistic week so far: tasks finished on earlier days, focus sessions, an estimate
  const dayMs = 86400e3, wd = (new Date(now + 4 * 3600e3).getUTCDay() + 6) % 7;          // 0 = Monday (Dubai)
  [['Submit the internship form', 0, 30], ['Email Dr. Mansour the outline', 1, 15], ['Revise statistics chapter 3', 1, 60], ['Update LinkedIn headline', 2, 15], ['Practise SQL joins', 3, 50]].forEach(([title, back, focus], i) => {
    const t0 = now - (back + 1) * dayMs + i * 3600e3;
    db.prepare("INSERT INTO tasks (user_id, title, due, status, source, created_at, completed_at) VALUES (?, ?, ?, 'done', 'demo', ?, ?)").run(uid, title, addDays(today, -back - 1), t0 - dayMs, t0);
    db.prepare("INSERT INTO focus_sessions (user_id, title, planned_min, started_at, ended_at, status) VALUES (?, ?, ?, ?, ?, 'completed')").run(uid, title, focus, t0 - focus * 60e3, t0);
  });
  if (wd === 0) db.prepare("INSERT INTO focus_sessions (user_id, title, planned_min, started_at, ended_at, status) VALUES (?, 'Morning planning', 25, ?, ?, 'completed')").run(uid, now - 3 * 3600e3, now - 3 * 3600e3 + 25 * 60e3);
  db.prepare("UPDATE tasks SET estimate_min = 90 WHERE user_id = ? AND title = 'Prepare for the Junior Data Analyst interview'").run(uid);
  db.prepare('INSERT INTO notes (user_id, text, created_at) VALUES (?, ?, ?)').run(uid, 'Interview tips: prepare two stories about the data project (problem, action, result).', now);
  for (const m of ['I am a fresh graduate looking for data analyst roles in Dubai.', 'I prefer short, direct answers.', 'My study group meets on Wednesday evenings.'])
    db.prepare("INSERT INTO memories (user_id, kind, text, source, status, sensitive, created_at, updated_at) VALUES (?, 'fact', ?, 'demo', 'active', 0, ?, ?)").run(uid, m, now, now);
  loadDemo({ db, pl: app.pl, adapters: createAdapters(db), now: () => now }, uid);
  app.email.loadDemo(uid);
  for (const d of app.kb.DEMO) app.kb.add(uid, { title: d.title, text: d.text, isDemo: true, source: 'demo' });
  app.scheduler.ensureDefaults(uid);
  app.briefing.create(db.prepare('SELECT * FROM users WHERE id = ?').get(uid), 'schedule');
  app.notifier.notify(uid, { kind: 'briefing', title: 'Your briefing is ready (demo)', body: 'Open Daily Briefing to see what matters today.', link: '#briefing', push: false });
  return { uid, seeded: true };
}

async function main() {
  const reset = process.argv.includes('--reset');
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  if (reset) for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
  const app = createApp({ NOVA_DB: DB, AUTH_MODE: 'dev', OWNER_EMAILS: EMAIL, HOST: '127.0.0.1', PORT: process.env.NOVA_DEMO_PORT || '8788', NOVA_NTFY_TOPIC: '', NOVA_SECRET_KEY: process.env.NOVA_SECRET_KEY || 'demo-only-key-not-for-real-accounts' });
  const s = seed(app);
  if (process.argv.includes('--seed-only')) { await app.close(); console.log((s.seeded ? 'Demo data created' : 'Demo data already present') + ' in ' + DB); return; }
  const port = await app.listen(); app.scheduler.start();
  console.log('\n  NOVA demo is running at http://127.0.0.1:' + port);
  console.log('  Sign in with: ' + EMAIL + '   (development sign-in, this computer only)');
  console.log('  ' + (s.seeded ? 'Fresh demo data was created.' : 'Using the existing demo data (npm run demo:reset to start over).') + ' Your real NOVA database is not touched.');
  console.log('  Walkthrough: NOVA_DEMO_GUIDE.md.   Stop with Ctrl+C.\n');
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { seed, EMAIL };

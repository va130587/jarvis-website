// Screenshots of the five newest features, in both themes at 390 and 1440 px, on fixed fictional data:
//   node scripts/feature-shots.js [out-dir]        (default docs/screenshots/after/features)
// Promise Orbit (dashboard), Day Replay, Life Radar (Weekly Insights), the receipt check page, and the "What happens if" preview.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('../tests/helpers');
const { createApp } = require('../server');
const { seed: seedDemo } = require('./demo');
const { seed: seedRadar, NOW: RADAR_NOW } = require('../tests/radar-fixture');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'docs', 'screenshots', 'after', 'features'));
const COMBOS = [[1440, 'dark'], [1440, 'light'], [390, 'dark'], [390, 'light']];
const at = (day, t) => Date.parse(day + 'T' + t + '+04:00');
const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-shots-')), 's.db');
const env = email => ({ NOVA_DB: tmpDb(), AUTH_MODE: 'dev', OWNER_EMAILS: email, HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000', NOVA_RATE_VERIFY_MAX: '100000', BASE_URL: '' });
const initFor = theme => theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined;
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function signIn(browser, app, email, width, theme) {
  const base = 'http://127.0.0.1:' + await app.listen();
  const o = await H.openApp(browser, { base, hash: '', width, height: 900, init: initFor(theme) }); o.base = base;
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown'); await o.page.fill('#novaDevEmail', email); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard'); return o;
}
const done = async (o, app) => { await o.ctx.close(); app.server.closeAllConnections(); await app.close(); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await H.launch(), made = [];
  const shot = async (page, sel, name, w, theme) => { const f = path.join(OUT, name + '-' + w + '-' + theme + '.png'); await (sel ? page.locator(sel).first() : page).screenshot({ path: f }); made.push(path.relative(process.cwd(), f)); };

  for (const [w, theme] of COMBOS) {
    // 1. Promise Orbit: the dashboard hero on the demo data
    { const app = createApp(env('demo@nova.local')); seedDemo(app); const o = await signIn(browser, app, 'demo@nova.local', w, theme);
      await o.page.waitForSelector('.odot'); await o.page.waitForTimeout(600); await o.page.locator('.odot.s-overdue').first().focus();
      await shot(o.page, '.nova-hero', 'promise-orbit', w, theme); await done(o, app); }

    // 2. Day Replay: a spread-out day with the marker in the middle
    { const app = createApp(env('a@nova.local')); const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date()), D = addDays(today, -1), db = app.db;
      db.prepare("INSERT INTO users (email, display_name, created_at) VALUES ('a@nova.local', 'Ayla', 1)").run();
      const r = Number(db.prepare("INSERT INTO runs (user_id, request, status, planner, created_at, updated_at) VALUES (1, 'x', 'completed', 'rules', 1, 1)").run().lastInsertRowid);
      [[1, 'request', 'You asked: add a task to send the portfolio link to Sara', '08:42:10'], [2, 'approval_requested', 'Waiting for your approval: create a task.', '08:42:11'], [3, 'approval_granted', 'You approved: tasks.create.', '08:43:02'],
        [4, 'verified', 'Read back from the database: task #4 exists.', '08:43:03'], [5, 'request', 'You asked: remind me at 3pm to call mum', '12:05:44'], [6, 'approval_granted', 'You approved: reminders.create.', '12:06:20'],
        [7, 'verified', 'Read back from the database: reminder #2 is scheduled for 15:00 (Dubai).', '12:06:21'], [8, 'request', 'You asked: delete the old study group task', '17:20:00'], [9, 'approval_rejected', 'You rejected: tasks.delete.', '17:20:41']]
        .forEach(([seq, kind, summary, t]) => db.prepare('INSERT INTO run_steps (run_id, user_id, seq, kind, summary, ts) VALUES (?, 1, ?, ?, ?, ?)').run(r, seq, kind, summary, at(D, t)));
      db.prepare("INSERT INTO focus_sessions (user_id, title, planned_min, started_at, ended_at, status) VALUES (1, 'Write the report', 25, ?, ?, 'completed')").run(at(D, '10:00:00'), at(D, '10:25:00'));
      db.prepare("INSERT INTO notifications (user_id, kind, title, body, link, created_at) VALUES (1, 'briefing', 'Your daily briefing', 'You have 2 overdue items.', '#briefing', ?)").run(at(D, '07:30:02'));
      const o = await signIn(browser, app, 'a@nova.local', w, theme); await o.page.evaluate(() => { location.hash = 'replay'; }); await o.page.waitForSelector('#rpTime'); await o.page.click('button[data-act="rpPrev"]'); await o.page.waitForSelector('.rp-ev');
      await o.page.fill('#rpTime', '740'); await o.page.waitForTimeout(300); await shot(o.page, '#main', 'day-replay', w, theme); await done(o, app); }

    // 3. Life Radar: a fixed week with known numbers
    { const app = createApp(env('a@nova.local'), { now: () => RADAR_NOW }); app.db.prepare("INSERT INTO users (email, display_name, created_at) VALUES ('a@nova.local', 'Ayla', 1)").run(); seedRadar(app.db, 1);
      const o = await signIn(browser, app, 'a@nova.local', w, theme); await o.page.evaluate(() => { location.hash = 'insights'; }); await o.page.waitForSelector('.rd-svg');
      await o.page.locator('.rd-spoke').first().focus(); await o.page.waitForTimeout(300); await shot(o.page, '#radarPanel', 'life-radar', w, theme); await done(o, app); }

    // 4. Verifiable receipt: the public check page, showing a match
    { const app = createApp(env('demo@nova.local')); seedDemo(app); const o = await signIn(browser, app, 'demo@nova.local', w, theme);
      const md = await o.page.evaluate(async () => { const l = await fetch('/api/commitments').then(x => x.json()); return fetch('/api/commitments/' + l.commitments[0].id + '/receipt?format=md').then(x => x.text()); });
      await o.page.goto(o.base + '/verify'); await o.page.waitForSelector('#verifyForm'); await o.page.fill('#receipt', md); await o.page.click('#check'); await o.page.waitForSelector('#result:not([hidden])'); await o.page.waitForTimeout(200);
      await shot(o.page, '.card', 'receipt-check', w, theme); await done(o, app); }

    // 5. "What happens if": the preview with its Effects row
    { const app = createApp(env('a@nova.local'), { now: () => Date.parse('2026-10-19T08:00:00+04:00') }); const db = app.db; db.prepare("INSERT INTO users (email, display_name, created_at) VALUES ('a@nova.local', 'Ayla', 1)").run();
      db.prepare("INSERT INTO tasks (user_id, title, due, status, created_at) VALUES (1, 'Prepare the slides', '2026-10-23', 'open', 1)").run();
      db.prepare("INSERT INTO commitments (user_id, title, direction, status, deadline, source_type, created_at, updated_at) VALUES (1, 'Send the proposal', 'i_owe', 'awaiting_confirmation', '2026-10-23', 'manual', 1, 1)").run();
      const o = await signIn(browser, app, 'a@nova.local', w, theme); await o.page.evaluate(() => { location.hash = 'chat'; }); await o.page.waitForSelector('#novaMsg');
      await o.page.fill('#novaMsg', 'add a task to call HR by friday'); await o.page.click('#novaChatForm button'); await o.page.waitForSelector('.preview .fx li'); await o.page.waitForTimeout(300);
      await o.page.locator('.preview').scrollIntoViewIfNeeded(); await shot(o.page, '.preview', 'what-happens-if', w, theme); await done(o, app); }
  }
  await browser.close();
  console.log('Wrote ' + made.length + ' screenshots to ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });

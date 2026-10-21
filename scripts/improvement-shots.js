// Screenshots of the ten improvements, in both themes at 390 and 1440 px, on fixed fictional data:
//   node scripts/improvement-shots.js [out-dir]        (default docs/screenshots/after/improvements)
// Help, the first-run tour, export and import, contrast and text size, backups, the Undo list (and its preview), the planner around calendar
// events, the Voice page (type or paste, microphone test), the guided demo, and the whole dashboard at 150% text with high contrast.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('../tests/helpers');
const { createApp } = require('../server');
const { seed, EMAIL } = require('./demo');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'docs', 'screenshots', 'after', 'improvements'));
const COMBOS = [[1440, 'dark'], [1440, 'light'], [390, 'dark'], [390, 'light']];
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-imp-')), 'i.db');
const baseEnv = (over) => Object.assign({ NOVA_DB: tmp(), AUTH_MODE: 'dev', OWNER_EMAILS: EMAIL, HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000', NOVA_TOUR: 'off', NOVA_DEMO: '1' }, over || {});
const theme = (t, extra) => (t === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : '') + (extra || '');
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const stamp = (day, hhmm) => { const [h, m] = hhmm.split(':').map(Number), d = new Date(day + 'T00:00:00Z'); d.setUTCHours(h - 4, m); return d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'; };
const MIC = kind => `navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(), d = c.createMediaStreamDestination(), o = c.createOscillator(), g = c.createGain(); g.gain.value = 0.3; o.connect(g); g.connect(d); o.start(); return d.stream; };`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await H.launch(), made = [];
  const shot = async (page, sel, name, w, t) => { const f = path.join(OUT, name + '-' + w + '-' + t + '.jpg'); const el = sel ? page.locator(sel).first() : page; await el.screenshot({ path: f, type: 'jpeg', quality: 72 }); made.push(path.relative(process.cwd(), f)); };
  const login = async (base, w, t, opts) => {
    const o = await H.openApp(browser, Object.assign({ base, hash: '', width: w, height: 900, init: theme(t) }, opts || {}));
    await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown'); await o.page.fill('#novaDevEmail', EMAIL); await o.page.click('#novaDevForm button');
    await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard'); return o;
  };
  const done = async (o, app) => { await o.ctx.close(); app.server.closeAllConnections(); await app.close(); };
  const go = async (page, v, sel) => { await page.evaluate(x => { location.hash = x; }, v); if (sel) await page.waitForSelector(sel); await page.waitForTimeout(700); };

  for (const [w, t] of COMBOS) {
    // 1 + 4 + 9: help, contrast/text options, guided demo (the demo data server)
    { const app = createApp(baseEnv()); seed(app); const base = 'http://127.0.0.1:' + await app.listen(); const o = await login(base, w, t); const p = o.page;
      await p.waitForSelector('#demoGuide'); await p.click('button[data-act="demoOrbit"]'); await p.keyboard.press('Enter'); await p.waitForSelector('#formDialog[open]'); await p.keyboard.press('Escape'); await p.waitForTimeout(500);
      await p.evaluate(() => { location.hash = 'replay'; }); await p.waitForSelector('#rpTime'); await p.focus('#rpTime'); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(300);
      await go(p, 'dashboard', '#demoGuide'); await shot(p, '#demoGuide', 'guided-demo', w, t);
      await go(p, 'support', '#hpCheck'); await p.click('button[data-act="hpCheck"]'); await p.waitForSelector('.hp-checks li'); await p.waitForTimeout(300); await shot(p, '#main', 'help', w, t);
      await go(p, 'security', '#accessPanel'); await p.click('#accessPanel button[data-act="novaText"][data-id="125"]'); await p.waitForTimeout(300); await p.click('#accessPanel button[data-act="novaText"][data-id="100"]'); await shot(p, '#accessPanel', 'contrast-and-text', w, t);
      await done(o, app); }

    // 2: the first-run tour (a new account, tour on)
    { const app = createApp(baseEnv({ NOVA_TOUR: 'on', NOVA_DEMO: '' })); const base = 'http://127.0.0.1:' + await app.listen(); const o = await login(base, w, t); const p = o.page;
      await p.waitForSelector('dialog#novaTour[open]'); await p.click('[data-tour="next"]'); await p.waitForTimeout(400); await shot(p, null, 'first-run-tour', w, t); await done(o, app); }

    // 3: export and import preview (another account's export, so the preview has real counts and a note)
    { const app = createApp(baseEnv({ NOVA_DEMO: '' })); const b = 'http://127.0.0.1:' + await app.listen(); app.db.prepare("INSERT INTO users (email, display_name, created_at) VALUES (?, 'Ayla', 1)").run(EMAIL);
      const q = (s, ...a) => app.db.prepare(s).run(...a), nowMs = Date.now();
      for (const [ti, du] of [['Pay the electricity bill', '2026-12-25'], ['مراجعة طلب التأشيرة 🚀', null], ['Send the proposal', '2026-12-30']]) q("INSERT INTO tasks (user_id, title, due, status, created_at) VALUES (1, ?, ?, 'open', ?)", ti, du, nowMs);
      q("INSERT INTO notes (user_id, text, created_at) VALUES (1, 'Visa photos need a white background', ?)", nowMs); q("INSERT INTO memories (user_id, kind, text, source, status, sensitive, created_at, updated_at) VALUES (1, 'preference', 'I like short answers', 'user', 'active', 0, ?, ?)", nowMs, nowMs);
      const o = await login(b, w, t); const p = o.page; const exp = await p.evaluate(() => fetch('/api/export').then(r => r.json())); exp.user.email = 'someone.else@example.com'; exp.tasks.push({ title: 'Renew the gym card', due: '2026-11-30', status: 'open' });
      const f = path.join(os.tmpdir(), 'nova-import-shot.json'); fs.writeFileSync(f, JSON.stringify(exp));
      await go(p, 'security', '#importPanel'); await p.setInputFiles('#importFile', f); await p.waitForSelector('#impPreview'); await p.waitForTimeout(300); await shot(p, '#importPanel', 'export-import', w, t); await done(o, app); }

    // 5: backups
    { const app = createApp(baseEnv({ NOVA_BACKUP_DIR: path.join(path.dirname(tmp()), 'bk') })); seed(app); app.backups.job({ id: 1 }, { trigger: 'manual' }); const base = 'http://127.0.0.1:' + await app.listen(); const o = await login(base, w, t); const p = o.page;
      await go(p, 'automation', '#bkPanel'); await p.waitForSelector('#bkPanel:has-text("Checked, good")'); await p.click('button[data-act="bkTest"]'); await p.waitForSelector('.bk-result.ok'); await p.waitForTimeout(300); await shot(p, '#bkPanel', 'backups', w, t); await done(o, app); }

    // 6: the Undo list and its preview
    { const app = createApp(baseEnv({ NOVA_DEMO: '' })); const base = 'http://127.0.0.1:' + await app.listen(); const o = await login(base, w, t); const p = o.page;
      const doIt = x => p.evaluate(async s => { const r = await NOVA.api('POST', '/api/chat', { message: s }); await NOVA.api('POST', '/api/approvals/' + r.run.pendingApproval.id + '/approve', {}); }, x);
      await doIt('add a task to send the proposal by 2026-12-30'); await doIt('note that the gate code is on the fridge'); await doIt('I spent 25 dirhams on lunch');
      const r = Number(app.db.prepare("INSERT INTO runs (user_id, request, status, planner, created_at, updated_at) VALUES (1, 'x', 'completed', 'rules', 1, 1)").run().lastInsertRowid); app.db.prepare("INSERT INTO tool_executions (user_id, run_id, tool, input, status, output, undoable, started_at, finished_at) VALUES (1, ?, 'memory.delete', '{}', 'succeeded', '{}', 0, ?, ?)").run(r, Date.now(), Date.now());
      await go(p, 'replay', '#undoPanel .un-row'); await shot(p, '#undoPanel', 'undo-list', w, t);
      await p.locator('#undoPanel .un-row:has-text("Create a task") button[data-act="undoOpen"]').click(); await p.waitForSelector('#formDialog[open]'); await p.waitForTimeout(400); await shot(p, '#formDialog', 'undo-preview', w, t); await done(o, app); }

    // 7: the planner around calendar events (the clock starts at 08:00 Dubai today)
    { const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date()), T0 = Date.parse(day + 'T08:00:00+04:00'), R0 = Date.now(), now = () => T0 + (Date.now() - R0);
      const app = createApp(baseEnv({ NOVA_DEMO: '' }), { now }); app.db.prepare("INSERT INTO users (email, display_name, created_at) VALUES (?, 'Ayla', 1)").run(EMAIL);
      for (const [ti, du, est] of [['Prepare the client presentation', day, 120], ['Call the bank', addDays(day, -3), 30], ['Write the project report', day, 60], ['Study for the exam', day, 45]]) app.db.prepare("INSERT INTO tasks (user_id, title, due, status, created_at, estimate_min) VALUES (1, ?, ?, 'open', 1, ?)").run(ti, du, est);
      const base = 'http://127.0.0.1:' + await app.listen(); const o = await login(base, w, t, { now: T0 + (Date.now() - R0) }); const p = o.page;
      const ev = (uid, title, a, b2) => 'BEGIN:VEVENT\r\nUID:' + uid + '@t\r\nDTSTAMP:20260101T000000Z\r\nDTSTART:' + stamp(day, a) + '\r\nDTEND:' + stamp(day, b2) + '\r\nSUMMARY:' + title + '\r\nEND:VEVENT\r\n';
      await p.evaluate(txt => J.cal.importIcs(txt, 'work.ics'), 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//EN\r\n' + ev('1', 'Stand-up', '09:00', '09:30') + ev('2', 'Design review', '11:00', '12:00') + ev('3', 'Dentist', '17:00', '18:00') + 'END:VCALENDAR\r\n');
      await go(p, 'focus', '.blk.k-event'); await shot(p, '.plan', 'planner-calendar', w, t); await done(o, app); }

    // 8: voice: a browser that cannot listen (type or paste), and the microphone test
    { const app = createApp(baseEnv({ NOVA_DEMO: '' })); const base = 'http://127.0.0.1:' + await app.listen();
      const FF = "Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0' }); Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true }); Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });";
      let o = await login(base, w, t, { init: theme(t, FF) }); await go(o.page, 'voice', '#ptt'); await shot(o.page, '#main', 'voice-type-or-paste', w, t); await o.ctx.close();
      o = await login(base, w, t, { init: theme(t, MIC('tone')), recognition: true }); await go(o.page, 'voice', '#micBtn'); await o.page.evaluate(() => { NOVA.mic.duration = 1500; }); await o.page.click('#micBtn'); await o.page.waitForSelector('#micBody .mic-result'); await o.page.waitForTimeout(300); await shot(o.page, '#micPanel', 'microphone-test', w, t);
      await o.ctx.close(); app.server.closeAllConnections(); await app.close(); }

    // 10: the dashboard at 150% text with high contrast
    { const app = createApp(baseEnv()); seed(app); const base = 'http://127.0.0.1:' + await app.listen(); const o = await login(base, w, t, { init: theme(t, "localStorage.setItem('nova.text', '150'); localStorage.setItem('nova.contrast', 'high');") });
      await o.page.waitForTimeout(800); await shot(o.page, null, 'dashboard-large-text-high-contrast', w, t); await done(o, app); }
  }
  await browser.close();
  console.log('Wrote ' + made.length + ' screenshots to ' + OUT);
}
main().catch(e => { console.error(e); process.exit(1); });

// Making NOVA deliverable: first-run setup (page, token, .env), `npm start` end to end in a child process, demo seeding,
// and backup / restore with checks (consistent snapshot, manifest, damaged or foreign files refused, safety copy).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { runSetup, buildEnv } = require('../server/setup');
const { backup, restore, inspect, prune } = require('../scripts/backup');
const dbm = require('../server/db');
const { createApp } = require('../server');
const { seed } = require('../scripts/demo');

const ROOT = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nova-ops-'));
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

test('setup: .env content is validated and complete; phone topic only when asked', () => {
  assert.throws(() => buildEnv({ email: 'not-an-email' }), /valid e-mail/);
  assert.throws(() => buildEnv({ email: 'a@b.c,evil@x.y' }), /valid e-mail/, 'one owner only, no list injection');
  const a = buildEnv({ email: ' Roshan@Example.com ', ai: 'local' });
  assert.match(a.text, /^OWNER_EMAILS=roshan@example\.com$/m); assert.match(a.text, /^AUTH_MODE=dev$/m); assert.match(a.text, /^HOST=127\.0\.0\.1$/m);
  assert.match(a.text, /^NOVA_SECRET_KEY=[A-Za-z0-9_-]{43}$/m); assert.match(a.text, /^NOVA_AI_PROVIDER=local$/m); assert.doesNotMatch(a.text, /^NOVA_NTFY_TOPIC=/m); assert.equal(a.ntfyTopic, '');
  const b = buildEnv({ email: 'r@example.com', ai: 'ollama', ollamaModel: 'qwen2.5:3b', ntfy: true });
  assert.match(b.text, /^NOVA_AI_PROVIDER=ollama$/m); assert.match(b.text, /^NOVA_OLLAMA_MODEL=qwen2\.5:3b$/m); assert.match(b.ntfyTopic, /^nova-[A-Za-z0-9]{20,}$/); assert.match(b.text, new RegExp('^NOVA_NTFY_TOPIC=' + b.ntfyTopic + '$', 'm'));
  assert.match(buildEnv({ email: 'r@example.com', ai: 'claude', ollamaModel: 'x; rm -rf /' }).text, /^NOVA_AI_PROVIDER=local$/m, 'only free options can be chosen here');
  assert.notEqual(buildEnv({ email: 'r@example.com' }).text.match(/NOVA_SECRET_KEY=(.*)/)[1], a.text.match(/NOVA_SECRET_KEY=(.*)/)[1]);
});

test('setup server: loopback only, strict headers, needs the terminal code, refuses cross-site, writes a private .env once', async () => {
  const dir = tmp(), envPath = path.join(dir, '.env');
  await assert.rejects(runSetup({ root: ROOT, envPath, host: '0.0.0.0', port: 0, log: false }), /only runs on this computer/);
  const s = await runSetup({ root: ROOT, envPath, host: '127.0.0.1', port: 0, log: false });
  const base = 'http://127.0.0.1:' + s.port;
  const page = await fetch(base + '/');
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /script-src 'self'/); assert.match(await page.text(), /First-run setup/);
  assert.equal((await fetch(base + '/setup-page.js')).status, 200); assert.equal((await fetch(base + '/server/setup.js')).status, 404); assert.equal((await fetch(base + '/.env')).status, 404);
  const st = await (await fetch(base + '/setup/status')).json();
  assert.ok(st.checks.every(c => c.ok), JSON.stringify(st.checks)); assert.equal(st.envExists, false);
  const save = (body, headers) => fetch(base + '/setup/save', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify(body) });
  assert.equal((await save({ token: 'wrong-code-wrong-code-', email: 'r@example.com' })).status, 403);
  assert.equal((await save({ token: s.token, email: 'r@example.com' }, { Origin: 'http://evil.example.com' })).status, 403);
  assert.equal((await save({ token: s.token, email: 'nope' })).status, 400);
  assert.equal(fs.existsSync(envPath), false, 'nothing written by refused requests');
  const ok = await save({ token: s.token, email: 'Roshan@Example.com', ai: 'local', ntfy: true });
  const j = await ok.json();
  assert.equal(ok.status, 200); assert.equal(j.email, 'roshan@example.com'); assert.match(j.ntfyTopic, /^nova-/);
  assert.equal((fs.statSync(envPath).mode & 0o777).toString(8), '600');
  assert.match(fs.readFileSync(envPath, 'utf8'), /OWNER_EMAILS=roshan@example\.com/);
  assert.deepEqual(await s.finished, { email: 'roshan@example.com' });
  // a second setup never overwrites an existing .env
  const s2 = await runSetup({ root: ROOT, envPath, host: '127.0.0.1', port: 0, log: false });
  const again = await fetch('http://127.0.0.1:' + s2.port + '/setup/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: s2.token, email: 'x@example.com' }) });
  assert.equal(again.status, 409); assert.match(fs.readFileSync(envPath, 'utf8'), /roshan@example\.com/);
  s2.server.closeAllConnections(); s2.server.close();
});

test('npm start end to end: first run shows setup, then the same address becomes NOVA; next start reads .env directly', async () => {
  const dir = tmp(), envPath = path.join(dir, '.env'), port = await freePort();
  const env = Object.assign({}, process.env, { NOVA_ENV_FILE: envPath, PORT: String(port), NOVA_DB: path.join(dir, 'nova.db'), OWNER_EMAILS: '', AUTH_MODE: '', BASE_URL: '', NOVA_SCHEDULER: 'off' });
  const start = () => { const c = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] }); c.out = ''; c.stdout.on('data', d => { c.out += d; }); c.stderr.on('data', d => { c.out += d; }); return c; };
  const waitFor = async (fn, ms) => { const end = Date.now() + (ms || 15000); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 150)); } };
  let child = start();
  try {
    const code = await waitFor(async () => (/Setup code: (\S+)/.exec(child.out) || [])[1]);
    assert.match(child.out, new RegExp('http://127\\.0\\.0\\.1:' + port));
    assert.equal((await (await fetch('http://127.0.0.1:' + port + '/api/session')).json()).setup, true);
    const r = await fetch('http://127.0.0.1:' + port + '/setup/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: code, email: 'roshan@example.com', ai: 'local' }) });
    assert.equal(r.status, 200);
    const s = await waitFor(async () => { const j = await (await fetch('http://127.0.0.1:' + port + '/api/session')).json(); return j.setup ? null : j; });
    assert.equal(s.devLogin, true); assert.equal(s.authenticated, false);
    const login = await fetch('http://127.0.0.1:' + port + '/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'roshan@example.com' }) });
    assert.equal(login.status, 200, 'the owner from the setup page can sign in');
    assert.match(child.out, /NOVA is running at http:\/\/127\.0\.0\.1:/);
  } finally { child.kill(); await new Promise(r => child.on('exit', r)); }
  child = start();
  try {
    await waitFor(async () => /NOVA is running/.test(child.out));
    assert.doesNotMatch(child.out, /Setup code/); assert.match(child.out, /Settings: .*\.env/);
  } finally { child.kill(); await new Promise(r => child.on('exit', r)); }
});

test('demo: seeds a separate database once (tasks, notes, memories, nine ProofLoop scenarios, ten e-mails, a briefing)', async () => {
  const dir = tmp();
  const app = createApp({ NOVA_DB: path.join(dir, 'demo.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'demo@nova.local', PORT: '0', NOVA_SECRET_KEY: 'demo-only-key-not-for-real-accounts' });
  const a = seed(app), b = seed(app);
  assert.equal(a.seeded, true); assert.equal(b.seeded, false, 'seeding again adds nothing');
  const n = t => app.db.prepare('SELECT COUNT(*) n FROM ' + t + ' WHERE user_id = ?').get(a.uid).n;
  assert.equal(n('tasks'), 16, 'ten open or done tasks plus six finished ones spread over the last two weeks'); assert.equal(n('notes'), 2, 'one demo note plus the one a ProofLoop scenario creates'); assert.equal(n('memories'), 3); assert.equal(n('commitments'), 9); assert.equal(n('emails'), 10); assert.equal(n('briefings'), 1); assert.equal(n('schedules'), 6, 'the five daily jobs plus the optional weekly review (off)'); assert.equal(n('notifications'), 15, 'one unread briefing plus fourteen days of read ones'); assert.equal(n('documents'), 3); assert.equal(n('habits'), 2); assert.equal(n('reminders'), 2); assert.equal(n('expenses'), 8);
  assert.ok(app.db.prepare('SELECT COUNT(*) n FROM commitments WHERE is_demo = 1').get().n === 9 && app.db.prepare('SELECT COUNT(*) n FROM emails WHERE is_demo = 1').get().n === 10, 'all demo items are labelled demo');
  await app.close();
  // the demo script's own entry point
  const r = await new Promise(res => { const c = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo.js'), '--reset', '--seed-only'], { env: Object.assign({}, process.env, { NOVA_DEMO_DB: path.join(dir, 'd2.db') }) }); let o = ''; c.stdout.on('data', d => { o += d; }); c.stderr.on('data', d => { o += d; }); c.on('exit', code => res({ code, o })); });
  assert.equal(r.code, 0, r.o); assert.match(r.o, /Demo data created/);
});

test('backup and restore: checked snapshot with manifest, pruning, safety copy, refusals for damaged, changed or foreign files', () => {
  const dir = tmp(), live = path.join(dir, 'nova.db'), bdir = path.join(dir, 'backups');
  const db = dbm.open(live);
  db.prepare("INSERT INTO users (email, display_name, created_at) VALUES ('r@example.com', 'R', 1)").run();
  db.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (1, 'before backup', 'open', 1)").run();
  const b1 = backup({ db: live, dir: bdir, date: new Date('2026-10-20T03:00:00Z') });        // taken while the database is open (WAL)
  assert.equal(b1.counts.tasks, 1); assert.equal(b1.schemaVersion, db.prepare('SELECT v FROM schema_version').get().v, 'the manifest records the database\'s own schema version'); assert.match(b1.sha256, /^[0-9a-f]{64}$/);
  assert.equal(inspect(b1.path).integrity, 'ok'); assert.ok(fs.existsSync(b1.path.replace(/\.db$/, '.json')));
  assert.equal((fs.statSync(b1.path).mode & 0o777).toString(8), '600');
  assert.throws(() => backup({ db: live, dir: bdir, date: new Date('2026-10-20T03:00:00Z') }), /already exists/);
  db.prepare("INSERT INTO tasks (user_id, title, status, created_at) VALUES (1, 'after backup', 'open', 2)").run();
  backup({ db: live, dir: bdir, date: new Date('2026-10-21T03:00:00Z') }); backup({ db: live, dir: bdir, date: new Date('2026-10-22T03:00:00Z') });
  db.close();
  // restore the first backup
  const r = restore(b1.path, { db: live });
  assert.ok(fs.existsSync(r.safetyCopy)); assert.equal(inspect(r.safetyCopy).counts.tasks, 2, 'the replaced database was kept');
  const after = dbm.open(live); assert.deepEqual(after.prepare('SELECT title FROM tasks').all().map(x => x.title), ['before backup']); after.close();
  // refusals
  const changed = path.join(bdir, 'nova-20261021-030000.db'); fs.appendFileSync(changed, Buffer.alloc(4096));
  assert.throws(() => restore(changed, { db: live }), /does not match its manifest/);
  const junk = path.join(dir, 'junk.db'); fs.writeFileSync(junk, 'this is not a database at all, just text that is long enough to look like a file');
  assert.throws(() => restore(junk, { db: live }), /damaged|not a NOVA database/);
  const foreign = path.join(dir, 'other.db'); const { DatabaseSync } = require('node:sqlite'); const o = new DatabaseSync(foreign); o.exec('CREATE TABLE x (a)'); o.close();
  assert.throws(() => restore(foreign, { db: live }), /not a NOVA database/);
  assert.throws(() => restore(path.join(dir, 'missing.db'), { db: live }), /Give the backup file/);
  // pruning keeps the newest
  assert.equal(prune(bdir, 2), 1); assert.deepEqual(fs.readdirSync(bdir).filter(f => f.endsWith('.db')).sort(), ['nova-20261021-030000.db', 'nova-20261022-030000.db']);
});

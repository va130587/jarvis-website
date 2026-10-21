// Automatic backups (server): the Backup job (once a day, keeps the newest 14), a plain report of the latest backup, damaged backups are
// reported, "Test my latest backup" restores into a temporary place and never touches the live database, and the warning after 7 days.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);

const at = iso => Date.parse(iso + '+04:00'), DAY = 86400e3, RELOG = new Map();      // moving the fake clock days ahead ends the sign-in, so people sign in again
const T0 = at('2026-10-10T02:00:00');
async function setup(extra) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-bk-')), k = { t: T0, now: () => k.t };
  const env = Object.assign({ NOVA_DB: path.join(root, 'live.db'), NOVA_BACKUP_DIR: path.join(root, 'bk'), NOVA_SCHEDULER_INTERVAL_MS: '1000' }, extra || {});
  const s = await boot(env, { now: k.now }); const c = s.client(); await c.login('roshan@example.com'); const m = s.client(); await m.login('mallory@example.com');
  RELOG.set(s, async () => { await c.login('roshan@example.com'); await m.login('mallory@example.com'); });
  await s.app.scheduler.tick();               // makes each account's schedules; the first backup is due at the next 03:30
  return { s, c, m, k, root, bk: path.join(root, 'bk') };
}
const list = bk => fs.existsSync(bk) ? fs.readdirSync(bk).filter(f => f.endsWith('.db')).sort() : [];
const runs = (s, kind) => s.app.db.prepare("SELECT status, summary, trigger FROM schedule_runs WHERE kind = ? ORDER BY id").all(kind || 'backup');
async function nightly(s, k, iso) { k.t = at(iso); await s.app.scheduler.tick(); await RELOG.get(s)(); }
async function moveTo(s, k, t) { k.t = t; await RELOG.get(s)(); }

test('the Backup job is a default schedule at 03:30 Dubai, every day, and shows up in the Automation Centre', async () => {
  const { c } = await setup();
  const r = (await c.get('/api/schedules')).json, b = r.schedules.find(x => x.kind === 'backup');
  assert.ok(b); assert.equal(b.name, 'Backup'); assert.equal(b.time, '03:30'); assert.equal(b.days, 'daily'); assert.equal(b.enabled, true); assert.match(b.description, /14/);
});

test('at 03:30 it saves a checked backup; a second job the same day (another account, or a retry) does nothing; the next night saves another', async () => {
  const { s, bk, k } = await setup();
  await nightly(s, k, '2026-10-11T03:31:00');
  assert.equal(list(bk).length, 1); const mans = fs.readdirSync(bk).filter(f => f.endsWith('.json')); assert.equal(mans.length, 1);
  const man = JSON.parse(fs.readFileSync(path.join(bk, mans[0]), 'utf8')); assert.equal(man.createdAt, new Date(at('2026-10-11T03:31:00')).toISOString(), 'dated by the NOVA clock'); assert.ok(man.bytes > 1000 && man.sha256.length === 64);
  const rs = runs(s); assert.equal(rs.length, 2, 'one run per account'); assert.deepEqual(rs.map(r => r.status).sort(), ['skipped', 'succeeded']);
  assert.match(rs.find(r => r.status === 'succeeded').summary, /Saved a checked backup \(\d+ KB\)\. Keeping the newest 14/); assert.match(rs.find(r => r.status === 'skipped').summary, /Already backed up today/);
  await s.app.scheduler.tick(); assert.equal(list(bk).length, 1, 'ticking again changes nothing');
  await nightly(s, k, '2026-10-12T03:31:00'); assert.equal(list(bk).length, 2);
});

test('it keeps only the newest 14 backups', async () => {
  const { s, bk, k } = await setup();
  for (let d = 11; d <= 28; d++) await nightly(s, k, '2026-10-' + d + 'T03:31:00');
  const files = list(bk); assert.equal(files.length, 14); assert.match(files[0], /^nova-20261014-/, 'the oldest four were removed'); assert.match(files.at(-1), /^nova-20261027-/);
  assert.equal(fs.readdirSync(bk).filter(f => f.endsWith('.json')).length, 14, 'their checking files go with them');
});

test('"Run now" always makes a fresh backup, even if one exists today', async () => {
  const { s, c, bk, k } = await setup();
  await nightly(s, k, '2026-10-11T03:31:00'); assert.equal(list(bk).length, 1);
  k.t += 5000; const sched = (await c.get('/api/schedules')).json.schedules.find(x => x.kind === 'backup');
  const r = await c.post('/api/schedules/' + sched.id + '/run'); assert.equal(r.status, 200); assert.equal(r.json.run.status, 'succeeded'); assert.equal(list(bk).length, 2);
});

test('the report: last backup, size, health, count; no file paths anywhere', async () => {
  const { s, c, k, root } = await setup();
  let r = (await c.get('/api/backup')).json; assert.equal(r.available, true); assert.equal(r.last, null); assert.equal(r.count, 0); assert.equal(r.warning, null, 'a new NOVA is not nagged');
  await nightly(s, k, '2026-10-11T03:31:00'); await moveTo(s, k, at('2026-10-12T09:00:00'));
  r = (await c.get('/api/backup')).json; assert.equal(r.count, 1); assert.equal(r.keep, 14); assert.equal(r.last.integrity, 'ok'); assert.match(r.last.size, /KB|MB/); assert.equal(r.last.ageDays, 1); assert.equal(r.last.createdAt, at('2026-10-11T03:31:00')); assert.ok(r.last.schemaVersion >= 9);
  assert.equal(r.warning, null); assert.ok(r.advice.some(a => /NOVA_SECRET_KEY/.test(a)) && r.advice.some(a => /USB stick/.test(a)));
  assert.doesNotMatch(JSON.stringify(r), new RegExp(root.replace(/[\\/.]/g, '.')) ); assert.doesNotMatch(JSON.stringify(r), /\/tmp|nova-bk-|live\.db/);
});

test('the warning: none for a new NOVA, one after 7 days with no backup, one when the last backup is over 7 days old, none when it is recent', async () => {
  const { s, c, k } = await setup();
  await moveTo(s, k, T0 + 6 * DAY); assert.equal((await c.get('/api/backup')).json.warning, null);
  await moveTo(s, k, T0 + 8 * DAY); const w = (await c.get('/api/backup')).json.warning; assert.match(w, /no backup yet/); assert.match(w, /Run now/);
  await nightly(s, k, '2026-10-18T03:31:00'); assert.equal((await c.get('/api/backup')).json.warning, null);
  await moveTo(s, k, at('2026-10-24T03:31:00')); assert.equal((await c.get('/api/backup')).json.warning, null, '6 days old is fine');
  await moveTo(s, k, at('2026-10-26T03:31:00')); assert.match((await c.get('/api/backup')).json.warning, /8 days old/);
});

test('a damaged backup is reported as damaged, with the next step', async () => {
  const { s, c, bk, k } = await setup();
  await nightly(s, k, '2026-10-11T03:31:00'); const f = path.join(bk, list(bk)[0]);
  const buf = fs.readFileSync(f); buf.fill(0x41, 2000, 6000); fs.writeFileSync(f, buf);
  let r = (await c.get('/api/backup')).json; assert.equal(r.last.integrity, 'damaged'); assert.match(r.last.problem, /changed after it was made|damaged/); assert.match(r.warning, /damaged/);
  const t = (await c.post('/api/backup/test')).json; assert.equal(t.ok, false); assert.equal(t.integrity, 'damaged'); assert.match(t.message, /cannot be restored.*Run now/);
  fs.rmSync(f.replace(/\.db$/, '.json')); r = (await c.get('/api/backup')).json; assert.equal(r.last.integrity, 'damaged'); assert.match(r.last.problem, /checking file is missing/);
});

test('"Test my latest backup": restores in a temporary place, counts YOUR items only, deletes the copy, and the live database is untouched', async () => {
  const { s, c, m, bk, k, root } = await setup(); const db = s.app.db;
  for (const t of ['a', 'b', 'c']) db.prepare('INSERT INTO tasks (user_id, title, created_at) VALUES (1, ?, 1)').run(t);
  db.prepare("INSERT INTO tasks (user_id, title, created_at) VALUES (2, 'Mallory only', 1)").run();
  db.prepare("INSERT INTO notes (user_id, text, created_at) VALUES (1, 'n', 1)").run();
  await nightly(s, k, '2026-10-11T03:31:00');
  db.prepare("INSERT INTO tasks (user_id, title, created_at) VALUES (1, 'added after the backup', 1)").run();
  const liveBefore = JSON.stringify(db.prepare('SELECT id, user_id, title FROM tasks ORDER BY id').all()); const tmpBefore = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('nova-restore-test-')).length;
  const t = (await c.post('/api/backup/test')).json;
  assert.equal(t.ok, true); assert.equal(t.integrity, 'ok'); assert.match(t.message, /restores correctly.*temporary place.*deleted.*not touched/);
  assert.equal(t.yours.tasks, 3, 'what was in the backup (not the later task)'); assert.equal(t.yours.notes, 1);
  assert.equal((await m.post('/api/backup/test')).json.yours.tasks, 1, 'each person sees only their own counts');
  assert.equal(JSON.stringify(db.prepare('SELECT id, user_id, title FROM tasks ORDER BY id').all()), liveBefore, 'the live database is unchanged');
  assert.equal(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('nova-restore-test-')).length, tmpBefore, 'the temporary copy is deleted');
  assert.equal(list(bk).length, 1); assert.equal(fs.readdirSync(root).filter(f => /before-restore/.test(f)).length, 0, 'no safety copy litter');
  assert.doesNotMatch(JSON.stringify(t), /\/tmp|nova-bk-|live\.db/);
});

test('without any backup, the test says what to do; an in-memory server says there is nothing to back up', async () => {
  const { c } = await setup(); const t = await c.post('/api/backup/test'); assert.equal(t.status, 409); assert.match(t.json.error.message, /no backup to test yet.*Run now/);
  const s = await boot({ NOVA_DB: ':memory:' }); const d = s.client(); await d.login('roshan@example.com');
  const r = (await d.get('/api/backup')).json; assert.equal(r.available, false); assert.match(r.reason, /memory only/);
  assert.equal((await d.post('/api/backup/test')).status, 409);
  await s.app.scheduler.runNow(1, (await d.get('/api/schedules')).json.schedules.find(x => x.kind === 'backup').id);
  assert.match(runs(s)[0].summary, /memory only/); assert.equal(runs(s)[0].status, 'skipped');
});

test('a backup that cannot be saved fails with plain words (no path) and is retried', async () => {
  const { s, k, root } = await setup({ NOVA_BACKUP_DIR: '' }); const blocker = path.join(root, 'file'); fs.writeFileSync(blocker, 'x');
  const s2 = await boot({ NOVA_DB: path.join(root, 'live2.db'), NOVA_BACKUP_DIR: path.join(blocker, 'sub') }, { now: k.now }); const c = s2.client(); await c.login('roshan@example.com');
  k.t = T0; await s2.app.scheduler.tick(); k.t = at('2026-10-11T03:31:00'); await s2.app.scheduler.tick();
  const r = s2.app.db.prepare("SELECT status, error FROM schedule_runs WHERE kind = 'backup'").get();
  assert.equal(r.status, 'retrying'); assert.match(r.error, /could not be saved.*disk is not full/); assert.doesNotMatch(r.error, /\/tmp|ENOTDIR|nova-bk/);
});

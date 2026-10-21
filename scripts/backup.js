// Backup and restore for NOVA's database (free, no extra tools).
//   npm run backup                      writes backups/nova-YYYYMMDD-HHMMSS.db (UTC time) plus a .json manifest (checked after writing)
//   npm run backup -- --keep 14         also deletes all but the newest 14 backups
//   npm run restore -- backups/x.db     checks the file, keeps a copy of the current database, then restores (stop NOVA first)
// The backup is a consistent snapshot (SQLite VACUUM INTO) even while NOVA is running. It contains your data: keep it private.
// Stored Gmail tokens stay encrypted in the backup; you need the same NOVA_SECRET_KEY to use them after a restore.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
// The settings file is read only when this runs as a command, so the NOVA server can use backup() and restore() without side effects.
if (require.main === module) { try { if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env')); } catch (e) { /* the environment may already be set */ } }
const dbPath = () => process.env.NOVA_DB ? path.resolve(ROOT, process.env.NOVA_DB) : path.join(ROOT, '.nova', 'nova.db');
const dirPath = () => process.env.NOVA_BACKUP_DIR ? path.resolve(ROOT, process.env.NOVA_BACKUP_DIR) : path.join(ROOT, 'backups');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const stamp = d => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

// Opens a database file read-only and reports whether it is a healthy NOVA database.
function inspect(file) {
  let db;
  try { db = new DatabaseSync(file, { readOnly: true }); db.prepare('SELECT 1 FROM sqlite_master LIMIT 1').all(); }
  catch (e) { try { db && db.close(); } catch (x) { /* not open */ } return { integrity: 'damaged or not a database (' + String(e.message).slice(0, 80) + ')', version: null, counts: {} }; }
  try {
    const ok = db.prepare('PRAGMA integrity_check').get();
    const integrity = ok && Object.values(ok)[0];
    const hasV = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'").get();
    const version = hasV ? db.prepare('SELECT v FROM schema_version').get().v : null;
    const counts = {};
    for (const t of ['users', 'memories', 'tasks', 'notes', 'commitments', 'emails', 'schedules', 'notifications']) {
      try { counts[t] = db.prepare('SELECT COUNT(*) n FROM ' + t).get().n; } catch (e) { counts[t] = null; }
    }
    return { integrity, version, counts };
  } finally { db.close(); }
}

function backup(opts) {
  opts = opts || {};
  const src = opts.db || dbPath(), dir = opts.dir || dirPath();
  if (!fs.existsSync(src)) throw new Error('No database at ' + src + '. Start NOVA once first (npm start).');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const out = path.join(dir, 'nova-' + stamp(opts.date || new Date()) + '.db');
  if (fs.existsSync(out)) throw new Error('A backup with this name already exists: ' + out);
  const db = new DatabaseSync(src);
  try { db.prepare('VACUUM INTO ?').run(out); } finally { db.close(); }
  fs.chmodSync(out, 0o600);
  const info = inspect(out);
  if (info.integrity !== 'ok' || info.version === null) { fs.rmSync(out, { force: true }); throw new Error('The backup failed its check (' + info.integrity + '). Nothing was kept.'); }
  const manifest = { file: path.basename(out), createdAt: (opts.date || new Date()).toISOString(), sha256: sha(out), bytes: fs.statSync(out).size, schemaVersion: info.version, counts: info.counts, note: 'Restore with: npm run restore -- ' + path.relative(ROOT, out) };
  fs.writeFileSync(out.replace(/\.db$/, '.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  if (opts.keep) prune(dir, opts.keep);
  return Object.assign({ path: out }, manifest);
}

function prune(dir, keep) {
  const all = fs.readdirSync(dir).filter(f => /^nova-\d{8}-\d{6}\.db$/.test(f)).sort().reverse();
  for (const f of all.slice(keep)) { fs.rmSync(path.join(dir, f), { force: true }); fs.rmSync(path.join(dir, f.replace(/\.db$/, '.json')), { force: true }); }
  return all.slice(keep).length;
}

function restore(file, opts) {
  opts = opts || {};
  const target = opts.db || dbPath(), src = path.resolve(file || '');
  if (!file || !fs.existsSync(src)) throw new Error('Give the backup file to restore, for example: npm run restore -- backups/nova-20261020-074500.db');
  const info = inspect(src);
  if (info.integrity !== 'ok') throw new Error('That file is damaged (' + info.integrity + '). Nothing was changed.');
  if (info.version === null) throw new Error('That file is not a NOVA database. Nothing was changed.');
  const man = src.replace(/\.db$/, '.json');
  if (fs.existsSync(man)) { const m = JSON.parse(fs.readFileSync(man, 'utf8')); if (m.sha256 !== sha(src)) throw new Error('The backup does not match its manifest (it changed after it was made). Nothing was changed.'); }
  const current = require('../server/db');
  let safety = null;
  if (fs.existsSync(target)) {
    safety = target + '.before-restore-' + stamp(new Date());
    const db = new DatabaseSync(target);
    try { db.prepare('VACUUM INTO ?').run(safety); } finally { db.close(); }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  for (const f of [target + '-wal', target + '-shm']) fs.rmSync(f, { force: true });
  fs.copyFileSync(src, target); fs.chmodSync(target, 0o600);
  const db = current.open(target); db.close();                  // applies any newer migrations to the restored copy
  return { restored: target, from: src, safetyCopy: safety, schemaVersion: info.version, counts: info.counts };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === 'restore') {
      const r = restore(args[1]);
      console.log('Restored ' + r.from + ' -> ' + r.restored + (r.safetyCopy ? '\nYour previous database was kept at ' + r.safetyCopy : '') + '\nContents: ' + JSON.stringify(r.counts) + '\nStart NOVA again: npm start');
    } else {
      const k = args.indexOf('--keep'), r = backup({ keep: k >= 0 ? +args[k + 1] : 0 });
      console.log('Backup written and checked: ' + r.path + '\n  ' + r.bytes + ' bytes, schema v' + r.schemaVersion + ', sha256 ' + r.sha256.slice(0, 16) + '…\n  Contents: ' + JSON.stringify(r.counts) + '\n  Keep it private: it contains your data.');
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = { backup, restore, inspect, prune };

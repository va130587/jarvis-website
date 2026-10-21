// Backups you can trust: a nightly checked copy of the database (the Backup job), a plain report of the latest one, and a restore test
// that rebuilds it in a temporary place, counts YOUR items, deletes the temporary copy and never touches the live database.
// Uses scripts/backup.js (the same code as `npm run backup`). Backups hold everyone's data on this server: only sizes, dates and
// the caller's own counts leave this module, never a file path.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { backup, restore, inspect } = require('../scripts/backup');
const { HttpError } = require('./http');
const { parts } = require('./daily/clock');

const DAY = 86400e3, WARN_DAYS = 7;
const NAME = /^nova-\d{8}-\d{6}\.db$/;
const OWN = [['tasks', 'tasks', ' AND deleted_at IS NULL'], ['notes', 'notes', ' AND deleted_at IS NULL'], ['memories', 'memories', " AND status = 'active'"], ['commitments', 'commitments', ''], ['reminders', 'reminders', ''], ['habits', 'habits', ''], ['expenses', 'expenses', ' AND deleted_at IS NULL'], ['documents', 'documents', '']];

function createBackups(cfg, db, { now }) {
  const dir = cfg.backupDir, keep = cfg.backupKeep, memory = cfg.dbPath === ':memory:' || cfg.dbPath === '';
  const cache = new Map();

  function files() {
    if (memory || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => NAME.test(f)).sort().reverse().map(f => {
      const file = path.join(dir, f), st = fs.statSync(file); let man = null;
      try { man = JSON.parse(fs.readFileSync(file.replace(/\.db$/, '.json'), 'utf8')); } catch (e) { /* no manifest */ }
      return { file, bytes: st.size, createdAt: man && man.createdAt ? Date.parse(man.createdAt) : st.mtimeMs, man, mtime: st.mtimeMs };
    });
  }
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  // "ok" only if the file passes SQLite's own check and still matches the fingerprint written when it was made
  function health(b) {
    const k = b.file + '|' + b.mtime + '|' + b.bytes + '|' + (b.man ? b.man.sha256 : 'none'); if (cache.has(k)) return cache.get(k);
    let r;
    if (!b.man) r = { ok: false, why: 'its checking file is missing' };
    else if (b.man.sha256 !== sha(b.file)) r = { ok: false, why: 'it changed after it was made' };
    else { const i = inspect(b.file); r = i.integrity === 'ok' && i.version !== null ? { ok: true, version: i.version } : { ok: false, why: 'the file is damaged' }; }
    cache.clear(); cache.set(k, r); return r;
  }

  // ---- the Backup job ----
  function job(user, run) {
    if (memory) return { skipped: 'This server keeps its data in memory only, so there is nothing to back up.' };
    const today = parts(now()).iso, latest = files()[0];
    if (!(run && run.trigger === 'manual') && latest && parts(latest.createdAt).iso === today) return { skipped: 'Already backed up today.' };
    let r;
    try { r = backup({ db: cfg.dbPath, dir, keep, date: new Date(now()) }); }
    catch (e) { throw new Error('The backup could not be saved. Check that the disk is not full and that NOVA may write to its backups folder.'); }
    return { summary: 'Saved a checked backup (' + kb(r.bytes) + '). Keeping the newest ' + keep + '.' };
  }
  const kb = n => n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';

  // ---- what the page shows ----
  function status() {
    if (memory) return { available: false, reason: 'This server keeps its data in memory only, so there are no backups.', keep };
    const list = files(), last = list[0] || null, t = now();
    const h = last ? health(last) : null;
    const firstUser = db.prepare('SELECT MIN(created_at) m FROM users').get().m;
    const ageDays = last ? Math.floor((t - last.createdAt) / DAY) : null;
    let warning = null;
    if (!last && firstUser && t - firstUser > WARN_DAYS * DAY) warning = 'NOVA has no backup yet. Open the Automation Centre and press "Run now" on the Backup job.';
    else if (last && t - last.createdAt > WARN_DAYS * DAY) warning = 'Your last backup is ' + ageDays + ' days old. Open the Automation Centre and check the Backup job.';
    else if (last && !h.ok) warning = 'Your latest backup is damaged (' + h.why + '). Open the Automation Centre and make a new one.';
    return { available: true, keep, count: list.length, last: last ? { createdAt: last.createdAt, bytes: last.bytes, size: kb(last.bytes), ageDays, integrity: h.ok ? 'ok' : 'damaged', problem: h.ok ? null : h.why, schemaVersion: h.ok ? h.version : null } : null, warning,
      advice: ['The backup folder is on this same computer. Copy it now and then to a USB stick or a private cloud drive, so a broken disk cannot take both.',
        'Keep your NOVA_SECRET_KEY (in the .env settings file) safe, for example in a password manager. It unlocks your saved Gmail connection. A backup restores your data without it, but you would need to connect Gmail again. Never share it or put it online.'] };
  }

  // ---- "Test my latest backup" ----
  function test(user) {
    if (memory) throw new HttpError(409, 'This server keeps its data in memory only, so there is nothing to test.', 'unavailable');
    const last = files()[0];
    if (!last) throw new HttpError(409, 'There is no backup to test yet. Press "Run now" on the Backup job first.', 'no_backup');
    const h = health(last);
    if (!h.ok) return { ok: false, createdAt: last.createdAt, integrity: 'damaged', message: 'This backup is damaged (' + h.why + '), so it cannot be restored. Make a new backup with "Run now" on the Backup job.' };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-restore-test-')), target = path.join(tmp, 'restored.db');
    try {
      const r = restore(last.file, { db: target });
      if (path.resolve(target) === path.resolve(cfg.dbPath)) throw new Error('refusing to touch the live database');
      const { DatabaseSync } = require('node:sqlite'), rdb = new DatabaseSync(target, { readOnly: true });
      let yours = {};
      try { for (const [k, t, extra] of OWN) yours[k] = rdb.prepare('SELECT COUNT(*) n FROM ' + t + ' WHERE user_id = ?' + extra).get(user.id).n; } finally { rdb.close(); }
      return { ok: true, createdAt: last.createdAt, integrity: 'ok', schemaVersion: r.schemaVersion, yours, message: 'This backup restores correctly. It was rebuilt in a temporary place and then deleted. Your live data was not touched.' };
    } catch (e) {
      return { ok: false, createdAt: last.createdAt, integrity: 'failed', message: 'This backup could not be restored. Make a new backup with "Run now" on the Backup job.' };
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  function register(router) {
    router.get('/api/backup', ctx => ({ status: 200, body: status() }));
    router.post('/api/backup/test', ctx => ({ status: 200, body: test(ctx.auth.user) }));
  }
  return { job, status, test, register, files };
}
module.exports = { createBackups };

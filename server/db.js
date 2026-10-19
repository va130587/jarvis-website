// SQLite database (Node's built-in node:sqlite, no dependency). Every personal table carries user_id.
'use strict';
const fs = require('fs');
const path = require('path');

let DatabaseSync;
function open(file) {
  if (!DatabaseSync) {
    const w = process.emitWarning; process.emitWarning = () => {};   // node:sqlite prints an "experimental" notice; it is documented in README
    try { ({ DatabaseSync } = require('node:sqlite')); } finally { process.emitWarning = w; }
  }
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY, google_sub TEXT UNIQUE, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
     personalization INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, last_login_at INTEGER);
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL,
     created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, user_agent TEXT);
   CREATE TABLE oauth_states (
     id TEXT PRIMARY KEY, nonce TEXT NOT NULL, verifier TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE memories (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL DEFAULT 'fact', text TEXT NOT NULL, source TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'active', sensitive INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_used_at INTEGER);
   CREATE INDEX memories_user ON memories(user_id, status);
   CREATE TABLE conversations (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE messages (
     id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE activity (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, conversation_id INTEGER,
     request TEXT NOT NULL, operation TEXT NOT NULL, handler TEXT NOT NULL, tool TEXT, approval TEXT, evidence TEXT,
     status TEXT NOT NULL, result TEXT, failure TEXT, created_at INTEGER NOT NULL);
   CREATE INDEX activity_user ON activity(user_id, created_at);
   CREATE TABLE usage_ledger (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, ts INTEGER NOT NULL,
     handler TEXT NOT NULL, provider TEXT, model TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
     cache_read_tokens INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 1, est_cost_usd REAL);
   CREATE INDEX usage_user ON usage_ledger(user_id, ts);
   CREATE TABLE audit_log (
     id INTEGER PRIMARY KEY, user_id INTEGER, ts INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT, ip TEXT);`
];

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get();
  let v = row ? row.v : 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  for (; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[v]); db.prepare('UPDATE schema_version SET v = ?').run(v + 1); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}
module.exports = { open };

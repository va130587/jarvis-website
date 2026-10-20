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
     id INTEGER PRIMARY KEY, user_id INTEGER, ts INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT, ip TEXT);`,
  // 2: agent layer (tasks and notes that tools can really change, runs with a step timeline, approvals, execution records)
  `ALTER TABLE users ADD COLUMN auto_low_risk INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE tasks (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, due TEXT,
     status TEXT NOT NULL DEFAULT 'open', source TEXT, run_id INTEGER, created_at INTEGER NOT NULL, completed_at INTEGER, deleted_at INTEGER);
   CREATE INDEX tasks_user ON tasks(user_id, status);
   CREATE TABLE notes (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, text TEXT NOT NULL, run_id INTEGER, created_at INTEGER NOT NULL, deleted_at INTEGER);
   CREATE TABLE runs (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, conversation_id INTEGER, request TEXT NOT NULL,
     status TEXT NOT NULL, planner TEXT NOT NULL, steps_used INTEGER NOT NULL DEFAULT 0, state TEXT, result TEXT, failure TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE INDEX runs_user ON runs(user_id, id);
   CREATE TABLE run_steps (
     id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     seq INTEGER NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT, ts INTEGER NOT NULL);
   CREATE TABLE approvals (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
     tool TEXT NOT NULL, input TEXT NOT NULL, preview TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', edited INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER, execution_id INTEGER);
   CREATE INDEX approvals_user ON approvals(user_id, status);
   CREATE TABLE tool_executions (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE, approval_id INTEGER,
     tool TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL, output TEXT, error TEXT, evidence TEXT, undoable INTEGER NOT NULL DEFAULT 0, undo_data TEXT, undone_at INTEGER,
     attempts INTEGER NOT NULL DEFAULT 1, started_at INTEGER NOT NULL, finished_at INTEGER);`,
  // 3: ProofLoop (commitments, their state history and evidence)
  `CREATE TABLE commitments (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     title TEXT NOT NULL, action TEXT, direction TEXT NOT NULL, counterparty TEXT, deadline TEXT,
     source_type TEXT NOT NULL, source_ref TEXT, run_id INTEGER, task_id INTEGER,
     status TEXT NOT NULL, reason TEXT, follow_up_at TEXT, is_demo INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER);
   CREATE INDEX commitments_user ON commitments(user_id, status);
   CREATE TABLE commitment_events (
     id INTEGER PRIMARY KEY, commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     seq INTEGER NOT NULL, from_status TEXT, to_status TEXT NOT NULL, note TEXT, actor TEXT NOT NULL, ts INTEGER NOT NULL);
   CREATE TABLE evidence (
     id INTEGER PRIMARY KEY, commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL, description TEXT NOT NULL, ref_type TEXT, ref_id INTEGER, independent INTEGER NOT NULL DEFAULT 0, execution_id INTEGER, ts INTEGER NOT NULL);
   ALTER TABLE tool_executions ADD COLUMN commitment_id INTEGER;
   ALTER TABLE approvals ADD COLUMN commitment_id INTEGER;`
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

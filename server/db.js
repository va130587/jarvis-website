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
   ALTER TABLE approvals ADD COLUMN commitment_id INTEGER;`,
  // 4: daily use: schedules and their run history, notifications, briefings, connected accounts (encrypted tokens), e-mail (read-only copies) and reply drafts
  `CREATE TABLE schedules (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL,
     hour INTEGER NOT NULL, minute INTEGER NOT NULL, days TEXT NOT NULL DEFAULT 'daily', enabled INTEGER NOT NULL DEFAULT 1,
     next_run_at INTEGER, last_run_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (user_id, kind));
   CREATE TABLE schedule_runs (
     id INTEGER PRIMARY KEY, schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL, due_at INTEGER NOT NULL, trigger TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER,
     missed INTEGER NOT NULL DEFAULT 0, started_at INTEGER, finished_at INTEGER, error TEXT, summary TEXT, UNIQUE (schedule_id, due_at));
   CREATE INDEX schedule_runs_user ON schedule_runs(user_id, id);
   CREATE TABLE notifications (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
     link TEXT, dedupe TEXT, push TEXT, created_at INTEGER NOT NULL, read_at INTEGER, UNIQUE (user_id, dedupe));
   CREATE INDEX notifications_user ON notifications(user_id, id);
   CREATE TABLE briefings (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, data TEXT NOT NULL, trigger TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE INDEX briefings_user ON briefings(user_id, id);
   CREATE TABLE connections (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, account TEXT, scope TEXT NOT NULL,
     token_enc TEXT, status TEXT NOT NULL, last_sync_at INTEGER, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (user_id, provider));
   CREATE TABLE emails (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider_id TEXT NOT NULL, thread_id TEXT,
     from_name TEXT, from_addr TEXT, subject TEXT, snippet TEXT, received_at INTEGER NOT NULL, labels TEXT, unsubscribe INTEGER NOT NULL DEFAULT 0,
     priority TEXT NOT NULL, category TEXT NOT NULL, reasons TEXT NOT NULL, deadline TEXT, promise TEXT, is_demo INTEGER NOT NULL DEFAULT 0, commitment_id INTEGER,
     created_at INTEGER NOT NULL, UNIQUE (user_id, provider_id));
   CREATE INDEX emails_user ON emails(user_id, received_at);
   CREATE TABLE email_drafts (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
     body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   ALTER TABLE oauth_states ADD COLUMN purpose TEXT;
   ALTER TABLE oauth_states ADD COLUMN user_id INTEGER;`,
  // 5: Knowledge Base: your own documents, split into passages with full-text search (stemmed, ranked)
  `CREATE TABLE documents (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'note',
     source TEXT, chars INTEGER NOT NULL, chunks INTEGER NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE INDEX documents_user ON documents(user_id, id);
   CREATE TABLE chunks (
     id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, seq INTEGER NOT NULL, heading TEXT, text TEXT NOT NULL);
   CREATE INDEX chunks_doc ON chunks(document_id, seq);
   CREATE VIRTUAL TABLE chunks_fts USING fts5(text, heading, tokenize = 'porter unicode61');`,
  // 6: productivity: estimates on tasks, focus sessions, accepted day plans
  `ALTER TABLE tasks ADD COLUMN estimate_min INTEGER;
   CREATE TABLE focus_sessions (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, task_id INTEGER, title TEXT NOT NULL,
     planned_min INTEGER NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, status TEXT NOT NULL, note TEXT);
   CREATE INDEX focus_user ON focus_sessions(user_id, started_at);
   CREATE TABLE day_plans (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (user_id, day));`,
  // 7: life tracker: timed reminders (delivered by the server), habits with daily check-ins, expenses with monthly budgets
  `CREATE TABLE reminders (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, text TEXT NOT NULL, due_at INTEGER NOT NULL,
     repeat TEXT NOT NULL DEFAULT 'none', status TEXT NOT NULL DEFAULT 'pending', sent_count INTEGER NOT NULL DEFAULT 0, last_sent_at INTEGER, created_at INTEGER NOT NULL);
   CREATE INDEX reminders_due ON reminders(status, due_at);
   CREATE TABLE habits (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, schedule TEXT NOT NULL DEFAULT 'daily',
     archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
   CREATE TABLE habit_checks (
     habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, day TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (habit_id, day));
   CREATE TABLE expenses (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, amount_fils INTEGER NOT NULL, category TEXT NOT NULL,
     note TEXT, day TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER);
   CREATE INDEX expenses_user ON expenses(user_id, day);
   CREATE TABLE budgets (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, category TEXT NOT NULL, monthly_fils INTEGER NOT NULL, PRIMARY KEY (user_id, category));`,
  // 8: proof receipts: the fingerprint of every receipt this NOVA issued (so a pasted receipt can be checked), never its content
  `CREATE TABLE receipts (
     id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, commitment_id INTEGER, fingerprint TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);`,
  // 9: the first-run tour: when this person finished or skipped it (NULL = not yet). People who already had an account are marked done.
  `ALTER TABLE users ADD COLUMN tour_done_at INTEGER;
   UPDATE users SET tour_done_at = created_at;`,
  // 10: the guided demo: which of its five steps this person has done (a JSON list, or NULL)
  `ALTER TABLE users ADD COLUMN demo_steps TEXT;`,
  // 11: energy marks (high, medium or low at three points of the day) and whether the planner may use my own pattern
  `CREATE TABLE energy_marks (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, slot TEXT NOT NULL, level TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, day, slot));
   ALTER TABLE users ADD COLUMN energy_plan INTEGER NOT NULL DEFAULT 0;`
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

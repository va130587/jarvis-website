// Labelled DEMO scenarios: fictional people and requests, but they go through the REAL state machine, evidence rules and database
// (so the board, receipts and rules behave exactly as they will for real commitments). Everything here carries is_demo = 1 and can be removed with Reset.
'use strict';
const { dubaiToday, addDays } = require('./machine');

function loadDemo(ctx, userId) {
  const { db, pl, adapters, now } = ctx;
  if (db.prepare('SELECT COUNT(*) n FROM commitments WHERE user_id = ? AND is_demo = 1').get(userId).n) return { created: 0, already: true };
  const today = dubaiToday(now());
  const run = (request) => Number(db.prepare("INSERT INTO runs (user_id, request, status, planner, state, result, created_at, updated_at) VALUES (?, ?, 'completed', 'demo', '{}', 'DEMO', ?, ?)").run(userId, request, now(), now()).lastInsertRowid);
  const exec = (runId, cid, tool, status, evidence, error) => Number(db.prepare('INSERT INTO tool_executions (user_id, run_id, tool, input, status, output, error, evidence, undoable, attempts, started_at, finished_at, commitment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)').run(userId, runId, tool, '{"demo":true}', status, '{}', error || null, evidence || null, now(), now(), cid).lastInsertRowid);
  const mk = (o) => pl.create(userId, Object.assign({ sourceType: 'demo', isDemo: true, actor: 'nova' }, o));
  const go = (id, to, note, actor) => pl.transition(userId, id, to, { note, actor: actor || 'nova' });
  const upto = (id, ...states) => states.forEach(s => go(id, s, s === 'request_understood' ? 'Understood (demo).' : s === 'task_prepared' ? 'Prepared (demo).' : undefined));
  let n = 0;

  // 1. University document request: a reply is drafted and waits for approval
  let id = mk({ title: 'Send my transcript to the University Registrar', direction: 'i_owe', counterparty: 'Registrar (demo)', deadline: addDays(today, 2), sourceRef: 'DEMO e-mail from the Registrar: "Please send your transcript by Friday"' }); n++;
  upto(id, 'request_understood', 'task_prepared'); pl.addEvidence(userId, id, { kind: 'draft', description: 'Reply drafted with the transcript attached. It is only a draft: nothing has been sent.' }); go(id, 'awaiting_approval', 'Waiting for you to approve sending the reply.');

  // 2. Client project proposal: "sent" is not "received"
  id = mk({ title: 'Send the updated project proposal to Alex Rivera (client)', direction: 'i_owe', counterparty: 'Alex Rivera (demo)', deadline: addDays(today, 3), sourceRef: 'DEMO e-mail from Alex: "Please send the updated proposal by Friday"' }); n++;
  upto(id, 'request_understood', 'task_prepared', 'awaiting_approval'); go(id, 'executing', 'Approved by you (demo).', 'you');
  const r2 = run('DEMO: send proposal'); const e2 = exec(r2, id, 'demo.email_send', 'succeeded', 'The send call returned OK (demo). This does not prove it was delivered or read.');
  pl.addEvidence(userId, id, { kind: 'submitted', description: 'Send call returned OK (tool run #' + e2 + '). This is NOT proof of delivery, reading or acceptance.', executionId: e2 }); go(id, 'submitted', 'The e-mail was handed to the mail server.');
  go(id, 'awaiting_confirmation', 'Waiting for Alex to confirm they received it.');

  // 3. Job interview invitation
  id = mk({ title: 'Confirm the interview slot with Northwind Analytics', direction: 'i_owe', counterparty: 'Northwind Analytics (demo)', deadline: addDays(today, 1), sourceRef: 'DEMO e-mail: "We would like to invite you to an interview on Thursday 10:00"' }); n++;
  upto(id, 'request_understood', 'task_prepared'); pl.addEvidence(userId, id, { kind: 'draft', description: 'Draft reply: "Thank you, Thursday 10:00 works for me." Not sent.' });

  // 4. Promotional e-mail: ignored on purpose
  id = mk({ title: 'Flash sale: 70% off everything (promotional e-mail)', direction: 'i_owe', sourceRef: 'DEMO promotional e-mail' }); n++;
  go(id, 'cancelled', 'Promotional e-mail: no action needed (classified by NOVA, demo).');

  // 5. Pending reply: an acknowledgement is not acceptance
  id = mk({ title: 'Supplier to send the lab equipment quote', direction: 'owed_to_me', counterparty: 'Orion Supplies (demo)', deadline: addDays(today, 1), sourceRef: 'DEMO: you asked Orion for a quote' }); n++;
  upto(id, 'request_understood'); go(id, 'awaiting_confirmation', 'Waiting for Orion Supplies.');
  pl.addEvidence(userId, id, { kind: 'acknowledged', description: 'Orion replied "Received, we will look into it." An acknowledgement is not the quote.' });

  // 6. Overdue deadline
  id = mk({ title: 'Submit the scholarship form', direction: 'i_owe', counterparty: 'Scholarship Office (demo)', deadline: addDays(today, -3), sourceRef: 'DEMO reminder' }); n++;
  upto(id, 'request_understood', 'task_prepared');

  // 7. Completed ProofLoop task, verified by an independent check of stored state
  id = mk({ title: 'Save the library fine receipt', direction: 'i_owe', counterparty: 'Library (demo)', deadline: addDays(today, -1), sourceRef: 'DEMO' }); n++;
  upto(id, 'request_understood', 'task_prepared', 'executing');
  const r7 = run('DEMO: save the receipt'); const note = Number(db.prepare("INSERT INTO notes (user_id, text, run_id, created_at) VALUES (?, '[DEMO] Library fine paid, receipt 4471', ?, ?)").run(userId, r7, now()).lastInsertRowid);
  const e7 = exec(r7, id, 'notes.create', 'succeeded', 'Read back from the database: note #' + note + ' exists.');
  pl.addEvidence(userId, id, { kind: 'submitted', description: 'Note #' + note + ' was saved (tool run #' + e7 + ').', executionId: e7 }); go(id, 'submitted', 'The note was saved.'); go(id, 'awaiting_confirmation', 'Checking that it really exists.');
  pl.addEvidence(userId, id, { kind: 'verified', description: 'Independent check: the note exists in your notes.', refType: 'note_exists', refId: note }, adapters); go(id, 'verified', 'Evidence checks out.'); go(id, 'completed', 'Verified, so closed.');

  // 8. Failed tool execution
  id = mk({ title: 'Create the booking task for the field trip', direction: 'i_owe', counterparty: 'Faculty (demo)', deadline: addDays(today, 4), sourceRef: 'DEMO' }); n++;
  upto(id, 'request_understood', 'task_prepared', 'executing');
  const r8 = run('DEMO: booking task'); exec(r8, id, 'tasks.create', 'failed', null, 'Simulated failure (demo): the database was busy.'); go(id, 'failed', 'Tool tasks.create failed: simulated failure (demo). Nothing was created.');

  // 9. Rejected approval
  id = mk({ title: 'Delete all my old notes', direction: 'i_owe', sourceRef: 'DEMO request' }); n++;
  upto(id, 'request_understood', 'task_prepared', 'awaiting_approval');
  const r9 = run('DEMO: delete old notes'); db.prepare("INSERT INTO approvals (user_id, run_id, tool, input, preview, status, created_at, expires_at, decided_at, commitment_id) VALUES (?, ?, 'demo.delete_notes', '{}', '{\"action\":\"Delete all notes (demo)\"}', 'rejected', ?, ?, ?, ?)").run(userId, r9, now(), now(), now(), id);
  go(id, 'cancelled', 'Rejected by you (demo). Nothing was deleted.', 'you');
  return { created: n };
}

function resetDemo(ctx, userId) {
  const { db } = ctx;
  const n = db.prepare('SELECT COUNT(*) n FROM commitments WHERE user_id = ? AND is_demo = 1').get(userId).n;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM commitments WHERE user_id = ? AND is_demo = 1').run(userId);
    db.prepare("DELETE FROM notes WHERE user_id = ? AND text LIKE '[DEMO]%'").run(userId);
    db.prepare("DELETE FROM runs WHERE user_id = ? AND planner = 'demo'").run(userId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { removed: n };
}
module.exports = { loadDemo, resetDemo };

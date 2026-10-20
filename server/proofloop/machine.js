// ProofLoop: commitments tracked from request to VERIFIED result. One state machine, one place that decides what is allowed.
// The three rules that make it honest are enforced here, not in the UI:
//   - a draft is not an action (only 'submitted' evidence can move a commitment to Submitted)
//   - an API success or an acknowledgement is not proof (only 'verified' evidence can move it to Verified)
//   - nothing is Completed unless it was Verified first
'use strict';

const STATES = ['request_detected', 'request_understood', 'task_prepared', 'awaiting_approval', 'executing', 'submitted', 'awaiting_confirmation', 'verified', 'completed', 'failed', 'cancelled'];
const LABEL = { request_detected: 'Request Detected', request_understood: 'Request Understood', task_prepared: 'Task Prepared', awaiting_approval: 'Awaiting Approval', executing: 'Executing', submitted: 'Submitted',
  awaiting_confirmation: 'Awaiting Confirmation', verified: 'Verified', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' };
const TERMINAL = ['completed', 'failed', 'cancelled'];
const FORWARD = { request_detected: ['request_understood'], request_understood: ['task_prepared'], task_prepared: ['awaiting_approval', 'executing'], awaiting_approval: ['executing'], executing: ['submitted'],
  submitted: ['awaiting_confirmation', 'verified'], awaiting_confirmation: ['verified'], verified: ['completed'], completed: [], failed: [], cancelled: [] };
const EVIDENCE_KINDS = ['draft', 'submitted', 'acknowledged', 'verified', 'note'];
const DIRECTIONS = ['i_owe', 'owed_to_me'];

class ProofLoopError extends Error { constructor(code, message) { super(message); this.code = code; } }

// What may come next. Anything that is not finished can fail or be cancelled. For things other people owe me, "waiting for them" can start right after the request is understood.
function allowed(status, direction) {
  if (TERMINAL.includes(status)) return [];
  const next = (FORWARD[status] || []).slice();
  if (status === 'request_understood' && direction === 'owed_to_me') next.push('awaiting_confirmation');
  return next.concat(['failed', 'cancelled']);
}
const dubaiToday = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function createProofLoop(db, now) {
  const row = (userId, id) => { const r = db.prepare('SELECT * FROM commitments WHERE id = ? AND user_id = ?').get(id, userId); if (!r) { const e = new ProofLoopError('not_found', 'Commitment not found.'); e.status = 404; throw e; } return r; };
  const evidenceCount = (id, kind) => db.prepare('SELECT COUNT(*) n FROM evidence WHERE commitment_id = ? AND kind = ?').get(id, kind).n;
  const isOverdue = c => !!c.deadline && c.deadline < dubaiToday(now()) && !TERMINAL.includes(c.status) && c.status !== 'verified';

  function create(userId, o) {   // o: { title, action, direction, counterparty, deadline, sourceType, sourceRef, runId, taskId, isDemo }
    if (!DIRECTIONS.includes(o.direction)) throw new ProofLoopError('invalid', 'direction must be i_owe or owed_to_me.');
    const t = now(), followUp = o.deadline ? addDays(o.deadline, -1) : (o.direction === 'owed_to_me' ? addDays(dubaiToday(t), 3) : null);
    const r = db.prepare('INSERT INTO commitments (user_id, title, action, direction, counterparty, deadline, source_type, source_ref, run_id, task_id, status, follow_up_at, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(userId, o.title, o.action || null, o.direction, o.counterparty || null, o.deadline || null, o.sourceType || 'manual', o.sourceRef || null, o.runId || null, o.taskId || null, 'request_detected', followUp, o.isDemo ? 1 : 0, t, t);
    const id = Number(r.lastInsertRowid);
    db.prepare('INSERT INTO commitment_events (commitment_id, user_id, seq, from_status, to_status, note, actor, ts) VALUES (?, ?, 1, NULL, ?, ?, ?, ?)').run(id, userId, 'request_detected', 'Request detected' + (o.sourceRef ? ' (' + o.sourceRef + ')' : '') + '.', o.actor || 'nova', t);
    return id;
  }

  function addEvidence(userId, id, e, adapters) {   // e: { kind, description, refType, refId, independent, executionId }
    const c = row(userId, id);
    if (!EVIDENCE_KINDS.includes(e.kind)) throw new ProofLoopError('invalid', 'Evidence kind must be one of: ' + EVIDENCE_KINDS.join(', ') + '.');
    const description = String(e.description || '').trim();
    if (!description) throw new ProofLoopError('invalid', 'Describe the evidence.');
    if (description.length > 500) throw new ProofLoopError('invalid', 'The description is too long (maximum 500 characters).');
    let independent = !!e.independent;
    if (e.kind === 'verified') {
      const ref = e.refType || 'self';
      if (ref === 'self') independent = false;                          // you saying "it's done" is honest, but it is not an independent check
      else {
        const ad = adapters && adapters[ref];
        if (!ad) throw new ProofLoopError('invalid', 'There is no way to check "' + ref + '" automatically. Use a checkable reference (' + Object.keys(adapters || {}).join(', ') + ') or confirm it yourself.');
        const res = ad(userId, e.refId);
        if (!res.ok) throw new ProofLoopError('evidence_failed', 'That evidence does not check out: ' + res.reason);
        independent = !!res.independent;
      }
    } else independent = false;
    const r = db.prepare('INSERT INTO evidence (commitment_id, user_id, kind, description, ref_type, ref_id, independent, execution_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(c.id, userId, e.kind, description, e.refType || null, e.refId == null ? null : e.refId, independent ? 1 : 0, e.executionId || null, now());
    db.prepare('UPDATE commitments SET updated_at = ? WHERE id = ?').run(now(), c.id);
    return Number(r.lastInsertRowid);
  }

  function transition(userId, id, to, o) {          // o: { note, actor }
    o = o || {};
    const c = row(userId, id);
    if (!STATES.includes(to)) throw new ProofLoopError('invalid', 'Unknown state "' + to + '".');
    if (!allowed(c.status, c.direction).includes(to)) throw new ProofLoopError('illegal_transition', 'A commitment cannot go from ' + LABEL[c.status] + ' to ' + LABEL[to] + '.' + (TERMINAL.includes(c.status) ? ' It is finished.' : ' It can go to: ' + allowed(c.status, c.direction).map(s => LABEL[s]).join(', ') + '.'));
    const note = String(o.note || '').trim();
    if ((to === 'failed' || to === 'cancelled') && !note) throw new ProofLoopError('reason_required', 'Say why (a reason is needed to mark it ' + LABEL[to] + ').');
    if (to === 'submitted' && !evidenceCount(c.id, 'submitted')) throw new ProofLoopError('missing_evidence', 'Submitted needs evidence that an action was actually taken. A draft is not an action.');
    if (to === 'verified' && !evidenceCount(c.id, 'verified')) throw new ProofLoopError('missing_evidence', 'Verified needs evidence that the outcome holds. A "submitted" or "acknowledged" item is not proof of acceptance.');
    const t = now(), seq = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 n FROM commitment_events WHERE commitment_id = ?').get(c.id).n;
    const closed = TERMINAL.includes(to);
    db.prepare('UPDATE commitments SET status = ?, reason = CASE WHEN ? IN (\'failed\', \'cancelled\') THEN ? ELSE reason END, updated_at = ?, closed_at = ? WHERE id = ?').run(to, to, note, t, closed ? t : null, c.id);
    db.prepare('INSERT INTO commitment_events (commitment_id, user_id, seq, from_status, to_status, note, actor, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(c.id, userId, seq, c.status, to, note || null, o.actor || 'nova', t);
    return row(userId, c.id);
  }

  function summary(userId) {
    const rows = db.prepare('SELECT * FROM commitments WHERE user_id = ?').all(userId);
    const open = rows.filter(c => !TERMINAL.includes(c.status));
    const attention = open.filter(c => c.status !== 'verified').map(c => ({ c, rank: isOverdue(c) ? 0 : c.status === 'awaiting_approval' ? 1 : c.status === 'awaiting_confirmation' ? 2 : 3 })).sort((a, b) => a.rank - b.rank || String(a.c.deadline || '9').localeCompare(String(b.c.deadline || '9'))).slice(0, 5).map(x => x.c);
    return { total: rows.length, iOwe: open.filter(c => c.direction === 'i_owe').length, owedToMe: open.filter(c => c.direction === 'owed_to_me').length, awaitingApproval: open.filter(c => c.status === 'awaiting_approval').length,
      overdue: open.filter(isOverdue).length, awaitingConfirmation: open.filter(c => c.status === 'awaiting_confirmation').length, verified: rows.filter(c => c.status === 'verified' || c.status === 'completed').length,
      failed: rows.filter(c => c.status === 'failed').length, demo: rows.filter(c => c.is_demo).length, attention };
  }
  return { create, addEvidence, transition, summary, row, isOverdue, allowed, evidenceCount };
}
module.exports = { createProofLoop, ProofLoopError, STATES, LABEL, TERMINAL, FORWARD, EVIDENCE_KINDS, DIRECTIONS, allowed, dubaiToday, addDays };

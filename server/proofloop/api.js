// ProofLoop HTTP API, proof receipts and the labelled demo scenarios.
'use strict';
const qr = require('../qr');
const { HttpError, str, oneOf } = require('../http');
const { audit } = require('../security');
const { LABEL, TERMINAL, STATES, EVIDENCE_KINDS, ProofLoopError, dubaiToday, addDays } = require('./machine');
const { loadDemo, resetDemo } = require('./demo');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = ms => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) + ' (Dubai)';
const STATUS_CODE = { not_found: 404, illegal_transition: 409, missing_evidence: 409, reason_required: 400, evidence_failed: 422, invalid: 400 };
const guard = fn => { try { return fn(); } catch (e) { if (e instanceof ProofLoopError || e.code && STATUS_CODE[e.code]) throw new HttpError(STATUS_CODE[e.code] || 400, e.message, e.code); throw e; } };

function createProofLoopApi(cfg, db, pl, adapters, verify) {
  const now = cfg.now;
  const view = c => ({ id: c.id, title: c.title, action: c.action, direction: c.direction, counterparty: c.counterparty, deadline: c.deadline, status: c.status, statusLabel: LABEL[c.status], reason: c.reason, followUpAt: c.follow_up_at,
    isDemo: !!c.is_demo, overdue: pl.isOverdue(c), source: { type: c.source_type, ref: c.source_ref }, taskId: c.task_id, createdAt: c.created_at, updatedAt: c.updated_at, closedAt: c.closed_at,
    next: pl.allowed(c.status, c.direction).map(s => ({ to: s, label: LABEL[s] })) });
  function detail(userId, id) {
    const c = pl.row(userId, id);
    return Object.assign(view(c), {
      events: db.prepare('SELECT seq, from_status, to_status, note, actor, ts FROM commitment_events WHERE commitment_id = ? ORDER BY seq').all(id).map(e => ({ seq: e.seq, from: e.from_status, to: e.to_status, toLabel: LABEL[e.to_status], note: e.note, actor: e.actor, at: e.ts })),
      evidence: db.prepare('SELECT * FROM evidence WHERE commitment_id = ? ORDER BY id').all(id).map(e => ({ id: e.id, kind: e.kind, description: e.description, refType: e.ref_type, refId: e.ref_id, independent: !!e.independent, executionId: e.execution_id, at: e.ts })),
      executions: db.prepare('SELECT id, tool, status, evidence, error, finished_at FROM tool_executions WHERE commitment_id = ? ORDER BY id').all(id).map(e => ({ id: e.id, tool: e.tool, status: e.status, evidence: e.evidence, error: e.error, at: e.finished_at })),
      approvals: db.prepare('SELECT id, tool, status, decided_at, created_at FROM approvals WHERE commitment_id = ? ORDER BY id').all(id).map(a => ({ id: a.id, tool: a.tool, status: a.status, at: a.decided_at || a.created_at }))
    });
  }

  // What the evidence on this commitment does and does not prove, in plain words (this is the honest part of the receipt).
  function claims(d) {
    const kinds = new Set(d.evidence.map(e => e.kind)), out = [];
    if (d.status === 'completed' || d.status === 'verified') {
      const v = d.evidence.filter(e => e.kind === 'verified');
      out.push(v.some(e => e.independent) ? 'Verified by at least one independent check of stored state.' : 'Verified only by your own confirmation (self-reported). NOVA did not independently check the real-world result.');
    } else if (d.status === 'failed') out.push('Failed: ' + (d.reason || 'no reason recorded') + '. Nothing here should be read as done.');
    else if (d.status === 'cancelled') out.push('Cancelled: ' + (d.reason || 'no reason recorded') + '. No outcome is claimed.');
    else if (kinds.has('submitted')) out.push('An action was taken (submitted), but it is NOT verified. A successful action is not proof of delivery, reading or acceptance.');
    else if (kinds.has('draft')) out.push('Only a draft exists. A draft is not a sent message or a completed action.');
    else out.push('No action has been taken yet.');
    if (kinds.has('acknowledged') && !kinds.has('verified')) out.push('Someone acknowledged it. An acknowledgement is not acceptance or completion.');
    if (d.isDemo) out.push('DEMO: this is fictional data used to show how ProofLoop works.');
    return out;
  }
  function receiptMd(d, user) {
    const L = [];
    L.push('# Proof receipt: ' + d.title, '');
    if (d.isDemo) L.push('> **DEMO** · fictional example, not a real commitment', '');
    L.push('- **Commitment:** #' + d.id + ' · ' + (d.direction === 'owed_to_me' ? 'owed to me' : 'I owe') + (d.counterparty ? ' · ' + d.counterparty : ''), '- **Owner:** ' + user.display_name + ' (' + user.email + ')', '- **Status:** ' + d.statusLabel + (d.reason ? ' (' + d.reason + ')' : ''),
      '- **Deadline:** ' + (d.deadline || 'none') + (d.overdue ? ' (OVERDUE)' : ''), '- **Source:** ' + d.source.type + (d.source.ref ? ' · ' + d.source.ref : ''), '');
    L.push('## What this receipt proves', '', ...claims(d).map(x => '- ' + x), '');
    L.push('## Timeline', '', ...d.events.map(e => '1. ' + when(e.at) + ' · **' + e.toLabel + '** · ' + e.actor + (e.note ? ' · ' + e.note : '')), '');
    L.push('## Evidence', '', ...(d.evidence.length ? d.evidence.map(e => '- ' + when(e.at) + ' · **' + e.kind + '**' + (e.kind === 'verified' ? (e.independent ? ' (independent check)' : ' (self-reported)') : '') + ' · ' + e.description) : ['- none']), '');
    L.push('## Tool runs', '', ...(d.executions.length ? d.executions.map(e => '- #' + e.id + ' ' + e.tool + ' · ' + e.status + (e.evidence ? ' · ' + e.evidence : '') + (e.error ? ' · ' + e.error : '')) : ['- none']), '');
    L.push('## Approvals', '', ...(d.approvals.length ? d.approvals.map(a => '- #' + a.id + ' ' + a.tool + ' · ' + a.status + ' · ' + when(a.at)) : ['- none']), '');
    L.push('---', 'Generated by NOVA on ' + when(now()) + '. This receipt records what NOVA saw; it does not guarantee that anyone read, accepted or acted on anything.');
    return L.join('\n');
  }
  // Every export is an issued receipt: its text gets a SHA-256 fingerprint (and a QR code in the printable version) and NOVA
  // remembers the fingerprint, so the receipt can be checked later at /verify. Only the fingerprint is kept, never the content.
  function issued(d, user) {
    const body = verify.normalise(receiptMd(d, user)), fp = verify.fingerprintOf(body), url = cfg.baseUrl ? cfg.baseUrl + '/verify?f=' + fp : null;
    verify.issue(user.id, d.id, fp);
    return { fp, url, text: body + verify.footer(fp, url) };
  }
  function receiptHtml(d, user, iss) {
    const li = a => a.map(x => '<li>' + x + '</li>').join('');
    return '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Proof receipt: ' + esc(d.title) + '</title><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<style>body{font:15px/1.55 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#111}h1{font-size:22px}h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:#444;margin-top:24px}.demo{background:#fff3cd;border:1px solid #e0b300;padding:6px 10px}li{margin:3px 0}.qr{margin:8px 0}.qr svg{display:block}code{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;background:#f6f6f6;padding:10px}.small{color:#555;font-size:13px}@media print{body{margin:0}}</style></head><body>' +
      '<h1>Proof receipt: ' + esc(d.title) + '</h1>' + (d.isDemo ? '<p class="demo"><b>DEMO</b> · fictional example, not a real commitment</p>' : '') +
      '<p>Commitment #' + d.id + ' · ' + (d.direction === 'owed_to_me' ? 'owed to me' : 'I owe') + (d.counterparty ? ' · ' + esc(d.counterparty) : '') + '<br>Owner: ' + esc(user.display_name) + ' (' + esc(user.email) + ')<br>Status: <b>' + esc(d.statusLabel) + '</b>' + (d.reason ? ' (' + esc(d.reason) + ')' : '') + '<br>Deadline: ' + esc(d.deadline || 'none') + (d.overdue ? ' <b>(OVERDUE)</b>' : '') + '<br>Source: ' + esc(d.source.type) + (d.source.ref ? ' · ' + esc(d.source.ref) : '') + '</p>' +
      '<h2>What this receipt proves</h2><ul>' + li(claims(d).map(esc)) + '</ul><h2>Timeline</h2><ol>' + li(d.events.map(e => esc(when(e.at)) + ' · <b>' + esc(e.toLabel) + '</b> · ' + esc(e.actor) + (e.note ? ' · ' + esc(e.note) : ''))) + '</ol>' +
      '<h2>Evidence</h2><ul>' + (d.evidence.length ? li(d.evidence.map(e => esc(when(e.at)) + ' · <b>' + esc(e.kind) + '</b>' + (e.kind === 'verified' ? (e.independent ? ' (independent check)' : ' (self-reported)') : '') + ' · ' + esc(e.description))) : '<li>none</li>') + '</ul>' +
      '<h2>Tool runs</h2><ul>' + (d.executions.length ? li(d.executions.map(e => '#' + e.id + ' ' + esc(e.tool) + ' · ' + esc(e.status) + (e.evidence ? ' · ' + esc(e.evidence) : '') + (e.error ? ' · ' + esc(e.error) : ''))) : '<li>none</li>') + '</ul>' +
      '<h2>Approvals</h2><ul>' + (d.approvals.length ? li(d.approvals.map(a => '#' + a.id + ' ' + esc(a.tool) + ' · ' + esc(a.status) + ' · ' + esc(when(a.at)))) : '<li>none</li>') + '</ul>' +
      '<h2>Fingerprint (SHA-256)</h2><p><code>' + iss.fp + '</code></p>' +
      '<div class="qr">' + qr.toSvg(qr.encode(iss.url || iss.fp), { label: 'QR code: ' + (iss.url ? 'opens the check page for this receipt' : 'the fingerprint of this receipt'), px: 168 }) + '</div>' +
      '<p class="small">' + (iss.url ? 'Scan the code or open <a href="' + esc(iss.url) + '">' + esc(iss.url) + '</a> to check this receipt.' : 'Check this receipt on the NOVA that issued it, at /verify. The code holds the fingerprint.') + ' A match means NOVA issued exactly this text; it does not mean anyone read or accepted anything.</p>' +
      '<details><summary>The exact text that was fingerprinted</summary><pre id="receipt-text">' + esc(iss.text) + '</pre></details>' +
      '<p class="small">Generated by NOVA on ' + esc(when(now())) + '. This receipt records what NOVA saw; it does not guarantee that anyone read, accepted or acted on anything.</p></body></html>';
  }

  function register(router) {
    router.get('/api/proofloop/summary', ctx => { const s = pl.summary(ctx.auth.user.id); return { status: 200, body: Object.assign({}, s, { attention: s.attention.map(view) }) }; });
    router.get('/api/commitments', ctx => {
      const q = ctx.url.searchParams, st = q.get('status'), dir = q.get('direction'), od = q.get('overdue');
      let rows = db.prepare('SELECT * FROM commitments WHERE user_id = ? ORDER BY (deadline IS NULL), deadline, id DESC LIMIT 300').all(ctx.auth.user.id);
      if (st) rows = rows.filter(c => c.status === st); if (dir) rows = rows.filter(c => c.direction === dir); if (od === '1') rows = rows.filter(pl.isOverdue);
      return { status: 200, body: { commitments: rows.map(view), states: STATES.map(s => ({ id: s, label: LABEL[s] })) } };
    });
    router.post('/api/commitments', ctx => {
      const b = ctx.body, title = str(b.title, 'title', { max: 200 }), direction = oneOf(b.direction, 'direction', ['i_owe', 'owed_to_me']);
      const counterparty = str(b.counterparty, 'counterparty', { max: 100, optional: true }), deadline = str(b.deadline, 'deadline', { max: 10, optional: true });
      if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new HttpError(400, 'deadline must look like 2026-10-23.', 'invalid');
      const id = guard(() => { const i = pl.create(ctx.auth.user.id, { title, direction, counterparty, deadline, sourceType: 'manual', sourceRef: 'Mission Control', actor: 'you' }); pl.transition(ctx.auth.user.id, i, 'request_understood', { note: 'You described it.', actor: 'you' }); return i; });
      audit(db, now, ctx.auth.user.id, 'commitment_created', 'id ' + id, ctx.req.socket.remoteAddress);
      return { status: 201, body: { commitment: detail(ctx.auth.user.id, id) } };
    });
    router.get('/api/commitments/:id', ctx => ({ status: 200, body: { commitment: guard(() => detail(ctx.auth.user.id, +ctx.params.id)) } }));
    router.post('/api/commitments/:id/transition', ctx => {
      const to = oneOf(ctx.body.to, 'to', STATES), note = str(ctx.body.note, 'note', { max: 300, optional: true });
      guard(() => pl.transition(ctx.auth.user.id, +ctx.params.id, to, { note, actor: 'you' }));
      audit(db, now, ctx.auth.user.id, 'commitment_' + to, 'id ' + ctx.params.id, ctx.req.socket.remoteAddress);
      return { status: 200, body: { commitment: detail(ctx.auth.user.id, +ctx.params.id) } };
    });
    router.post('/api/commitments/:id/evidence', ctx => {
      const b = ctx.body, kind = oneOf(b.kind, 'kind', EVIDENCE_KINDS), description = str(b.description, 'description', { max: 500 });
      const refType = str(b.refType, 'refType', { max: 30, optional: true }), refId = b.refId === undefined || b.refId === null ? null : b.refId;
      if (refId !== null && !Number.isInteger(refId)) throw new HttpError(400, 'refId must be a whole number.', 'invalid');
      guard(() => pl.addEvidence(ctx.auth.user.id, +ctx.params.id, { kind, description, refType, refId }, adapters));
      audit(db, now, ctx.auth.user.id, 'evidence_added', kind + ' on commitment ' + ctx.params.id, ctx.req.socket.remoteAddress);
      return { status: 201, body: { commitment: detail(ctx.auth.user.id, +ctx.params.id) } };
    });
    router.get('/api/commitments/:id/receipt', ctx => {
      const d = guard(() => detail(ctx.auth.user.id, +ctx.params.id)), fmt = ctx.url.searchParams.get('format') || 'md', user = ctx.auth.user;
      if (fmt !== 'html' && fmt !== 'md') throw new HttpError(400, 'format must be md or html.', 'invalid');
      const iss = issued(d, user);
      if (fmt === 'html') return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'inline; filename="proof-receipt-' + d.id + '.html"' }, body: Buffer.from(receiptHtml(d, user, iss)) };
      return { status: 200, headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="proof-receipt-' + d.id + '.md"' }, body: Buffer.from(iss.text) };
    });
    router.post('/api/demo/load', ctx => { const r = loadDemo({ db, pl, adapters, now }, ctx.auth.user.id); audit(db, now, ctx.auth.user.id, 'demo_loaded', String(r.created), ctx.req.socket.remoteAddress); return { status: 200, body: r }; });
    router.post('/api/demo/reset', ctx => { const r = resetDemo({ db, now }, ctx.auth.user.id); const l = ctx.body.reload === false ? { created: 0 } : loadDemo({ db, pl, adapters, now }, ctx.auth.user.id); audit(db, now, ctx.auth.user.id, 'demo_reset', 'removed ' + r.removed, ctx.req.socket.remoteAddress); return { status: 200, body: { removed: r.removed, created: l.created } }; });
  }
  return { register, detail, view, receiptMd };
}
module.exports = { createProofLoopApi };

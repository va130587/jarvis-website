// Decision journal: record a decision (what, why, what I expect, when to look back). On the review date NOVA adds ONE bell notification asking
// "How did it turn out?" with three answers. Saving and answering go through the normal agent path (preview, approval, verification, undo list),
// so nothing is written without your approval. The honest record ("3 of 5 turned out as expected or better") appears only from 5 reviewed decisions.
'use strict';
const { HttpError, str } = require('./http');
const { audit } = require('./security');
const { parts } = require('./daily/clock');

const OUTCOMES = { as_expected: 'As expected', better: 'Better than expected', worse: 'Worse than expected' }, MIN_RECORD = 5, DELIVER_FROM_HOUR = 9;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = s => DATE.test(String(s)) && !isNaN(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;
const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function createDecisions(cfg, db, { now, notifier, agent }) {
  const today = () => parts(now()).iso;
  const view = (r, t) => ({ id: r.id, title: r.title, why: r.why, expected: r.expected, reviewOn: r.review_on, status: r.status, outcome: r.outcome, outcomeLabel: r.outcome ? OUTCOMES[r.outcome] : null, outcomeNote: r.outcome_note,
    reviewedAt: r.reviewed_at, createdAt: r.created_at, due: r.status === 'open' && r.review_on <= t });
  function record(uid) {
    const rows = db.prepare("SELECT outcome FROM decisions WHERE user_id = ? AND deleted_at IS NULL AND status = 'reviewed'").all(uid), n = rows.length;
    const c = { as_expected: 0, better: 0, worse: 0 }; rows.forEach(r => { if (c[r.outcome] !== undefined) c[r.outcome]++; });
    const good = c.as_expected + c.better, ready = n >= MIN_RECORD;
    return { reviewed: n, asExpected: c.as_expected, better: c.better, worse: c.worse, min: MIN_RECORD, ready,
      line: ready ? good + ' of ' + n + ' turned out as expected or better.' : 'Not enough data yet: ' + n + ' of ' + MIN_RECORD + ' reviewed decisions needed for a record.',
      rule: 'Counted: decisions you have reviewed. "As expected or better" = you answered "As expected" or "Better than expected".' };
  }
  function list(uid) {
    const t = today(), rows = db.prepare('SELECT * FROM decisions WHERE user_id = ? AND deleted_at IS NULL ORDER BY (status = \'open\') DESC, review_on, id DESC LIMIT 300').all(uid).map(r => view(r, t));
    return { today: t, decisions: rows, dueCount: rows.filter(r => r.due).length, record: record(uid), outcomes: Object.keys(OUTCOMES).map(k => ({ id: k, label: OUTCOMES[k] })) };
  }
  // One notification per decision, on its review date (from 09:00 Dubai time), never twice.
  async function deliver() {
    const t = today(), hour = parts(now()).h; if (hour < DELIVER_FROM_HOUR) return 0;
    const due = db.prepare("SELECT * FROM decisions WHERE deleted_at IS NULL AND status = 'open' AND notified_at IS NULL AND review_on <= ?").all(t); let n = 0;
    for (const d of due) {
      const made = await notifier.notify(d.user_id, { kind: 'decision', title: 'How did it turn out?', body: 'You decided: ' + clip(d.title, 120) + '. You expected: ' + clip(d.expected, 120) + '. Open your Decision Journal to answer.', link: '#journal', dedupe: 'decision:' + d.id });
      db.prepare('UPDATE decisions SET notified_at = ? WHERE id = ?').run(now(), d.id); if (made) n++;
    }
    return n;
  }

  function registerTools(registry) {
    const own = (ctx, id) => db.prepare('SELECT * FROM decisions WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, ctx.user.id);
    registry.register({ name: 'decisions.add', risk: 'write', description: 'Record a decision in the owner\'s decision journal, with what they expect and a date to look back.',
      schema: { type: 'object', required: ['title', 'expected', 'reviewOn'], properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, why: { type: 'string', maxLength: 500 }, expected: { type: 'string', minLength: 1, maxLength: 300 }, reviewOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } },
      preview: (ctx, i) => ({ action: 'Record a decision', target: 'NOVA Decision Journal', changes: ['Decision: "' + i.title + '"'].concat(i.why ? ['Why: ' + i.why] : [], ['Expected: ' + i.expected, 'Look back on ' + i.reviewOn]), consequences: 'It is saved in your account. On ' + i.reviewOn + ' NOVA adds one notification asking how it turned out. Nothing is sent to anyone.', undoable: true, undoNote: 'You can undo this: the entry is removed.' }),
      run: (ctx, i) => {
        if (!validDate(i.reviewOn) || i.reviewOn < parts(ctx.now()).iso) throw new Error('The review date must be today or a later date.');
        const r = db.prepare('INSERT INTO decisions (user_id, title, why, expected, review_on, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(ctx.user.id, clip(i.title, 200), i.why ? clip(i.why, 500) : null, clip(i.expected, 300), i.reviewOn, ctx.runId, ctx.now());
        return { id: Number(r.lastInsertRowid), title: clip(i.title, 200), reviewOn: i.reviewOn };
      },
      verify: (ctx, i, o) => { const d = own(ctx, o.id); return d && d.review_on === o.reviewOn ? { ok: true, evidence: 'Read back from the database: decision #' + d.id + ' is saved, to be reviewed on ' + d.review_on + '.' } : { ok: false, evidence: 'The decision could not be read back.' }; },
      undo: (ctx, o) => { db.prepare('UPDATE decisions SET deleted_at = ? WHERE id = ? AND user_id = ?').run(ctx.now(), o.id, ctx.user.id); return 'Decision #' + o.id + ' removed.'; },
      summarize: o => 'Recorded the decision "' + o.title + '". Look back on ' + o.reviewOn + '.' });
    registry.register({ name: 'decisions.review', risk: 'write', description: 'Record how a decision in the owner\'s journal turned out.',
      schema: { type: 'object', required: ['id', 'outcome'], properties: { id: { type: 'integer', minimum: 1 }, outcome: { type: 'string', enum: Object.keys(OUTCOMES) }, note: { type: 'string', maxLength: 300 } } },
      preview: (ctx, i) => { const d = own(ctx, i.id); return { action: 'Record how a decision turned out', target: 'NOVA Decision Journal', changes: d ? ['Decision: "' + d.title + '"', 'Answer: ' + OUTCOMES[i.outcome]].concat(i.note ? ['Note: ' + i.note] : []) : ['Decision #' + i.id + ' was not found'], consequences: 'It counts in your record of decisions. Nothing is sent to anyone.', undoable: true, undoNote: 'You can undo this: the decision goes back to waiting for its review.' }; },
      run: (ctx, i) => { const d = own(ctx, i.id); if (!d) throw new Error('That decision was not found.'); if (d.status === 'reviewed') throw new Error('That decision has already been reviewed.');
        db.prepare("UPDATE decisions SET status = 'reviewed', outcome = ?, outcome_note = ?, reviewed_at = ? WHERE id = ? AND user_id = ?").run(i.outcome, i.note ? clip(i.note, 300) : null, ctx.now(), d.id, ctx.user.id); return { id: d.id, title: d.title, outcome: i.outcome }; },
      verify: (ctx, i, o) => { const d = own(ctx, o.id); return d && d.status === 'reviewed' && d.outcome === o.outcome ? { ok: true, evidence: 'Read back from the database: decision #' + d.id + ' is reviewed (' + OUTCOMES[d.outcome] + ').' } : { ok: false, evidence: 'The answer could not be read back.' }; },
      undo: (ctx, o) => { db.prepare("UPDATE decisions SET status = 'open', outcome = NULL, outcome_note = NULL, reviewed_at = NULL WHERE id = ? AND user_id = ?").run(o.id, ctx.user.id); return 'Decision #' + o.id + ' is waiting for its review again.'; },
      summarize: o => 'Recorded that "' + o.title + '" turned out: ' + OUTCOMES[o.outcome].toLowerCase() + '.' });
  }

  function register(router) {
    router.get('/api/decisions', ctx => ({ status: 200, body: list(ctx.auth.user.id) }));
    const authFor = ctx => ({ user: ctx.auth.user, session: ctx.auth.session, ip: ctx.req.socket.remoteAddress });
    router.post('/api/decisions/start', { group: 'chat' }, async ctx => {
      const b = ctx.body, title = str(b.title, 'title', { max: 200 }), expected = str(b.expected, 'expected', { max: 300 }), why = str(b.why, 'why', { max: 500, optional: true }), reviewOn = str(b.reviewOn, 'reviewOn', { max: 10 });
      if (!validDate(reviewOn)) throw new HttpError(400, 'Choose the date to look back on, for example 2026-11-30.', 'invalid');
      if (reviewOn < today()) throw new HttpError(400, 'The review date must be today or a later date.', 'invalid');
      const input = { title, expected, reviewOn }; if (why) input.why = why;
      const run = await agent.start(authFor(ctx), 'Record a decision: ' + clip(title, 100), { call: { name: 'decisions.add', input }, understood: 'Record the decision "' + clip(title, 80) + '" in your journal (your form)' });
      return { status: 200, body: { run } };
    });
    router.post('/api/decisions/:id/review', { group: 'chat' }, async ctx => {
      const id = +ctx.params.id, outcome = ctx.body.outcome, note = str(ctx.body.note, 'note', { max: 300, optional: true });
      if (!Object.keys(OUTCOMES).includes(outcome)) throw new HttpError(400, 'Choose one answer: As expected, Better than expected or Worse than expected.', 'invalid');
      const d = db.prepare('SELECT * FROM decisions WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, ctx.auth.user.id);
      if (!d) throw new HttpError(404, 'That decision could not be found. Reload the page and try again.', 'not_found');
      if (d.status === 'reviewed') throw new HttpError(409, 'That decision has already been reviewed. Undo that from the Undo list first if you want to answer again.', 'conflict');
      const input = { id, outcome }; if (note) input.note = note;
      const run = await agent.start(authFor(ctx), 'Record how a decision turned out: ' + clip(d.title, 100), { call: { name: 'decisions.review', input }, understood: 'Record that "' + clip(d.title, 80) + '" turned out: ' + OUTCOMES[outcome].toLowerCase() + ' (your button)' });
      return { status: 200, body: { run } };
    });
  }
  return { list, record, deliver, registerTools, register, OUTCOMES };
}
module.exports = { createDecisions };

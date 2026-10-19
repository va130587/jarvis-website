// Memory Vault: what NOVA may remember about its owner. Only approved information; nothing sensitive is stored silently.
// Every query is scoped by user_id. Retrieval is relevance-based so only a few memories ever reach a model.
'use strict';
const { HttpError, str, oneOf } = require('./http');
const { audit } = require('./security');

const KINDS = ['preference', 'goal', 'project', 'contact', 'priority', 'app', 'recurring', 'fact'];
const STOP = new Set('a an and are as at be but by do does for from had has have how i if in into is it its me my of on or our so than that the their then there these they this to was we were what when where which who will with you your about can could should would please tell give show'.split(' '));

// Things that must never be stored by NOVA (secrets) and things that need an explicit "yes, this is sensitive".
const BLOCKED = [[/\b(password|passcode|passwd|pin code|one[- ]time (?:code|password)|otp|cvv|cvc|security code)\b/i, 'a password or code'], [/\b(?:\d[ -]?){13,19}\b/, 'a card or account number'],
  [/\b(api[_ -]?key|secret key|private key|seed phrase|recovery phrase|access token)\b/i, 'a secret key or token'], [/\b(sk-ant-|ya29\.|AIza[0-9A-Za-z_-]{10,})/, 'a secret key or token']];
const SENSITIVE = [[/\b(passport|visa number|emirates id|national id|social security|iban|bank account)\b/i, 'an identity or bank detail'], [/\b784-?\d{4}-?\d{7}-?\d\b/, 'an Emirates ID'],
  [/\b(diagnos|medical|medication|health condition|illness|disability|religio|political|sexual)\w*/i, 'health, religion or other private information'], [/\b(date of birth|dob|home address|phone number|salary)\b/i, 'personal details']];

function classify(text) {
  for (const [rx, why] of BLOCKED) if (rx.test(text)) return { blocked: why, sensitive: true };
  for (const [rx, why] of SENSITIVE) if (rx.test(text)) return { blocked: null, sensitive: true, why };
  return { blocked: null, sensitive: false };
}
const tokens = s => String(s).toLowerCase().replace(/[^a-z0-9؀-ۿ ]+/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
const stem = w => w.replace(/(ing|ed|es|s)$/, '');

function createMemory(db, now) {
  const row = r => r && ({ id: r.id, kind: r.kind, text: r.text, source: r.source, status: r.status, sensitive: !!r.sensitive, createdAt: r.created_at, updatedAt: r.updated_at, lastUsedAt: r.last_used_at });
  const own = (userId, id) => { const r = db.prepare('SELECT * FROM memories WHERE id = ? AND user_id = ?').get(id, userId); if (!r) throw new HttpError(404, 'Memory not found.', 'not_found'); return r; };

  function validate(body, partial) {
    const out = {};
    const text = str(body.text, 'text', { max: 500, optional: partial });
    if (text !== undefined) out.text = text;
    const kind = oneOf(body.kind, 'kind', KINDS, { optional: true });
    if (kind) out.kind = kind;
    return out;
  }

  function add(userId, o) {   // o: { text, kind, source, status, confirmSensitive }
    const c = classify(o.text);
    if (c.blocked) throw new HttpError(422, 'NOVA will not store ' + c.blocked + '. Keep it in a password manager instead.', 'blocked_secret');
    if (c.sensitive && !o.confirmSensitive) throw new HttpError(409, 'This looks like ' + c.why + '. Confirm that you want NOVA to remember it.', 'needs_sensitive_confirmation');
    const t = now();
    const r = db.prepare('INSERT INTO memories (user_id, kind, text, source, status, sensitive, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(userId, o.kind || 'fact', o.text, o.source, o.status || 'active', c.sensitive ? 1 : 0, t, t);
    return row(db.prepare('SELECT * FROM memories WHERE id = ?').get(r.lastInsertRowid));
  }

  function list(userId, status) {
    const rows = status ? db.prepare('SELECT * FROM memories WHERE user_id = ? AND status = ? ORDER BY updated_at DESC, id DESC').all(userId, status)
      : db.prepare("SELECT * FROM memories WHERE user_id = ? AND status IN ('active','proposed') ORDER BY status, updated_at DESC, id DESC").all(userId);
    return rows.map(row);
  }

  // Relevant active memories for a request (keyword overlap, recent first on ties). Nothing is returned when personalisation is off.
  function retrieve(user, query, k) {
    if (!user.personalization) return [];
    const q = new Set(tokens(query).map(stem));
    const rows = db.prepare("SELECT * FROM memories WHERE user_id = ? AND status = 'active'").all(user.id);
    const scored = rows.map(r => { const t = tokens(r.text + ' ' + r.kind).map(stem); let s = 0; for (const w of t) if (q.has(w)) s++; return { r, s: s / Math.sqrt(t.length || 1) }; })
      .filter(x => x.s > 0).sort((a, b) => b.s - a.s || b.r.updated_at - a.r.updated_at).slice(0, k || 5);
    if (scored.length) { const ids = scored.map(x => x.r.id); db.prepare('UPDATE memories SET last_used_at = ? WHERE id IN (' + ids.map(() => '?').join(',') + ')').run(now(), ...ids); }
    return scored.map(x => row(x.r));
  }

  function register(router) {
    router.get('/api/memories', ctx => ({ status: 200, body: { memories: list(ctx.auth.user.id, ctx.url.searchParams.get('status') || null), personalization: !!ctx.auth.user.personalization } }));
    router.post('/api/memories', ctx => {
      const v = validate(ctx.body, false);
      const m = add(ctx.auth.user.id, { text: v.text, kind: v.kind, source: 'you (Memory Vault)', confirmSensitive: ctx.body.confirmSensitive === true });
      audit(db, now, ctx.auth.user.id, 'memory_added', 'id ' + m.id, ctx.req.socket.remoteAddress);
      return { status: 201, body: { memory: m } };
    });
    router.patch('/api/memories/:id', ctx => {
      const cur = own(ctx.auth.user.id, +ctx.params.id), v = validate(ctx.body, true);
      const text = v.text !== undefined ? v.text : cur.text;
      const c = classify(text);
      if (c.blocked) throw new HttpError(422, 'NOVA will not store ' + c.blocked + '.', 'blocked_secret');
      if (c.sensitive && !cur.sensitive && ctx.body.confirmSensitive !== true) throw new HttpError(409, 'This now looks like ' + c.why + '. Confirm that you want NOVA to remember it.', 'needs_sensitive_confirmation');
      db.prepare("UPDATE memories SET text = ?, kind = ?, sensitive = ?, updated_at = ?, source = source || ' (corrected by you)' WHERE id = ? AND user_id = ?")
        .run(text, v.kind || cur.kind, c.sensitive ? 1 : 0, now(), cur.id, ctx.auth.user.id);
      audit(db, now, ctx.auth.user.id, 'memory_corrected', 'id ' + cur.id, ctx.req.socket.remoteAddress);
      return { status: 200, body: { memory: row(own(ctx.auth.user.id, cur.id)) } };
    });
    router.post('/api/memories/:id/approve', ctx => {
      const cur = own(ctx.auth.user.id, +ctx.params.id);
      if (cur.status !== 'proposed') throw new HttpError(409, 'Only a proposed memory can be approved.', 'bad_state');
      if (cur.sensitive && ctx.body.confirmSensitive !== true) throw new HttpError(409, 'This looks sensitive. Confirm that you want NOVA to remember it.', 'needs_sensitive_confirmation');
      db.prepare("UPDATE memories SET status = 'active', updated_at = ? WHERE id = ? AND user_id = ?").run(now(), cur.id, ctx.auth.user.id);
      audit(db, now, ctx.auth.user.id, 'memory_approved', 'id ' + cur.id, ctx.req.socket.remoteAddress);
      return { status: 200, body: { memory: row(own(ctx.auth.user.id, cur.id)) } };
    });
    router.del('/api/memories/:id', ctx => {
      const cur = own(ctx.auth.user.id, +ctx.params.id);
      db.prepare('DELETE FROM memories WHERE id = ? AND user_id = ?').run(cur.id, ctx.auth.user.id);
      audit(db, now, ctx.auth.user.id, cur.status === 'proposed' ? 'memory_rejected' : 'memory_deleted', 'id ' + cur.id, ctx.req.socket.remoteAddress);
      return { status: 200, body: { ok: true } };
    });
  }
  return { add, list, retrieve, register, classify, KINDS };
}
module.exports = { createMemory, classify, tokens, KINDS };

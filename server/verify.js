// Proof receipt fingerprints and the public check. A receipt's text gets a SHA-256 fingerprint; NOVA remembers the fingerprints of
// the receipts it issued (not their content). Anyone can paste a receipt or a fingerprint and learn ONE thing: does this NOVA's
// record agree. The answer never contains any receipt content, names, e-mail addresses or commitment details.
'use strict';
const crypto = require('crypto');
const { HttpError } = require('./http');

const MARK = '**Fingerprint (SHA-256):** `';
const HEX64 = /^[0-9a-f]{64}$/;
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const normalise = s => String(s).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\s+$/, '');

// The text that is fingerprinted is everything before the fingerprint block, exactly as normalise() leaves it.
function fingerprintOf(body) { return sha256(normalise(body)); }
function footer(fp, verifyUrl) {
  return ['', '---', MARK + fp + '`', verifyUrl ? 'Check this receipt: ' + verifyUrl : 'Check this receipt on the NOVA that issued it, at /verify.'].join('\n');
}
// Pasted text -> { body, claimed } when it carries a fingerprint block; { fingerprint } when it is only a fingerprint; null otherwise.
function parse(input) {
  const t = normalise(input);
  const at = t.lastIndexOf('\n---\n' + MARK);
  if (at >= 0) { const rest = t.slice(at + 5 + MARK.length), end = rest.indexOf('`'); const claimed = end >= 0 ? rest.slice(0, end) : ''; return { body: t.slice(0, at), claimed }; }
  const m = /^(?:sha-?256[:\s]*)?`?([0-9a-fA-F]{64})`?$/.exec(t.trim()); if (m) return { fingerprint: m[1].toLowerCase() };
  return null;
}

function createVerify(cfg, db, { now }) {
  const issued = fp => db.prepare('SELECT created_at FROM receipts WHERE fingerprint = ?').get(fp);
  function issue(userId, commitmentId, fp) { db.prepare('INSERT OR IGNORE INTO receipts (user_id, commitment_id, fingerprint, created_at) VALUES (?, ?, ?, ?)').run(userId, commitmentId, fp, now()); }
  const day = ms => new Date(ms + 4 * 3600e3).toISOString().slice(0, 10);

  // The only things this ever says. No pasted text is ever sent back.
  function check(input) {
    const p = parse(input);
    if (!p) return { verdict: 'does_not_match', reason: 'unreadable', message: 'That is not a NOVA proof receipt or a fingerprint. Paste the whole receipt, or its 64-character fingerprint.' };
    if (p.fingerprint) {
      const r = issued(p.fingerprint);
      return r ? { verdict: 'matches', reason: 'issued_here', message: 'This NOVA issued a receipt with this fingerprint on ' + day(r.created_at) + '. To be sure a text is the same receipt, paste the whole receipt instead.', issuedOn: day(r.created_at) }
        : { verdict: 'does_not_match', reason: 'not_issued_here', message: 'This NOVA did not issue a receipt with this fingerprint. It may come from a different NOVA, or the fingerprint was mistyped.' };
    }
    const actual = fingerprintOf(p.body);
    if (!HEX64.test(p.claimed || '')) return { verdict: 'does_not_match', reason: 'no_fingerprint', message: 'The receipt has no readable fingerprint line, so it cannot be checked.' };
    if (actual !== p.claimed) return { verdict: 'does_not_match', reason: 'text_changed', message: 'The text does not match its fingerprint: something in the receipt was changed after it was issued.' };
    const r = issued(actual);
    return r ? { verdict: 'matches', reason: 'issued_here', message: 'This is exactly the receipt this NOVA issued on ' + day(r.created_at) + '. Nothing in it has been changed. (What it proves is stated inside the receipt itself.)', issuedOn: day(r.created_at) }
      : { verdict: 'does_not_match', reason: 'not_issued_here', message: 'The text matches its own fingerprint, but this NOVA did not issue it. It may come from a different NOVA: ask its owner to check it there.' };
  }
  function register(router) {
    router.post('/api/verify', { public: true, group: 'verify' }, ctx => {
      const b = ctx.body, input = b.text !== undefined ? b.text : b.fingerprint;
      if (typeof input !== 'string' || !input.trim()) throw new HttpError(400, 'Paste a receipt or a fingerprint to check.', 'invalid');
      if (input.length > 90000) throw new HttpError(413, 'That is too long to be a receipt.', 'too_long');
      return { status: 200, body: check(input) };
    });
  }
  return { check, issue, register, fingerprintOf, footer, parse, normalise };
}
module.exports = { createVerify, fingerprintOf, footer, parse, normalise, sha256, MARK };

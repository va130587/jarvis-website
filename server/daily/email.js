// Smart Email: Gmail, read-only. NOVA asks Google only for the gmail.readonly scope, stores the tokens encrypted (NOVA_SECRET_KEY),
// copies headers and Gmail's short snippet (never full bodies), sorts each message with reasons, and writes reply DRAFTS that stay in NOVA.
// Sending is not possible: it would need a separate Google permission (gmail.send) plus your approval of each message, and neither exists here.
// A labelled demo inbox (fictional messages) lets you try everything without a Google account.
'use strict';
const crypto = require('crypto');
const { HttpError, str } = require('../http');
const { audit } = require('../security');
const { seal, unseal } = require('../crypto');
const { classify } = require('./classify');
const { dubaiDate } = require('../agent/planner');
const { relDay } = require('./briefing');
const DEMO = require('./gmail-demo.json');

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const PRIORITY_ORDER = { critical: 0, review: 1, important: 2, normal: 3, low: 4 };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const rand = n => crypto.randomBytes(n).toString('base64url');
const decode = s => String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function parseFrom(v) { const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(String(v || '')); return m ? { name: m[1].trim(), addr: m[2].trim().toLowerCase() } : { name: '', addr: String(v || '').trim().toLowerCase() }; }

function createEmail(cfg, db, deps) {
  const now = cfg.now, doFetch = deps.fetch || fetch, pl = deps.pl;
  const googleOk = () => !!(cfg.google.clientId && cfg.google.clientSecret), keyOk = () => !!(cfg.secretKey && cfg.secretKey.length >= 16);
  const conn = userId => db.prepare("SELECT * FROM connections WHERE user_id = ? AND provider = 'gmail'").get(userId);
  const origin = req => cfg.baseUrl || ('http://' + (req.headers.host || (cfg.host + ':' + cfg.port)));

  function status(userId) {
    const c = conn(userId), demo = db.prepare('SELECT COUNT(*) n FROM emails WHERE user_id = ? AND is_demo = 1').get(userId).n;
    const setup = [];
    if (!googleOk()) setup.push('Create a free Google Cloud OAuth client (Web application) and set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.');
    if (!googleOk()) setup.push('Enable the Gmail API for that project and add ' + (cfg.baseUrl || 'http://127.0.0.1:8787') + '/auth/gmail/callback as an authorised redirect URI.');
    if (!keyOk()) setup.push('Set NOVA_SECRET_KEY to a long random string (for example: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"). It encrypts the stored Gmail tokens.');
    return { connected: !!c && c.status === 'connected', status: c ? c.status : 'not_connected', account: c ? c.account : null, scope: 'read-only (gmail.readonly)', lastSyncAt: c ? c.last_sync_at : null, lastError: c ? c.last_error : null,
      googleConfigured: googleOk(), secretKey: keyOk(), canConnect: googleOk() && keyOk(), setup, demoCount: demo, sending: 'not available: NOVA has read-only access' };
  }

  function known(userId) {
    const s = new Set();
    db.prepare('SELECT counterparty FROM commitments WHERE user_id = ? AND counterparty IS NOT NULL').all(userId).forEach(r => s.add(r.counterparty.toLowerCase()));
    return s;
  }
  // Inserts or refreshes messages; keeps drafts and ProofLoop links. Returns the ids of messages that were new.
  function store(userId, msgs, isDemo) {
    const ctx = { today: dubaiDate(now()), known: known(userId) }, fresh = [];
    for (const m of msgs) {
      const c = classify(m, ctx);
      const ex = db.prepare('SELECT id FROM emails WHERE user_id = ? AND provider_id = ?').get(userId, m.id);
      if (ex) db.prepare('UPDATE emails SET labels = ?, priority = ?, category = ?, reasons = ?, deadline = ?, promise = ? WHERE id = ?').run(JSON.stringify(m.labels || []), c.priority, c.category, JSON.stringify(c.reasons), c.deadline, c.promise, ex.id);
      else {
        const r = db.prepare('INSERT INTO emails (user_id, provider_id, thread_id, from_name, from_addr, subject, snippet, received_at, labels, unsubscribe, priority, category, reasons, deadline, promise, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(userId, m.id, m.threadId || null, m.fromName.slice(0, 120), m.fromAddr.slice(0, 200), String(m.subject || '').slice(0, 300), String(m.snippet || '').slice(0, 500), m.receivedAt, JSON.stringify(m.labels || []), m.unsubscribe ? 1 : 0, c.priority, c.category, JSON.stringify(c.reasons), c.deadline, c.promise, isDemo ? 1 : 0, now());
        fresh.push(Number(r.lastInsertRowid));
      }
    }
    return fresh;
  }

  async function google(url, token, o) {
    const r = await doFetch(url, Object.assign({ headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) }, o || {}));
    if (r.status === 401) { const e = new Error('Google no longer accepts NOVA\'s access. Reconnect Gmail.'); e.code = 'reconnect'; throw e; }
    if (!r.ok) throw new Error('Gmail answered HTTP ' + r.status + '.');
    return r.json();
  }
  async function accessToken(c) {
    let tok = unseal(cfg.secretKey, c.token_enc);
    if (tok.expires_at - 60e3 > now()) return tok.access_token;
    if (!tok.refresh_token) { const e = new Error('The Gmail access expired and there is no refresh token. Reconnect Gmail.'); e.code = 'reconnect'; throw e; }
    const r = await doFetch(cfg.google.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ client_id: cfg.google.clientId, client_secret: cfg.google.clientSecret, refresh_token: tok.refresh_token, grant_type: 'refresh_token' }) });
    if (!r.ok) { const e = new Error(r.status === 400 ? 'Google refused to renew the Gmail access (it may have been revoked). Reconnect Gmail.' : 'Could not renew the Gmail access (HTTP ' + r.status + ').'); if (r.status === 400) e.code = 'reconnect'; throw e; }
    const j = await r.json();
    tok = Object.assign(tok, { access_token: j.access_token, expires_at: now() + (j.expires_in || 3600) * 1000 });
    db.prepare('UPDATE connections SET token_enc = ?, updated_at = ? WHERE id = ?').run(seal(cfg.secretKey, tok), now(), c.id);
    return tok.access_token;
  }

  // Reads recent inbox messages (headers + snippet only). Returns { skipped } when not connected.
  async function sync(user) {
    const c = conn(user.id);
    if (!c || c.status === 'disconnected') return { skipped: 'Gmail is not connected.' };
    try {
      const token = await accessToken(c), api = cfg.gmail.apiUrl + '/gmail/v1/users/me/messages';
      const list = await google(api + '?' + new URLSearchParams({ q: 'in:inbox newer_than:7d', maxResults: String(cfg.gmail.maxMessages) }), token);
      const have = new Set(db.prepare('SELECT provider_id FROM emails WHERE user_id = ? AND is_demo = 0').all(user.id).map(r => r.provider_id));
      const msgs = [];
      for (const m of (list.messages || []).slice(0, cfg.gmail.maxMessages)) {
        if (have.has(m.id)) continue;
        const d = await google(api + '/' + encodeURIComponent(m.id) + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe', token);
        const h = {}; ((d.payload && d.payload.headers) || []).forEach(x => { h[String(x.name).toLowerCase()] = x.value; });
        const f = parseFrom(h.from);
        msgs.push({ id: d.id, threadId: d.threadId, fromName: f.name, fromAddr: f.addr, subject: decode(h.subject), snippet: decode(d.snippet), labels: d.labelIds || [], unsubscribe: !!h['list-unsubscribe'], receivedAt: +d.internalDate || now() });
      }
      const fresh = store(user.id, msgs, false);
      db.prepare("UPDATE connections SET status = 'connected', last_sync_at = ?, last_error = NULL, updated_at = ? WHERE id = ?").run(now(), now(), c.id);
      return { fetched: msgs.length, fresh, summary: 'Read ' + msgs.length + ' new message' + (msgs.length === 1 ? '' : 's') + ' (read-only).' };
    } catch (e) {
      db.prepare('UPDATE connections SET status = ?, last_error = ?, updated_at = ? WHERE id = ?').run(e.code === 'reconnect' ? 'needs_reconnect' : c.status, String(e.message).slice(0, 300), now(), c.id);
      if (e.code === 'no_secret_key') throw new Error('NOVA_SECRET_KEY is missing, so the stored Gmail tokens cannot be read.');
      throw e;
    }
  }

  function loadDemo(userId) {
    const t = now();
    const today = dubaiDate(t), MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fill = text => text.replace(/\{\{date\+(\d+)\}\}/g, (_, n) => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + +n); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; });
    const msgs = DEMO.messages.map(m => ({ id: m.id, fromName: m.fromName, fromAddr: m.fromAddr, subject: m.subject, snippet: fill(m.snippet), labels: m.labels || [], unsubscribe: !!m.unsubscribe, receivedAt: t - m.hoursAgo * 3600e3 }));
    return store(userId, msgs, true);
  }

  const view = r => ({ id: r.id, from: { name: r.from_name, addr: r.from_addr }, subject: r.subject, snippet: r.snippet, at: r.received_at, priority: r.priority, category: r.category, reasons: JSON.parse(r.reasons),
    deadline: r.deadline, deadlineLabel: r.deadline ? relDay(r.deadline, dubaiDate(now())) : null, promise: r.promise, isDemo: !!r.is_demo, commitmentId: r.commitment_id,
    gmailUrl: r.is_demo ? null : 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(r.provider_id), drafts: db.prepare('SELECT COUNT(*) n FROM email_drafts WHERE email_id = ?').get(r.id).n });
  const own = (userId, id) => { const r = db.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?').get(id, userId); if (!r) throw new HttpError(404, 'Message not found.', 'not_found'); return r; };
  const draftView = d => ({ id: d.id, emailId: d.email_id, body: d.body, status: d.status, createdAt: d.created_at, updatedAt: d.updated_at });

  function draftFor(user, e) {
    const first = (e.from_name || e.from_addr.split('@')[0]).replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '').split(/[\s(]/)[0] || 'there';
    const lines = ['Hi ' + first + ',', '', 'Thank you for your message about "' + e.subject + '".'];
    if (/interview/i.test(e.subject + e.snippet)) lines.push('I would be glad to attend. [Pick the slot that suits you, for example: Tuesday at 10:00.]');
    else if (e.category === 'needs_reply') lines.push('[Write your answer here.]');
    if (e.deadline) lines.push('I have noted the deadline (' + e.deadline + ') and will get back to you before then.');
    if (e.promise) lines.push('Thank you, I will look out for it.');
    lines.push('', 'Best regards,', user.display_name);
    return lines.join('\n');
  }

  function register(router) {
    router.get('/api/email', ctx => {
      const uid = ctx.auth.user.id, f = ctx.url.searchParams.get('filter') || 'all';
      const all = db.prepare('SELECT * FROM emails WHERE user_id = ? ORDER BY received_at DESC LIMIT 200').all(uid);
      const pick = { all: () => true, critical: r => r.priority === 'critical', important: r => r.priority === 'critical' || r.priority === 'important', needs_reply: r => r.category === 'needs_reply', deadline: r => !!r.deadline, low: r => r.priority === 'low', review: r => r.priority === 'review', tracked: r => !!r.commitment_id }[f];
      if (!pick) throw new HttpError(400, 'Unknown filter.', 'invalid');
      const rows = all.filter(pick).sort((a, b) => (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) || b.received_at - a.received_at);
      const counts = { all: all.length, critical: all.filter(r => r.priority === 'critical').length, important: all.filter(r => r.priority === 'critical' || r.priority === 'important').length, needs_reply: all.filter(r => r.category === 'needs_reply').length,
        deadline: all.filter(r => r.deadline).length, low: all.filter(r => r.priority === 'low').length, review: all.filter(r => r.priority === 'review').length, tracked: all.filter(r => r.commitment_id).length };
      return { status: 200, body: { status: status(uid), emails: rows.map(view), counts } };
    });
    router.get('/api/email/:id', ctx => {
      const e = own(ctx.auth.user.id, +ctx.params.id);
      return { status: 200, body: { email: view(e), drafts: db.prepare('SELECT * FROM email_drafts WHERE email_id = ? ORDER BY id DESC').all(e.id).map(draftView) } };
    });
    router.post('/api/email/sync', async ctx => {
      const c = conn(ctx.auth.user.id);
      if (!c) throw new HttpError(409, 'Gmail is not connected. Connect it first, or load the demo inbox.', 'not_connected');
      try { const out = await sync(ctx.auth.user); audit(db, now, ctx.auth.user.id, 'gmail_sync', String(out.fetched), ctx.req.socket.remoteAddress); return { status: 200, body: { fetched: out.fetched, status: status(ctx.auth.user.id) } }; }
      catch (e) { throw new HttpError(502, e.message, e.code === 'reconnect' ? 'reconnect' : 'sync_failed'); }
    });
    router.post('/api/email/demo', ctx => {
      const n = loadDemo(ctx.auth.user.id).length;
      audit(db, now, ctx.auth.user.id, 'email_demo_loaded', String(n), ctx.req.socket.remoteAddress);
      return { status: 200, body: { added: n } };
    });
    router.post('/api/email/demo/remove', ctx => {
      const r = db.prepare('DELETE FROM emails WHERE user_id = ? AND is_demo = 1').run(ctx.auth.user.id);
      return { status: 200, body: { removed: Number(r.changes) } };
    });

    // Connecting Gmail: a CSRF-protected POST returns Google's consent URL (read-only scope). The callback only accepts a state created by the signed-in person.
    router.post('/api/gmail/connect', ctx => {
      if (!googleOk()) throw new HttpError(503, 'Google is not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).', 'not_configured');
      if (!keyOk()) throw new HttpError(503, 'Set NOVA_SECRET_KEY on the server first: it encrypts the Gmail tokens.', 'no_secret_key');
      const state = rand(24), verifier = rand(48);
      db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(now() - 10 * 60e3);
      db.prepare("INSERT INTO oauth_states (id, nonce, verifier, created_at, purpose, user_id) VALUES (?, '-', ?, ?, 'gmail', ?)").run(sha(state), verifier, now(), ctx.auth.user.id);
      const q = new URLSearchParams({ client_id: cfg.google.clientId, redirect_uri: origin(ctx.req) + '/auth/gmail/callback', response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent',
        include_granted_scopes: 'false', state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', login_hint: ctx.auth.user.email });
      return { status: 200, body: { url: cfg.google.authUrl + '?' + q, scope: SCOPE } };
    });
    router.get('/auth/gmail/callback', { public: true }, async ctx => {
      const back = r => ({ status: 302, headers: { Location: '/?gmail=' + r + '#email' } });
      const p = ctx.url.searchParams, state = p.get('state'), code = p.get('code');
      if (!ctx.auth) return back('signed_out');
      if (p.get('error')) return back('denied');
      if (!state || !code) return back('invalid');
      const row = db.prepare("SELECT * FROM oauth_states WHERE id = ? AND purpose = 'gmail'").get(sha(state));
      db.prepare('DELETE FROM oauth_states WHERE id = ?').run(sha(state));
      if (!row || now() - row.created_at > 10 * 60e3) return back('expired');
      if (row.user_id !== ctx.auth.user.id) { audit(db, now, ctx.auth.user.id, 'gmail_connect_refused', 'state belongs to another account', ctx.req.socket.remoteAddress); return back('invalid'); }
      let tok;
      try {
        const r = await doFetch(cfg.google.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
          body: new URLSearchParams({ code, client_id: cfg.google.clientId, client_secret: cfg.google.clientSecret, redirect_uri: origin(ctx.req) + '/auth/gmail/callback', grant_type: 'authorization_code', code_verifier: row.verifier }) });
        if (!r.ok) return back('exchange');
        tok = await r.json();
      } catch (e) { return back('network'); }
      const granted = String(tok.scope || '').split(/\s+/);
      if (!granted.includes(SCOPE)) return back('scope');
      let account = null;
      try { account = (await google(cfg.gmail.apiUrl + '/gmail/v1/users/me/profile', tok.access_token)).emailAddress || null; } catch (e) { /* the account name is only for display */ }
      const enc = seal(cfg.secretKey, { access_token: tok.access_token, refresh_token: tok.refresh_token || null, expires_at: now() + (tok.expires_in || 3600) * 1000 });
      db.prepare("INSERT INTO connections (user_id, provider, account, scope, token_enc, status, created_at, updated_at) VALUES (?, 'gmail', ?, ?, ?, 'connected', ?, ?) ON CONFLICT(user_id, provider) DO UPDATE SET account = excluded.account, scope = excluded.scope, token_enc = excluded.token_enc, status = 'connected', last_error = NULL, updated_at = excluded.updated_at")
        .run(ctx.auth.user.id, account, granted.join(' '), enc, now(), now());
      audit(db, now, ctx.auth.user.id, 'gmail_connected', 'read-only' + (granted.some(s => /gmail\.(send|modify|compose)|mail\.google\.com/.test(s)) ? ' (Google granted more than asked; NOVA uses read only)' : ''), ctx.req.socket.remoteAddress);
      return back('connected');
    });
    router.post('/api/gmail/disconnect', async ctx => {
      const c = conn(ctx.auth.user.id), uid = ctx.auth.user.id;
      let revoked = false;
      if (c && c.token_enc && keyOk()) {
        try { const t = unseal(cfg.secretKey, c.token_enc); const r = await doFetch(cfg.gmail.revokeUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t.refresh_token || t.access_token }), signal: AbortSignal.timeout(8000) }); revoked = r.ok; }
        catch (e) { /* removing the tokens here is what matters */ }
      }
      db.prepare("DELETE FROM connections WHERE user_id = ? AND provider = 'gmail'").run(uid);
      let removed = 0;
      if (ctx.body.deleteEmails === true) removed = Number(db.prepare('DELETE FROM emails WHERE user_id = ? AND is_demo = 0').run(uid).changes);
      audit(db, now, uid, 'gmail_disconnected', (revoked ? 'revoked at Google' : 'tokens deleted') + (removed ? ', ' + removed + ' messages removed' : ''), ctx.req.socket.remoteAddress);
      return { status: 200, body: { ok: true, revokedAtGoogle: revoked, removed } };
    });

    router.post('/api/email/:id/draft', ctx => {
      const e = own(ctx.auth.user.id, +ctx.params.id), t = now();
      if (e.priority === 'review') throw new HttpError(409, 'This message may be phishing, so NOVA will not help you reply to it. Check it another way first.', 'suspicious');
      const r = db.prepare('INSERT INTO email_drafts (user_id, email_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(ctx.auth.user.id, e.id, draftFor(ctx.auth.user, e), t, t);
      audit(db, now, ctx.auth.user.id, 'email_draft_created', 'message #' + e.id, ctx.req.socket.remoteAddress);
      return { status: 201, body: { draft: draftView(db.prepare('SELECT * FROM email_drafts WHERE id = ?').get(Number(r.lastInsertRowid))), note: 'Draft only. It stays in NOVA and is not sent.' } };
    });
    const ownDraft = (uid, id) => { const d = db.prepare('SELECT * FROM email_drafts WHERE id = ? AND user_id = ?').get(id, uid); if (!d) throw new HttpError(404, 'Draft not found.', 'not_found'); return d; };
    router.patch('/api/email/drafts/:id', ctx => {
      const d = ownDraft(ctx.auth.user.id, +ctx.params.id), body = str(ctx.body.body, 'body', { max: 5000 });
      db.prepare('UPDATE email_drafts SET body = ?, updated_at = ? WHERE id = ?').run(body, now(), d.id);
      return { status: 200, body: { draft: draftView(db.prepare('SELECT * FROM email_drafts WHERE id = ?').get(d.id)) } };
    });
    router.del('/api/email/drafts/:id', ctx => { const d = ownDraft(ctx.auth.user.id, +ctx.params.id); db.prepare('DELETE FROM email_drafts WHERE id = ?').run(d.id); return { status: 200, body: { ok: true } }; });
    router.post('/api/email/drafts/:id/send', ctx => {
      const d = ownDraft(ctx.auth.user.id, +ctx.params.id);
      audit(db, now, ctx.auth.user.id, 'email_send_refused', 'draft #' + d.id + ': no send permission', ctx.req.socket.remoteAddress);
      throw new HttpError(403, 'NOVA cannot send e-mail. It only has read-only access to Gmail. Sending would need a separate Google permission (gmail.send) and your approval of each message, which this version does not have. Copy the draft into Gmail instead.', 'send_not_enabled');
    });
    // Track something from an e-mail in ProofLoop: a promise they made (owed to you), or a reply you owe them.
    router.post('/api/email/:id/track', ctx => {
      const e = own(ctx.auth.user.id, +ctx.params.id);
      if (e.priority === 'review') throw new HttpError(409, 'This message may be phishing; NOVA will not track it.', 'suspicious');
      if (e.commitment_id) return { status: 200, body: { commitmentId: e.commitment_id, existing: true } };
      const who = e.from_name || e.from_addr, owed = !!e.promise;
      const id = pl.create(ctx.auth.user.id, { title: owed ? e.promise.replace(/^(send|share|forward|deliver|email)\s+/i, (m) => m.toLowerCase()) : 'Reply to ' + who + ': ' + e.subject, action: owed ? null : 'Reply to the e-mail',
        direction: owed ? 'owed_to_me' : 'i_owe', counterparty: who, deadline: e.deadline, sourceType: 'email', sourceRef: (e.is_demo ? 'demo e-mail ' : 'gmail ') + e.provider_id, isDemo: !!e.is_demo, actor: 'you' });
      db.prepare('UPDATE emails SET commitment_id = ? WHERE id = ?').run(id, e.id);
      audit(db, now, ctx.auth.user.id, 'email_tracked', 'message #' + e.id + ' -> commitment #' + id, ctx.req.socket.remoteAddress);
      return { status: 201, body: { commitmentId: id, direction: owed ? 'owed_to_me' : 'i_owe' } };
    });
  }
  return { status, sync, loadDemo, register, store, SCOPE };
}
module.exports = { createEmail, parseFrom, SCOPE };

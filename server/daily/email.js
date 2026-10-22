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
// One list of plain "what went wrong, what to do" answers. The Smart Email page, the Help page and the return from Google all use it.
const PROBLEMS = {
  denied: { title: 'Google said no (access denied)', cause: 'Google stopped the connection. This usually means you cancelled at Google, or your Gmail address is not listed as a Test user for this app.', fix: 'In Google Cloud open APIs & Services, then OAuth consent screen, then Test users, add your own Gmail address, then press Connect Gmail again. If Google shows "unverified app", choose Advanced, then Continue.' },
  redirect_mismatch: { title: 'The redirect address does not match', cause: 'The address NOVA sent to Google is not in your OAuth client\'s list of redirect addresses.', fix: 'In Google Cloud open APIs & Services, then Credentials, open your OAuth client and add the Gmail redirect address shown above exactly as written (same http or https, same port, no extra slash). Save, wait a minute, and try again.' },
  api_disabled: { title: 'The Gmail API is switched off', cause: 'Your Google Cloud project has not enabled the Gmail API, so Google refuses to read mail.', fix: 'In Google Cloud open APIs & Services, then Library, search for Gmail API and press Enable. Then press Connect Gmail again. Nothing was connected.' },
  bad_client: { title: 'Wrong client ID or secret', cause: 'Google does not recognise the client ID or client secret that NOVA is using.', fix: 'Copy the Client ID and Client secret again from Google Cloud, Credentials, set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, restart NOVA and try again.' },
  scope: { title: 'Read access was not granted', cause: 'Google did not give NOVA permission to read your mail, so nothing was connected.', fix: 'Press Connect Gmail again and keep the "view your email messages" box ticked on the Google screen.' },
  reconnect: { title: 'The connection expired', cause: 'Google no longer accepts the saved access. It expired or was removed in your Google account.', fix: 'Press Reconnect Gmail. In Testing mode Google also expires access after 7 days, so a weekly reconnect is normal until the app is published.' },
  no_secret_key: { title: 'NOVA_SECRET_KEY is missing', cause: 'NOVA has no secret key to lock the saved Gmail access with, so it refuses to store it.', fix: 'Set NOVA_SECRET_KEY to a long random text (the command is in the steps above), restart NOVA, and connect again.' },
  not_configured: { title: 'Google is not set up on this server', cause: 'NOVA has no Google client ID or client secret yet.', fix: 'Follow the steps above, then set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and restart NOVA.' },
  expired: { title: 'The link expired', cause: 'The connect link is only valid for ten minutes and works once.', fix: 'Press Connect Gmail again.' },
  network: { title: 'NOVA could not reach Google', cause: 'The server has no working internet connection to Google right now.', fix: 'Check the internet connection of the computer that runs NOVA, then try again.' },
  exchange: { title: 'Google refused the connection', cause: 'Google did not accept the code it gave back.', fix: 'Press Connect Gmail again. If it repeats, check the client ID, client secret and redirect address in Google Cloud.' },
  invalid: { title: 'The answer could not be verified', cause: 'The reply from Google did not match the connect request, so NOVA ignored it.', fix: 'Press Connect Gmail again from this same browser and sign-in.' },
  signed_out: { title: 'You were signed out', cause: 'NOVA could not tell who you are when Google sent you back.', fix: 'Sign in to NOVA, then press Connect Gmail again.' },
  google_error: { title: 'Google reported a problem', cause: 'Google stopped the connection and gave a reason NOVA does not recognise.', fix: 'Try again. If it repeats, check the steps above.' }
};
const problemText = k => PROBLEMS[k] ? PROBLEMS[k].cause + ' ' + PROBLEMS[k].fix : 'Gmail: something went wrong.';
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

  // What a first-time user needs, live: the exact addresses for THIS server and a checklist. Only "set / not set": never a value, never a prefix.
  function setupInfo(req) {
    const o = origin(req), host = (/^https?:\/\/([^/:]+|\[[^\]]+\])/i.exec(o) || [])[1] || '', local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host), https = /^https:/i.test(o);
    const checks = [
      { id: 'client_id', label: 'Google client ID is set', state: cfg.google.clientId ? 'ok' : 'todo', fix: 'Set GOOGLE_CLIENT_ID to the Client ID from Google Cloud, Credentials, and restart NOVA.' },
      { id: 'client_secret', label: 'Google client secret is set', state: cfg.google.clientSecret ? 'ok' : 'todo', fix: 'Set GOOGLE_CLIENT_SECRET to the Client secret from the same place, and restart NOVA.' },
      { id: 'secret_key', label: 'NOVA_SECRET_KEY is set (at least 16 characters)', state: keyOk() ? 'ok' : 'todo', fix: 'Set NOVA_SECRET_KEY to a long random text, and restart NOVA. It locks the saved Gmail access.' },
      { id: 'address', label: 'NOVA is opened at localhost or an https address', state: local || https ? 'ok' : 'todo', fix: 'Google only accepts http for localhost. Open NOVA at http://127.0.0.1:' + cfg.port + ' or put it behind https and set BASE_URL.' },
      { id: 'redirect', label: 'The redirect addresses are listed in Google Cloud', state: 'manual', fix: 'NOVA cannot see inside Google Cloud. Compare the two addresses above with your OAuth client, letter for letter.' }
    ];
    return { origin: o, redirectUris: { signIn: o + '/auth/google/callback', gmail: o + '/auth/gmail/callback' }, scope: SCOPE, keyCommand: 'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
      checks, ready: checks.every(c => c.state !== 'todo'), problems: Object.keys(PROBLEMS).map(k => Object.assign({ id: k }, PROBLEMS[k])), messages: Object.keys(PROBLEMS).reduce((m, k) => { m[k] = problemText(k); return m; }, {}) };
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
    if (!r.ok) {
      let body = ''; try { body = await r.text(); } catch (x) { /* the status is enough */ }
      const e = new Error('Gmail answered HTTP ' + r.status + '.'); e.status = r.status;
      if (r.status === 403 && /accessNotConfigured|has not been used|SERVICE_DISABLED|is disabled/i.test(body)) { e.code = 'api_disabled'; e.message = problemText('api_disabled'); }
      throw e;
    }
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
      catch (e) { throw new HttpError(502, e.message, e.code === 'reconnect' || e.code === 'api_disabled' ? e.code : 'sync_failed'); }
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
      if (!googleOk()) throw new HttpError(503, problemText('not_configured'), 'not_configured');
      if (!keyOk()) throw new HttpError(503, problemText('no_secret_key'), 'no_secret_key');
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
      if (p.get('error')) return back(p.get('error') === 'access_denied' ? 'denied' : 'google_error');
      if (!keyOk() || !googleOk()) return back(keyOk() ? 'not_configured' : 'no_secret_key');
      if (!state || !code) return back('invalid');
      const row = db.prepare("SELECT * FROM oauth_states WHERE id = ? AND purpose = 'gmail'").get(sha(state));
      db.prepare('DELETE FROM oauth_states WHERE id = ?').run(sha(state));
      if (!row || now() - row.created_at > 10 * 60e3) return back('expired');
      if (row.user_id !== ctx.auth.user.id) { audit(db, now, ctx.auth.user.id, 'gmail_connect_refused', 'state belongs to another account', ctx.req.socket.remoteAddress); return back('invalid'); }
      let tok;
      try {
        const r = await doFetch(cfg.google.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
          body: new URLSearchParams({ code, client_id: cfg.google.clientId, client_secret: cfg.google.clientSecret, redirect_uri: origin(ctx.req) + '/auth/gmail/callback', grant_type: 'authorization_code', code_verifier: row.verifier }) });
        if (!r.ok) { let j = {}; try { j = await r.json(); } catch (x) { /* no details */ } return back(j.error === 'redirect_uri_mismatch' ? 'redirect_mismatch' : j.error === 'invalid_client' ? 'bad_client' : 'exchange'); }
        tok = await r.json();
      } catch (e) { return back('network'); }
      const granted = String(tok.scope || '').split(/\s+/);
      if (!granted.includes(SCOPE)) return back('scope');
      let account = null;
      try { account = (await google(cfg.gmail.apiUrl + '/gmail/v1/users/me/profile', tok.access_token)).emailAddress || null; } catch (e) { if (e.code === 'api_disabled') return back('api_disabled'); /* otherwise the account name is only for display */ }
      const enc = seal(cfg.secretKey, { access_token: tok.access_token, refresh_token: tok.refresh_token || null, expires_at: now() + (tok.expires_in || 3600) * 1000 });
      db.prepare("INSERT INTO connections (user_id, provider, account, scope, token_enc, status, created_at, updated_at) VALUES (?, 'gmail', ?, ?, ?, 'connected', ?, ?) ON CONFLICT(user_id, provider) DO UPDATE SET account = excluded.account, scope = excluded.scope, token_enc = excluded.token_enc, status = 'connected', last_error = NULL, updated_at = excluded.updated_at")
        .run(ctx.auth.user.id, account, granted.join(' '), enc, now(), now());
      audit(db, now, ctx.auth.user.id, 'gmail_connected', 'read-only' + (granted.some(s => /gmail\.(send|modify|compose)|mail\.google\.com/.test(s)) ? ' (Google granted more than asked; NOVA uses read only)' : ''), ctx.req.socket.remoteAddress);
      return back('connected');
    });
    router.get('/api/gmail/setup', ctx => ({ status: 200, body: setupInfo(ctx.req) }));
    // "Test connection": reads only the newest 5 message headers, stores nothing, changes nothing at Google.
    router.post('/api/gmail/test', async ctx => {
      const c = conn(ctx.auth.user.id);
      if (!c || c.status === 'disconnected') throw new HttpError(409, 'Gmail is not connected yet. Press Connect Gmail first.', 'not_connected');
      if (!keyOk()) throw new HttpError(503, problemText('no_secret_key'), 'no_secret_key');
      try {
        const token = await accessToken(c), api = cfg.gmail.apiUrl + '/gmail/v1/users/me/messages';
        const list = await google(api + '?' + new URLSearchParams({ labelIds: 'INBOX', maxResults: '5' }), token);
        let newest = 0, n = 0;
        for (const m of (list.messages || []).slice(0, 5)) {
          const d = await google(api + '/' + encodeURIComponent(m.id) + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject', token);
          n++; newest = Math.max(newest, +d.internalDate || 0);
        }
        audit(db, now, ctx.auth.user.id, 'gmail_test', 'passed, ' + n + ' headers read', ctx.req.socket.remoteAddress);
        return { status: 200, body: { ok: true, checked: n, newestAt: newest || null, message: n ? 'It works. NOVA read the headers of ' + n + ' recent message' + (n === 1 ? '' : 's') + ' and kept nothing.' : 'It works. Your inbox has no messages to read right now.' } };
      } catch (e) {
        const code = e.code === 'reconnect' ? 'reconnect' : e.code === 'api_disabled' ? 'api_disabled' : e.status === 403 ? 'denied' : 'network';
        audit(db, now, ctx.auth.user.id, 'gmail_test', 'failed: ' + code, ctx.req.socket.remoteAddress);
        return { status: 200, body: { ok: false, code, message: code === 'reconnect' ? problemText('reconnect') : code === 'api_disabled' ? problemText('api_disabled') : code === 'denied' ? 'Google refused to show the messages. Reconnect Gmail and keep the read access ticked.' : 'The test could not finish: ' + String(e.message).slice(0, 120) + ' ' + problemText('network') } };
      }
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
      return { status: 200, body: { ok: true, revokedAtGoogle: revoked, hadAccess: !!(c && c.token_enc), removed } };
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

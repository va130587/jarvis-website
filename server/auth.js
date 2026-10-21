// Identity: Google sign-in (authorization code flow with PKCE, server-side token exchange), a loopback-only dev login for local use and tests,
// and server-side sessions (random id in an HttpOnly cookie; only its SHA-256 hash is stored). Every API route gets its user from the session, never from the request body.
'use strict';
const crypto = require('crypto');
const { HttpError, cookie } = require('./http');
const { audit } = require('./security');

const COOKIE = 'nova_sid';
const b64u = b => Buffer.from(b).toString('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const rand = n => crypto.randomBytes(n || 32).toString('base64url');

function createAuth(cfg, db) {
  const now = cfg.now;

  function publicUser(u) { return u && { id: u.id, email: u.email, displayName: u.display_name, personalization: !!u.personalization, autoLowRisk: !!u.auto_low_risk, createdAt: u.created_at, tourSeen: !!u.tour_done_at, demoSteps: (() => { try { const v = JSON.parse(u.demo_steps || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } })() }; }
  function origin(req) { return cfg.baseUrl || ('http://' + (req.headers.host || (cfg.host + ':' + cfg.port))); }

  function upsertUser(email, name, sub) {
    email = email.toLowerCase();
    let u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!u) {
      const first = (name || email.split('@')[0]).split(/\s+/)[0].slice(0, 60), display = first.charAt(0).toUpperCase() + first.slice(1);
      db.prepare('INSERT INTO users (google_sub, email, display_name, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)').run(sub || null, email, display, now(), now());
      u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    } else {
      db.prepare('UPDATE users SET last_login_at = ?, google_sub = COALESCE(google_sub, ?) WHERE id = ?').run(now(), sub || null, u.id);
    }
    return u;
  }

  function startSession(req, res, user) {
    const id = rand(32), csrf = rand(24), t = now();
    db.prepare('INSERT INTO sessions (id, user_id, csrf, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sha(id), user.id, csrf, t, t, t + cfg.session.absoluteMs, String(req.headers['user-agent'] || '').slice(0, 200));
    res.setHeader('Set-Cookie', cookie(COOKIE, id, { secure: cfg.secureCookies, maxAge: cfg.session.absoluteMs / 1000 }));
    audit(db, now, user.id, 'login', cfg.authMode, req.socket.remoteAddress);
  }

  // Returns { user, session } or null. Expired sessions are deleted.
  function resolve(req) {
    const sid = require('./http').parseCookies(req.headers.cookie)[COOKIE];
    if (!sid) return null;
    const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sha(sid));
    if (!s) return null;
    const t = now();
    if (t > s.expires_at || t - s.last_seen_at > cfg.session.idleMs) { db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id); return null; }
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(t, s.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
    if (!user || (cfg.ownerEmails.length && !cfg.ownerEmails.includes(user.email))) { db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id); return null; }
    return { user, session: s };
  }

  function allowed(email) { return cfg.ownerEmails.includes(String(email || '').toLowerCase()); }

  function register(router) {
    router.get('/api/session', { public: true }, ctx => {
      const a = ctx.auth;
      return { status: 200, body: {
        authenticated: !!a, user: a ? publicUser(a.user) : null, csrf: a ? a.session.csrf : null,
        authMode: cfg.authMode, googleConfigured: !!(cfg.google.clientId && cfg.google.clientSecret), devLogin: cfg.authMode === 'dev',
        aiProvider: cfg.ai.provider, tour: cfg.tour, demo: cfg.demo } };
    });

    router.get('/auth/google/start', { public: true }, ctx => {
      if (cfg.authMode !== 'google' || !cfg.google.clientId || !cfg.google.clientSecret) throw new HttpError(503, 'Google sign-in is not configured on this server.', 'not_configured');
      const state = rand(24), nonce = rand(16), verifier = rand(48);
      db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(now() - 10 * 60e3);
      db.prepare('INSERT INTO oauth_states (id, nonce, verifier, created_at) VALUES (?, ?, ?, ?)').run(sha(state), nonce, verifier, now());
      const q = new URLSearchParams({ client_id: cfg.google.clientId, redirect_uri: origin(ctx.req) + '/auth/google/callback', response_type: 'code', scope: 'openid email profile',
        state, nonce, code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', prompt: 'select_account' });
      return { status: 302, headers: { Location: cfg.google.authUrl + '?' + q } };
    });

    router.get('/auth/google/callback', { public: true }, async ctx => {
      const p = ctx.url.searchParams;
      const fail = (reason) => { audit(db, now, null, 'login_failed', reason, ctx.req.socket.remoteAddress); return { status: 302, headers: { Location: '/?signin=failed&reason=' + encodeURIComponent(reason) } }; };
      if (p.get('error')) return fail('denied');
      const state = p.get('state'), code = p.get('code');
      if (!state || !code) return fail('invalid');
      const row = db.prepare('SELECT * FROM oauth_states WHERE id = ?').get(sha(state));
      db.prepare('DELETE FROM oauth_states WHERE id = ?').run(sha(state));
      if (!row || now() - row.created_at > 10 * 60e3) return fail('expired');
      let tok;
      try {
        const r = await fetch(cfg.google.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
          body: new URLSearchParams({ code, client_id: cfg.google.clientId, client_secret: cfg.google.clientSecret, redirect_uri: origin(ctx.req) + '/auth/google/callback', grant_type: 'authorization_code', code_verifier: row.verifier }) });
        if (!r.ok) return fail('exchange');
        tok = await r.json();
      } catch (e) { return fail('network'); }
      let claims;
      try { claims = JSON.parse(Buffer.from(String(tok.id_token).split('.')[1], 'base64url').toString('utf8')); } catch (e) { return fail('invalid'); }
      // The token came straight from Google's token endpoint over TLS; still check who it is for and that it is fresh.
      if (!cfg.google.issuers.includes(claims.iss) || claims.aud !== cfg.google.clientId || claims.nonce !== row.nonce || !(claims.exp * 1000 > now()) || !claims.email || claims.email_verified === false) return fail('invalid');
      if (!allowed(claims.email)) return fail('not_allowed');
      const user = upsertUser(claims.email, claims.given_name || claims.name, claims.sub);
      const headers = {}; const fakeRes = { setHeader: (k, v) => { headers[k] = v; } };
      startSession(ctx.req, fakeRes, user);
      headers.Location = '/';
      return { status: 302, headers };
    });

    // Local development sign-in: only exists when AUTH_MODE=dev, which the config refuses on non-loopback hosts. The e-mail must be on the allow-list.
    router.post('/auth/dev-login', { public: true }, ctx => {
      if (cfg.authMode !== 'dev') throw new HttpError(404, 'Not found.', 'not_found');
      const email = String(ctx.body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid e-mail address.', 'invalid');
      if (!allowed(email)) { audit(db, now, null, 'login_failed', 'not_allowed', ctx.req.socket.remoteAddress); throw new HttpError(403, 'That e-mail is not on this server\'s allow-list.', 'not_allowed'); }
      const user = upsertUser(email, String(ctx.body.name || ''), null);
      const headers = {}; startSession(ctx.req, { setHeader: (k, v) => { headers[k] = v; } }, user);
      return { status: 200, headers, body: { ok: true, user: publicUser(user) } };
    });

    router.post('/api/logout', ctx => {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(ctx.auth.session.id);
      audit(db, now, ctx.auth.user.id, 'logout', null, ctx.req.socket.remoteAddress);
      return { status: 200, headers: { 'Set-Cookie': cookie(COOKIE, '', { secure: cfg.secureCookies, maxAge: 0 }) }, body: { ok: true } };
    });

    router.get('/api/sessions', ctx => {
      const rows = db.prepare('SELECT id, created_at, last_seen_at, expires_at, user_agent FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC').all(ctx.auth.user.id);
      return { status: 200, body: { sessions: rows.map(r => ({ id: r.id.slice(0, 12), current: r.id === ctx.auth.session.id, createdAt: r.created_at, lastSeenAt: r.last_seen_at, expiresAt: r.expires_at, userAgent: r.user_agent })) } };
    });
    router.post('/api/sessions/revoke-others', ctx => {
      const r = db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(ctx.auth.user.id, ctx.auth.session.id);
      audit(db, now, ctx.auth.user.id, 'sessions_revoked', String(r.changes), ctx.req.socket.remoteAddress);
      return { status: 200, body: { ok: true, revoked: Number(r.changes) } };
    });
  }
  return { resolve, register, publicUser, COOKIE };
}
module.exports = { createAuth };

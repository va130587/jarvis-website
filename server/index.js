// NOVA server: serves the front end and the JSON API from one origin. Run: node server/index.js   (see .env.example)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { load } = require('./config');
const dbm = require('./db');
const { Router, HttpError, readJson, send, str } = require('./http');
const { securityHeaders, RateLimiter, audit } = require('./security');
const { createAuth } = require('./auth');
const { createMemory } = require('./memory');
const { createChat } = require('./chat');
const { createClaude } = require('./ai/claude');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.ics': 'text/calendar', '.md': 'text/plain; charset=utf-8' };
// Only the web front end is public. server/, tests/, node_modules, .nova (the database), .env and package files are never served.
const STATIC_OK = /^\/(index\.html|redirect\.html|[a-z0-9-]+\.(?:js|css))$|^\/(vendor|data|blueprint)\/[A-Za-z0-9._\/-]+$/;

function createApp(over, deps) {
  const cfg = load(process.env, over);
  deps = deps || {};
  if (deps.now) cfg.now = deps.now;
  const db = deps.db || dbm.open(cfg.dbPath);
  const now = cfg.now;
  const limiter = new RateLimiter(now);
  const auth = createAuth(cfg, db);
  const memory = createMemory(db, now);
  const provider = deps.provider || (cfg.ai.provider === 'claude' ? createClaude(cfg, deps) : { name: 'none', model: null, available: () => false });
  const chat = createChat(cfg, db, memory, provider);
  const router = new Router();
  const hdr = securityHeaders(cfg);

  auth.register(router); memory.register(router); chat.register(router);

  router.get('/api/profile', ctx => ({ status: 200, body: { user: auth.publicUser(ctx.auth.user) } }));
  router.patch('/api/profile', ctx => {
    const name = str(ctx.body.displayName, 'displayName', { max: 60, optional: true });
    if (name !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, ctx.auth.user.id);
    if (ctx.body.personalization !== undefined) {
      if (typeof ctx.body.personalization !== 'boolean') throw new HttpError(400, 'personalization must be true or false.', 'invalid');
      db.prepare('UPDATE users SET personalization = ? WHERE id = ?').run(ctx.body.personalization ? 1 : 0, ctx.auth.user.id);
    }
    audit(db, now, ctx.auth.user.id, 'profile_updated', Object.keys(ctx.body).filter(k => ['displayName', 'personalization'].includes(k)).join(','), ctx.req.socket.remoteAddress);
    return { status: 200, body: { user: auth.publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.auth.user.id)) } };
  });
  router.get('/api/audit', ctx => ({ status: 200, body: { entries: db.prepare('SELECT ts, action, detail FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(ctx.auth.user.id).map(r => ({ at: r.ts, action: r.action, detail: r.detail })) } }));
  router.get('/api/export', ctx => {
    const id = ctx.auth.user.id;
    return { status: 200, headers: { 'Content-Disposition': 'attachment; filename="nova-export.json"' }, body: { exportedAt: now(), user: auth.publicUser(ctx.auth.user),
      memories: memory.list(id), conversations: db.prepare('SELECT id, title FROM conversations WHERE user_id = ?').all(id).map(c => Object.assign({}, c, { messages: db.prepare('SELECT role, content, created_at FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY id').all(c.id, id) })) } };
  });
  // Deleting your data: 'memories' keeps the account; 'all' also removes conversations, activity, usage and the account itself (sessions end).
  router.post('/api/data/delete', ctx => {
    const scope = ctx.body.scope, id = ctx.auth.user.id;
    if (!['memories', 'all'].includes(scope)) throw new HttpError(400, 'scope must be "memories" or "all".', 'invalid');
    if (ctx.body.confirm !== 'DELETE MY DATA') throw new HttpError(400, 'Type DELETE MY DATA to confirm.', 'confirm_required');
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM memories WHERE user_id = ?').run(id);
      if (scope === 'all') {
        for (const t of ['messages', 'conversations', 'activity', 'usage_ledger', 'sessions']) db.prepare('DELETE FROM ' + t + ' WHERE user_id = ?').run(id);
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit(db, now, scope === 'all' ? null : id, 'data_deleted', scope + ' (user ' + id + ')', ctx.req.socket.remoteAddress);
    return { status: 200, headers: scope === 'all' ? { 'Set-Cookie': require('./http').cookie(auth.COOKIE, '', { secure: cfg.secureCookies, maxAge: 0 }) } : {}, body: { ok: true, scope } };
  });
  router.get('/api/health', { public: true }, () => ({ status: 200, body: { ok: true, name: 'NOVA', time: now() } }));

  function serveStatic(req, res, pathname) {
    if (pathname === '/') pathname = '/index.html';
    if (!STATIC_OK.test(pathname) || pathname.includes('..')) return send(res, 404, 'Not found', hdr);
    const file = path.join(cfg.root, pathname);
    if (!file.startsWith(cfg.root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', hdr);
    res.writeHead(200, Object.assign({ 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, hdr));
    fs.createReadStream(file).pipe(res);
  }

  async function onRequest(req, res) {
    const url = new URL(req.url, 'http://x');
    try {
      const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/');
      if (!isApi) { if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', hdr); return serveStatic(req, res, url.pathname); }
      for (const [k, v] of Object.entries(hdr)) res.setHeader(k, v);
      const ip = req.socket.remoteAddress || 'unknown';
      const m = router.match(req.method, url.pathname);
      if (!m.route) throw new HttpError(m.pathHit ? 405 : 404, m.pathHit ? 'Method not allowed.' : 'Not found.', m.pathHit ? 'method' : 'not_found');
      const a = auth.resolve(req);
      const group = url.pathname.startsWith('/auth/') ? 'auth' : (m.route.opts.group || 'api');
      const lim = cfg.limits[group], rl = limiter.check(group + ':' + (a && group !== 'auth' ? 'user' + a.user.id : ip), lim.max, lim.perMs);
      if (!rl.ok) { res.setHeader('Retry-After', String(rl.retryAfter)); throw new HttpError(429, 'Too many requests. Try again in ' + rl.retryAfter + ' seconds.', 'rate_limited'); }
      if (!m.route.opts.public && !a) throw new HttpError(401, 'Please sign in.', 'unauthenticated');
      if (!m.route.opts.public && a && !['GET', 'HEAD'].includes(req.method)) {
        const o = req.headers.origin;
        if (o && new URL(o).host !== req.headers.host) throw new HttpError(403, 'Cross-site request blocked.', 'bad_origin');
        if (req.headers['x-nova-csrf'] !== a.session.csrf) throw new HttpError(403, 'Missing or wrong security token. Reload the page.', 'csrf');
      }
      const ctx = { req, res, url, params: m.params, auth: a, body: ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readJson(req) : {} };
      const out = await m.route.handler(ctx);
      send(res, out.status, out.body === undefined ? '' : out.body, out.headers);
    } catch (e) {
      if (e instanceof HttpError) { if (e.status === 413) res.on('finish', () => req.destroy()); if (!res.headersSent) send(res, e.status, { error: { code: e.code, message: e.message } }, e.status === 429 ? { 'Retry-After': res.getHeader('Retry-After') || '30' } : undefined); return; }
      console.error('[nova] unexpected error on ' + req.method + ' ' + url.pathname + ': ' + String(e && e.message).slice(0, 200));
      if (!res.headersSent) send(res, 500, { error: { code: 'server_error', message: 'Something went wrong on the server. Nothing was changed.' } });
    }
  }

  const server = http.createServer((req, res) => { onRequest(req, res); });
  const sweeper = setInterval(() => { limiter.sweep(); db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()); }, 10 * 60e3); sweeper.unref();
  return {
    cfg, db, server, memory, provider,
    listen() { return new Promise(r => server.listen(cfg.port, cfg.host, () => r(server.address().port))); },
    close() { clearInterval(sweeper); return new Promise(r => server.close(() => { try { db.close(); } catch (e) { /* closed */ } r(); })); }
  };
}

if (require.main === module) {
  try {
    const app = createApp();
    if (!app.cfg.ownerEmails.length) { console.error('Set OWNER_EMAILS (comma-separated e-mail addresses that may sign in). See .env.example.'); process.exit(1); }
    app.listen().then(p => {
      console.log('NOVA is running at http://' + app.cfg.host + ':' + p + '  (auth: ' + app.cfg.authMode + ', AI: ' + app.cfg.ai.provider + ')');
      if (app.cfg.authMode === 'dev') console.log('Development sign-in is ON (loopback only). Do not expose this server to a network.');
    });
  } catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = { createApp };

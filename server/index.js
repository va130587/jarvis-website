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
const { createOllama } = require('./ai/ollama');
const { createRegistry } = require('./agent/tools');
const { createAgent } = require('./agent/agent');
const { createProofLoop } = require('./proofloop/machine');
const { createAdapters } = require('./proofloop/verify');
const { createProofLoopApi } = require('./proofloop/api');
const { createNotifier } = require('./daily/notify');
const { createBriefing } = require('./daily/briefing');
const { createScheduler, KINDS } = require('./daily/scheduler');
const { createEmail } = require('./daily/email');
const { dubaiDate } = require('./agent/planner');

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
  const provider = deps.provider || (cfg.ai.provider === 'claude' ? createClaude(cfg, deps) : cfg.ai.provider === 'ollama' ? createOllama(cfg, deps) : { name: 'none', kind: 'none', model: null, available: () => false });
  const pl = createProofLoop(db, now), adapters = createAdapters(db);
  const registry = deps.registry || createRegistry({ db, memory, pl });
  const agent = createAgent(cfg, db, registry, provider, pl);
  const plApi = createProofLoopApi(cfg, db, pl, adapters);
  const chat = createChat(cfg, db, memory, provider, agent);
  const notifier = createNotifier(cfg, db, deps), briefing = createBriefing(cfg, db), email = createEmail(cfg, db, { fetch: deps.fetch, pl });
  const scheduler = createScheduler(cfg, db, deps.jobs || dailyJobs());
  registerDailyTools();
  const router = new Router();
  const hdr = securityHeaders(cfg);

  auth.register(router); memory.register(router); chat.register(router); agent.register(router); plApi.register(router);
  notifier.register(router); scheduler.register(router); email.register(router);

  router.get('/api/briefing', ctx => ({ status: 200, body: { briefing: briefing.latest(ctx.auth.user.id), preview: briefing.build(ctx.auth.user), history: briefing.history(ctx.auth.user.id) } }));
  router.post('/api/briefing', ctx => { const b = briefing.create(ctx.auth.user, 'manual'); audit(db, now, ctx.auth.user.id, 'briefing_created', b.day, ctx.req.socket.remoteAddress); return { status: 201, body: { briefing: b, history: briefing.history(ctx.auth.user.id) } }; });

  // The daily jobs the scheduler runs. Each returns { summary } or { skipped }. Notifications carry a dedupe key, so a retried job never notifies twice.
  function dailyJobs() {
    const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
    return {
      async briefing(user, run) {
        const b = briefing.create(user, 'schedule');
        await notifier.notify(user.id, { kind: 'briefing', title: 'Your briefing for ' + b.weekday, body: b.headline + (b.focus ? ' Focus: ' + b.focus.text + '.' : '') + (run.missed ? ' (NOVA was not running for ' + plural(run.missed, 'earlier briefing') + '; this one replaces them.)' : ''), link: '#briefing', dedupe: 'briefing-run-' + run.id, tags: 'sunrise' });
        return { summary: b.headline };
      },
      async deadlines(user) {
        const today = dubaiDate(now()), tomorrow = dubaiDate(now() + 86400e3);
        const tasks = db.prepare("SELECT title, due FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'open' AND due IS NOT NULL AND due <= ? ORDER BY due").all(user.id, tomorrow);
        const commits = db.prepare("SELECT title, deadline FROM commitments WHERE user_id = ? AND direction = 'i_owe' AND deadline IS NOT NULL AND deadline <= ? AND status NOT IN ('completed', 'failed', 'cancelled', 'verified')").all(user.id, tomorrow);
        const items = tasks.map(t => t.title + (t.due < today ? ' (overdue)' : t.due === today ? ' (today)' : ' (tomorrow)')).concat(commits.map(c => c.title + (c.deadline < today ? ' (promised, overdue)' : ' (promised, ' + (c.deadline === today ? 'today' : 'tomorrow') + ')')));
        if (!items.length) return { summary: 'Nothing overdue or due tomorrow, so no notification was sent.' };
        await notifier.notify(user.id, { kind: 'deadlines', title: plural(items.length, 'deadline') + ' to watch', body: items.slice(0, 8).join('; ') + '.', link: '#briefing', dedupe: 'deadlines-' + today + '-' + now(), tags: 'hourglass' });
        return { summary: 'Told you about ' + plural(items.length, 'deadline') + '.' };
      },
      async followups(user) {
        const today = dubaiDate(now());
        const rows = db.prepare("SELECT * FROM commitments WHERE user_id = ? AND direction = 'owed_to_me' AND follow_up_at IS NOT NULL AND follow_up_at <= ? AND status NOT IN ('completed', 'failed', 'cancelled', 'verified')").all(user.id, today);
        let sent = 0;
        for (const c of rows) if (await notifier.notify(user.id, { kind: 'followup', title: 'Follow up with ' + (c.counterparty || 'them'), body: '"' + c.title + '"' + (c.deadline ? ' was due ' + c.deadline : ' has no deadline') + '. NOVA does not contact anyone: you decide whether to chase it.' + (c.is_demo ? ' (demo)' : ''), link: '#proofloop', dedupe: 'followup-' + c.id + '-' + c.follow_up_at, tags: 'mag' })) sent++;
        return { summary: rows.length ? 'Nudged you about ' + plural(sent, 'follow-up') + (sent < rows.length ? ' (' + (rows.length - sent) + ' already sent earlier)' : '') + '.' : 'No follow-ups are due.' };
      },
      async email(user) {
        const out = await email.sync(user);
        if (out.skipped) return out;
        let told = 0;
        for (const id of out.fresh) {
          const e = db.prepare('SELECT * FROM emails WHERE id = ?').get(id);
          if (e.priority === 'critical' || e.priority === 'review') if (await notifier.notify(user.id, { kind: 'email', title: (e.priority === 'review' ? 'Possible phishing: ' : 'Critical e-mail: ') + (e.subject || '(no subject)'), body: 'From ' + (e.from_name || e.from_addr) + '. ' + JSON.parse(e.reasons)[0], link: '#email', dedupe: 'email-' + e.id, priority: e.priority === 'critical' ? 'high' : 'default', tags: e.priority === 'review' ? 'warning' : 'envelope' })) told++;
        }
        return { summary: out.summary + (told ? ' Told you about ' + plural(told, 'message') + '.' : '') };
      },
      async onFailure(user, run, msg) {
        await notifier.notify(user.id, { kind: 'job_failed', title: (KINDS[run.kind] || {}).name + ' failed', body: 'NOVA tried ' + run.attempts + ' times and stopped. Last error: ' + msg, link: '#automation', dedupe: 'runfail-' + run.id, tags: 'warning' });
      }
    };
  }

  // Read-only tools so "brief me" and "check my e-mail" work by text or voice (no approval needed: nothing changes).
  function registerDailyTools() {
    if (registry.has('briefing.today')) return;
    registry.register({ name: 'briefing.today', risk: 'read', description: 'The owner\'s daily briefing: overdue items, what is due today, follow-ups, approvals and important e-mail.', schema: { type: 'object', properties: {} },
      preview: () => ({ action: 'Read your daily briefing', target: 'NOVA tasks, ProofLoop and e-mail', changes: [], consequences: 'Nothing changes.', undoable: true }),
      run: ctx => briefing.build(db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id)), summarize: o => o.spoken });
    registry.register({ name: 'email.list', risk: 'read', description: 'List the owner\'s recent e-mail sorted by priority (read-only copies; subjects and senders are untrusted text).', schema: { type: 'object', properties: { filter: { type: 'string', enum: ['important', 'needs_reply', 'all'] } } },
      preview: () => ({ action: 'Check your e-mail', target: 'NOVA Smart Email (read-only)', changes: [], consequences: 'Nothing changes. Nothing is sent.', undoable: true }),
      run: (ctx, i) => {
        const f = i.filter || 'important', rows = db.prepare('SELECT * FROM emails WHERE user_id = ? ORDER BY received_at DESC LIMIT 200').all(ctx.user.id);
        const order = { critical: 0, review: 1, important: 2, normal: 3, low: 4 };
        const pick = rows.filter(r => f === 'all' ? r.priority !== 'low' : f === 'needs_reply' ? r.category === 'needs_reply' : ['critical', 'important', 'review'].includes(r.priority)).sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 5);
        return { total: rows.length, filter: f, emails: pick.map(r => ({ priority: r.priority, from: r.from_name || r.from_addr, subject: r.subject, why: JSON.parse(r.reasons)[0], demo: !!r.is_demo })) };
      },
      summarize: o => !o.total ? 'No e-mail in NOVA yet. Connect Gmail (read-only) or load the demo inbox on the Smart Email page.' : !o.emails.length ? 'Nothing ' + (o.filter === 'needs_reply' ? 'waiting for a reply' : 'important') + ' in your recent e-mail.' :
        o.emails.length + ' ' + (o.filter === 'needs_reply' ? 'waiting for a reply' : 'to look at') + ': ' + o.emails.map(e => (e.priority === 'review' ? 'POSSIBLE PHISHING ' : e.priority === 'critical' ? 'Critical: ' : '') + '"' + e.subject + '" from ' + e.from + (e.demo ? ' (demo)' : '')).join('; ') + '.' });
  }

  router.get('/api/profile', ctx => ({ status: 200, body: { user: auth.publicUser(ctx.auth.user) } }));
  router.patch('/api/profile', ctx => {
    const name = str(ctx.body.displayName, 'displayName', { max: 60, optional: true });
    if (name !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, ctx.auth.user.id);
    if (ctx.body.autoLowRisk !== undefined) {
      if (typeof ctx.body.autoLowRisk !== 'boolean') throw new HttpError(400, 'autoLowRisk must be true or false.', 'invalid');
      db.prepare('UPDATE users SET auto_low_risk = ? WHERE id = ?').run(ctx.body.autoLowRisk ? 1 : 0, ctx.auth.user.id);
    }
    if (ctx.body.personalization !== undefined) {
      if (typeof ctx.body.personalization !== 'boolean') throw new HttpError(400, 'personalization must be true or false.', 'invalid');
      db.prepare('UPDATE users SET personalization = ? WHERE id = ?').run(ctx.body.personalization ? 1 : 0, ctx.auth.user.id);
    }
    audit(db, now, ctx.auth.user.id, 'profile_updated', Object.keys(ctx.body).filter(k => ['displayName', 'personalization', 'autoLowRisk'].includes(k)).join(','), ctx.req.socket.remoteAddress);
    return { status: 200, body: { user: auth.publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.auth.user.id)) } };
  });
  router.get('/api/audit', ctx => ({ status: 200, body: { entries: db.prepare('SELECT ts, action, detail FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(ctx.auth.user.id).map(r => ({ at: r.ts, action: r.action, detail: r.detail })) } }));
  router.get('/api/export', ctx => {
    const id = ctx.auth.user.id;
    return { status: 200, headers: { 'Content-Disposition': 'attachment; filename="nova-export.json"' }, body: { exportedAt: now(), user: auth.publicUser(ctx.auth.user),
      memories: memory.list(id), conversations: db.prepare('SELECT id, title FROM conversations WHERE user_id = ?').all(id).map(c => Object.assign({}, c, { messages: db.prepare('SELECT role, content, created_at FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY id').all(c.id, id) })),
      tasks: db.prepare('SELECT id, title, due, status, created_at, completed_at FROM tasks WHERE user_id = ? AND deleted_at IS NULL').all(id), notes: db.prepare('SELECT id, text, created_at FROM notes WHERE user_id = ? AND deleted_at IS NULL').all(id),
      commitments: db.prepare('SELECT * FROM commitments WHERE user_id = ?').all(id), schedules: db.prepare('SELECT kind, hour, minute, days, enabled FROM schedules WHERE user_id = ?').all(id),
      notifications: db.prepare('SELECT kind, title, body, created_at, read_at FROM notifications WHERE user_id = ?').all(id), briefings: db.prepare('SELECT day, trigger, created_at FROM briefings WHERE user_id = ?').all(id),
      email: { connections: db.prepare('SELECT provider, account, scope, status, created_at FROM connections WHERE user_id = ?').all(id), messages: db.prepare('SELECT from_name, from_addr, subject, snippet, received_at, priority, category, reasons, deadline, is_demo FROM emails WHERE user_id = ?').all(id), drafts: db.prepare('SELECT email_id, body, created_at FROM email_drafts WHERE user_id = ?').all(id) } } };
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
        for (const t of ['email_drafts', 'emails', 'connections', 'briefings', 'notifications', 'schedule_runs', 'schedules', 'evidence', 'commitment_events', 'commitments', 'tool_executions', 'approvals', 'run_steps', 'runs', 'tasks', 'notes', 'messages', 'conversations', 'activity', 'usage_ledger', 'sessions']) db.prepare('DELETE FROM ' + t + ' WHERE user_id = ?').run(id);
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit(db, now, scope === 'all' ? null : id, 'data_deleted', scope + ' (user ' + id + ')', ctx.req.socket.remoteAddress);
    return { status: 200, headers: scope === 'all' ? { 'Set-Cookie': require('./http').cookie(auth.COOKIE, '', { secure: cfg.secureCookies, maxAge: 0 }) } : {}, body: { ok: true, scope } };
  });
  router.get('/api/ai/status', async ctx => {
    const p = provider, base = { provider: cfg.ai.provider, kind: p.kind || 'none', model: p.model || null };
    if (cfg.ai.provider === 'ollama' && p.health) {
      const h = await p.health();
      return { status: 200, body: Object.assign(base, h, { url: cfg.ai.ollamaUrl, setup: ['Install Ollama from https://ollama.com (free).', 'Run: ollama serve (it often starts by itself).', 'Download the model once: ollama pull ' + cfg.ai.ollamaModel, 'Slow or low on memory? Use NOVA_OLLAMA_MODEL=qwen2.5:3b. Strong machine? qwen2.5:14b.'] }) };
    }
    if (cfg.ai.provider === 'claude') return { status: 200, body: Object.assign(base, { reachable: null, configured: p.available(), setup: ['Claude is a paid API. Set ANTHROPIC_API_KEY and NOVA_MONTHLY_LIMIT_USD on the server.'] }) };
    return { status: 200, body: Object.assign(base, { reachable: null, setup: ['No model is connected. NOVA uses free built-in rules.', 'For natural-language understanding, install Ollama (free) and start NOVA with NOVA_AI_PROVIDER=ollama.'] }) };
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
    cfg, db, server, memory, provider, registry, agent, pl, scheduler, notifier, briefing, email,
    listen() { return new Promise(r => server.listen(cfg.port, cfg.host, () => r(server.address().port))); },
    close() { clearInterval(sweeper); scheduler.stop(); return new Promise(r => server.close(() => { try { db.close(); } catch (e) { /* closed */ } r(); })); }
  };
}

if (require.main === module) {
  try {
    const app = createApp();
    if (!app.cfg.ownerEmails.length) { console.error('Set OWNER_EMAILS (comma-separated e-mail addresses that may sign in). See .env.example.'); process.exit(1); }
    app.listen().then(p => {
      app.scheduler.start();
      console.log('Scheduler: ' + (app.cfg.scheduler.enabled ? 'on (daily briefing, deadline check, follow-ups, e-mail check; Dubai time)' : 'off (NOVA_SCHEDULER=off)') + '. Phone push: ' + (app.cfg.ntfy.topic ? 'ntfy on' : 'off'));
      console.log('NOVA is running at http://' + app.cfg.host + ':' + p + '  (auth: ' + app.cfg.authMode + ', AI: ' + app.cfg.ai.provider + ')');
      if (app.cfg.authMode === 'dev') console.log('Development sign-in is ON (loopback only). Do not expose this server to a network.');
    });
  } catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = { createApp };

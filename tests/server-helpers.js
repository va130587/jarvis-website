// Helpers for the NOVA server tests: boot an in-process server with an in-memory (or temp-file) database and a cookie-keeping client.
'use strict';
const { createApp } = require('../server');

const opened = [];
const OWNERS = 'roshan@example.com,mallory@example.com';
async function boot(env, deps) {
  const app = createApp(Object.assign({ AUTH_MODE: 'dev', OWNER_EMAILS: OWNERS, NOVA_DB: ':memory:', PORT: '0', HOST: '127.0.0.1' }, env || {}), deps);
  const port = await app.listen();
  const base = 'http://127.0.0.1:' + port;
  opened.push(app);
  function client() {
    let cookie = '', csrf = '';
    const c = {
      base, app,
      async raw(method, path, body, headers) {
        const h = Object.assign({}, headers || {});
        if (cookie) h.cookie = cookie;
        if (csrf && !('x-nova-csrf' in h)) h['x-nova-csrf'] = csrf;
        if (body !== undefined && !h['content-type']) h['content-type'] = 'application/json';
        const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual' });
        const sc = r.headers.get('set-cookie'); if (sc) { const kv = sc.split(';')[0]; cookie = /=$/.test(kv) ? '' : kv; }
        return r;
      },
      async req(method, path, body, headers) { const r = await c.raw(method, path, body, headers); let j = null; try { j = await r.clone().json(); } catch (e) { /* not json */ } return { status: r.status, json: j, headers: r.headers }; },
      get: (p) => c.req('GET', p), post: (p, b) => c.req('POST', p, b === undefined ? {} : b), patch: (p, b) => c.req('PATCH', p, b), del: (p) => c.req('DELETE', p),
      async login(email, name) {
        const r = await c.req('POST', '/auth/dev-login', { email, name });
        if (r.status !== 200) return r;
        const s = await c.get('/api/session'); csrf = s.json.csrf; return r;
      },
      setCsrf(v) { csrf = v; }, cookie: () => cookie
    };
    return c;
  }
  return { app, base, client, close: () => app.close() };
}
async function closeAll() { while (opened.length) { const a = opened.pop(); a.server.closeAllConnections && a.server.closeAllConnections(); await a.close().catch(() => {}); } }
module.exports = { boot, closeAll };

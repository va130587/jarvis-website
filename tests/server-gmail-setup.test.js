// Gmail setup help (server, stand-in Google): exact addresses for this server, a live checklist that never shows a secret, one plain
// cause-and-fix message for every way connecting can fail, "Test connection" (5 headers, stores nothing) and Disconnect (revokes at Google).
// Every request NOVA makes to Gmail is a GET, and the only permission asked for is gmail.readonly.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { boot, closeAll } = require('./server-helpers');
const stand = [];
test.after(async () => { await closeAll(); for (const g of stand) await g.close().catch(() => {}); });

const SECRET = 'a-long-random-test-key-0123456789', CSECRET = 'client-secret-XYZ-987', SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const msgs = Array.from({ length: 8 }, (_, i) => ({ id: 'm' + i, threadId: 't' + i, internalDate: String(Date.now() - i * 3600e3), labelIds: ['INBOX'], snippet: 'Hello ' + i, payload: { headers: [{ name: 'From', value: 'A <a@x.example>' }, { name: 'Subject', value: 'Hi ' + i }] } }));

function google() {
  const g = { scope: SCOPE, exchange: null, profile: 200, listStatus: 200, revokeFails: false, revoked: [], calls: [] };
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      let body = ''; req.on('data', d => { body += d; });
      req.on('end', () => {
        g.calls.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body });
        const json = (st, o) => { resp.writeHead(st, { 'Content-Type': 'application/json' }); resp.end(JSON.stringify(o)); };
        if (req.url === '/token') { const f = new URLSearchParams(body); if (f.get('grant_type') === 'refresh_token') return json(400, { error: 'invalid_grant' }); return g.exchange ? json(400, { error: g.exchange }) : json(200, { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, scope: g.scope }); }
        if (req.url === '/revoke') { if (g.revokeFails) { resp.destroy(); return; } g.revoked.push(new URLSearchParams(body).get('token')); return json(200, {}); }
        if (req.url === '/gmail/v1/users/me/profile') return g.profile === 200 ? json(200, { emailAddress: 'me@gmail.example' }) : json(g.profile, { error: { errors: [{ reason: 'accessNotConfigured' }], message: 'Gmail API has not been used in project 1 before or it is disabled.' } });
        const list = /^\/gmail\/v1\/users\/me\/messages\?(.*)$/.exec(req.url);
        if (list) return g.listStatus === 200 ? json(200, { messages: msgs.slice(0, +(new URLSearchParams(list[1]).get('maxResults') || 100)).map(m => ({ id: m.id, threadId: m.threadId })) }) : json(g.listStatus, g.apiOff ? { error: { errors: [{ reason: 'accessNotConfigured' }], message: 'Gmail API has not been used in project 1 before or it is disabled.' } } : { error: { message: 'x' } });
        const one = /^\/gmail\/v1\/users\/me\/messages\/([^?]+)\?/.exec(req.url);
        if (one) return json(200, msgs.find(m => m.id === one[1]));
        json(404, {});
      });
    });
    srv.listen(0, '127.0.0.1', () => res(Object.assign(g, { url: 'http://127.0.0.1:' + srv.address().port, close: () => new Promise(r => { srv.closeAllConnections(); srv.close(r); }) })));
  });
}
async function world(over) {
  const g = await google(); stand.push(g);
  const env = Object.assign({ BASE_URL: '', GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: CSECRET, NOVA_SECRET_KEY: SECRET, GOOGLE_TOKEN_URL: g.url + '/token', GOOGLE_REVOKE_URL: g.url + '/revoke', NOVA_GMAIL_API_URL: g.url }, over || {});
  const s = await boot(env), c = s.client(); await c.login('roshan@example.com'); return { g, s, c };
}
const start = async c => new URL((await c.post('/api/gmail/connect')).json.url).searchParams.get('state');
const cb = async (c, qs) => (await c.raw('GET', '/auth/gmail/callback?' + qs)).headers.get('location');
const reasonOf = loc => /gmail=([a-z_]+)#email/.exec(loc)[1];
const setupOf = async c => (await c.get('/api/gmail/setup')).json;

test('setup: the exact addresses for this server, and a live checklist with only "set / not set"', async () => {
  const { c, s } = await world();
  const r = await c.get('/api/gmail/setup'); assert.equal(r.status, 200); const j = r.json;
  assert.equal(j.redirectUris.gmail, s.base + '/auth/gmail/callback'); assert.equal(j.redirectUris.signIn, s.base + '/auth/google/callback'); assert.equal(j.scope, SCOPE);
  assert.deepEqual(j.checks.map(x => x.id + ':' + x.state), ['client_id:ok', 'client_secret:ok', 'secret_key:ok', 'address:ok', 'redirect:manual']); assert.equal(j.ready, true);
  assert.match(j.keyCommand, /randomBytes\(32\)/);
  const text = JSON.stringify(j); assert.ok(!text.includes(CSECRET) && !text.includes(SECRET) && !text.includes('cid.apps'), 'no secret or id value, not even a part');
  assert.equal((await s.client().get('/api/gmail/setup')).status, 401);
});

test('setup: each missing setting turns its own line to "To do" with a one-line fix; a too-short key counts as missing; plain http away from localhost is flagged', async () => {
  const none = await boot({ BASE_URL: '' }), c1 = none.client(); await c1.login('roshan@example.com');
  assert.deepEqual((await setupOf(c1)).checks.map(x => x.state), ['todo', 'todo', 'todo', 'ok', 'manual']);
  const short = await boot({ BASE_URL: '', GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', NOVA_SECRET_KEY: 'short' }), c2 = short.client(); await c2.login('roshan@example.com');
  const j = await setupOf(c2); assert.equal(j.checks[2].state, 'todo'); assert.match(j.checks[2].fix, /NOVA_SECRET_KEY/); assert.equal(j.ready, false);
  const lan = await boot({ BASE_URL: 'http://nova.example.com' }), c3 = lan.client(); await c3.login('roshan@example.com');
  const l = await setupOf(c3); assert.equal(l.checks[3].state, 'todo'); assert.equal(l.redirectUris.gmail, 'http://nova.example.com/auth/gmail/callback');
  const https = await boot({ BASE_URL: 'https://nova.example.com' }), c4 = https.client(); await c4.login('roshan@example.com');
  assert.equal((await setupOf(c4)).checks[3].state, 'ok');
});

test('every failure has one plain cause-and-fix message, in the single catalogue the page uses', async () => {
  const { c } = await world(); const j = await setupOf(c);
  const want = ['denied', 'redirect_mismatch', 'api_disabled', 'bad_client', 'scope', 'reconnect', 'no_secret_key', 'not_configured', 'expired', 'network', 'exchange', 'invalid', 'signed_out', 'google_error'];
  assert.deepEqual(j.problems.map(p => p.id).sort(), want.slice().sort());
  for (const id of want) { const m = j.messages[id]; assert.match(m, /^[A-Z]/, id); assert.ok(m.length > 40 && m.length < 500, id); assert.equal(j.problems.find(p => p.id === id).cause + ' ' + j.problems.find(p => p.id === id).fix, m); }
  assert.match(j.messages.denied, /Test users/); assert.match(j.messages.denied, /Advanced.*Continue/); assert.match(j.messages.redirect_mismatch, /exactly as written/);
  assert.match(j.messages.api_disabled, /Library.*Gmail API.*Enable/); assert.match(j.messages.bad_client, /GOOGLE_CLIENT_ID/); assert.match(j.messages.no_secret_key, /NOVA_SECRET_KEY/);
});

test('coming back from Google: each failure lands on its own reason, and nothing is stored', async () => {
  const { g, s, c } = await world(); const stored = () => s.app.db.prepare("SELECT COUNT(*) n FROM connections WHERE provider = 'gmail'").get().n;
  assert.equal(reasonOf(await cb(c, 'error=access_denied&state=' + await start(c))), 'denied');
  assert.equal(reasonOf(await cb(c, 'error=server_error&state=' + await start(c))), 'google_error');
  assert.equal(reasonOf(await cb(c, 'state=nope&code=good')), 'expired');
  g.exchange = 'redirect_uri_mismatch'; assert.equal(reasonOf(await cb(c, 'state=' + await start(c) + '&code=good')), 'redirect_mismatch');
  g.exchange = 'invalid_client'; assert.equal(reasonOf(await cb(c, 'state=' + await start(c) + '&code=good')), 'bad_client');
  g.exchange = 'something_else'; assert.equal(reasonOf(await cb(c, 'state=' + await start(c) + '&code=good')), 'exchange');
  g.exchange = null; g.scope = 'openid email'; assert.equal(reasonOf(await cb(c, 'state=' + await start(c) + '&code=good')), 'scope');
  g.scope = SCOPE; g.profile = 403; assert.equal(reasonOf(await cb(c, 'state=' + await start(c) + '&code=good')), 'api_disabled');
  assert.equal(stored(), 0, 'a failed connect leaves nothing half-connected');
  g.profile = 200; assert.equal(reasonOf(await cb(c, 'state=' + await start(c) + '&code=good')), 'connected'); assert.equal(stored(), 1);
});

test('network failure and missing settings at the callback are plain reasons too', async () => {
  const { g, s, c } = await world(); const st = await start(c); await g.close();
  assert.equal(reasonOf(await cb(c, 'state=' + st + '&code=good')), 'network');
  const nokey = await boot({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' }), n = nokey.client(); await n.login('roshan@example.com');
  assert.equal(reasonOf(await cb(n, 'state=x&code=y')), 'no_secret_key');
  const r = await n.post('/api/gmail/connect'); assert.equal(r.status, 503); assert.equal(r.json.error.message, (await setupOf(n)).messages.no_secret_key);
  const nog = await boot({ BASE_URL: '' }), o = nog.client(); await o.login('roshan@example.com'); assert.equal((await o.post('/api/gmail/connect')).json.error.message, (await setupOf(o)).messages.not_configured);
});

test('Test connection: reads at most 5 headers, stores nothing, and says plainly why when it cannot', async () => {
  const { g, s, c } = await world();
  assert.equal((await c.post('/api/gmail/test')).status, 409, 'not connected yet');
  await cb(c, 'state=' + await start(c) + '&code=good');
  const emails = () => s.app.db.prepare('SELECT COUNT(*) n FROM emails').get().n, before = emails(), calls0 = g.calls.length;
  const r = (await c.post('/api/gmail/test')).json; assert.equal(r.ok, true); assert.equal(r.checked, 5); assert.match(r.message, /read the headers of 5 recent messages and kept nothing/); assert.ok(r.newestAt > 0);
  assert.equal(emails(), before, 'nothing stored');
  const mine = g.calls.slice(calls0); assert.ok(mine.some(x => /maxResults=5/.test(x.url))); assert.equal(mine.filter(x => /messages\/m/.test(x.url)).length, 5); assert.ok(mine.every(x => x.method === 'GET'));
  assert.ok(mine.filter(x => /messages\/m/.test(x.url)).every(x => /format=metadata/.test(x.url)), 'headers only, never the body');
  g.listStatus = 403; const bad = (await c.post('/api/gmail/test')).json; assert.equal(bad.ok, false); assert.match(bad.message, /Reconnect Gmail/);
  g.listStatus = 401; const exp = (await c.post('/api/gmail/test')).json; assert.equal(exp.ok, false); assert.equal(exp.code, 'reconnect'); assert.equal(exp.message, (await setupOf(c)).messages.reconnect);
  assert.equal((await s.client().post('/api/gmail/test')).status, 401);
  assert.equal((await c.raw('POST', '/api/gmail/test', {}, { 'x-nova-csrf': 'wrong' })).status, 403, 'needs the CSRF header');
});

test('read-only: the permission asked for is exactly gmail.readonly, and every request NOVA makes to Gmail is a GET', async () => {
  const { g, c } = await world();
  const u = new URL((await c.post('/api/gmail/connect')).json.url); assert.equal(u.searchParams.get('scope'), SCOPE);
  await cb(c, 'state=' + u.searchParams.get('state') + '&code=good'); await c.post('/api/email/sync'); await c.post('/api/gmail/test');
  const gmail = g.calls.filter(x => x.url.startsWith('/gmail/')); assert.ok(gmail.length > 5); assert.ok(gmail.every(x => x.method === 'GET'), 'no POST, PUT, PATCH or DELETE to Gmail');
  assert.ok(gmail.every(x => !/\/(send|modify|trash|delete|drafts|labels)/i.test(x.url)));
});

test('expired or revoked access is a plain "reconnect" message', async () => {
  const { g, s, c } = await world(); await cb(c, 'state=' + await start(c) + '&code=good');
  g.listStatus = 401; const r = await c.post('/api/email/sync'); assert.equal(r.status, 502); assert.equal(r.json.error.code, 'reconnect');
  assert.equal(s.app.db.prepare("SELECT status FROM connections").get().status, 'needs_reconnect');
});

test('Gmail API switched off during a check gives the plain "switch it on" message', async () => {
  const { g, c } = await world(); await cb(c, 'state=' + await start(c) + '&code=good');
  g.listStatus = 403; g.apiOff = true;
  const t = (await c.post('/api/gmail/test')).json; assert.equal(t.ok, false); assert.equal(t.code, 'api_disabled'); assert.equal(t.message, (await setupOf(c)).messages.api_disabled);
  const sy = await c.post('/api/email/sync'); assert.equal(sy.status, 502); assert.equal(sy.json.error.code, 'api_disabled'); assert.match(sy.json.error.message, /Enable/);
});

test('Disconnect deletes the stored access and revokes it at Google; if Google cannot be reached it says so', async () => {
  const { g, s, c } = await world(); await cb(c, 'state=' + await start(c) + '&code=good');
  const r = (await c.post('/api/gmail/disconnect', {})).json; assert.equal(r.ok, true); assert.equal(r.revokedAtGoogle, true); assert.deepEqual(g.revoked, ['RT1']);
  assert.equal(s.app.db.prepare("SELECT COUNT(*) n FROM connections").get().n, 0);
  await cb(c, 'state=' + await start(c) + '&code=good'); g.revokeFails = true;
  const r2 = (await c.post('/api/gmail/disconnect', {})).json; assert.equal(r2.revokedAtGoogle, false); assert.equal(r2.hadAccess, true); assert.equal(s.app.db.prepare("SELECT COUNT(*) n FROM connections").get().n, 0, 'removed here either way');
});

test("another person's connection is never used, and no secret appears in any response", async () => {
  const { g, s, c } = await world(); await cb(c, 'state=' + await start(c) + '&code=good');
  const m = s.client(); await m.login('mallory@example.com');
  assert.equal((await m.post('/api/gmail/test')).status, 409); assert.equal((await m.post('/api/email/sync')).status, 409);
  const all = JSON.stringify([(await c.get('/api/email')).json, (await c.post('/api/gmail/test')).json, await setupOf(c), (await c.get('/api/check')).json]);
  for (const secret of [CSECRET, SECRET, 'AT1', 'RT1']) assert.ok(!all.includes(secret), 'leaked ' + secret.slice(0, 4));
  const row = s.app.db.prepare("SELECT token_enc FROM connections").get().token_enc; assert.ok(!String(row).includes('AT1') && !String(row).includes('RT1'), 'tokens are stored encrypted');
});

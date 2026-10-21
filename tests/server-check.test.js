// "Check my setup" (server): plain, read-only checks. Each is OK, needs attention (with the next step) or not set up (with why that is fine).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);
const by = r => Object.fromEntries(r.json.checks.map(c => [c.id, c]));
async function setup(env, deps) { const s = await boot(env, deps); const c = s.client(); await c.login('roshan@example.com'); return { s, c }; }

test('needs a signed-in person', async () => {
  const s = await boot(); const r = await s.client().get('/api/check');
  assert.equal(r.status, 401);
});

test('a fresh setup: Node.js and data are OK, optional things say "not set up" and why that is fine', async () => {
  const { s, c } = await setup(); s.app.scheduler.start();
  const r = await c.get('/api/check'), k = by(r);
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(k), ['node', 'database', 'scheduler', 'notifications', 'gmail', 'ai']);
  assert.equal(k.node.status, 'ok'); assert.equal(k.database.status, 'ok'); assert.equal(k.scheduler.status, 'ok'); assert.equal(k.notifications.status, 'ok');
  assert.equal(k.gmail.status, 'not_set_up'); assert.match(k.gmail.why, /fine/); assert.equal(k.ai.status, 'not_set_up'); assert.match(k.ai.why, /fine/);
  assert.equal(r.json.attention, 0); assert.match(r.json.summary, /working/);
});

test('daily jobs: not running needs attention with the exact next step; switched off is "not set up"', async () => {
  const a = await setup(); const k1 = by(await a.c.get('/api/check'));       // never started in this test
  assert.equal(k1.scheduler.status, 'attention'); assert.match(k1.scheduler.next, /start it again/);
  const b = await setup({ NOVA_SCHEDULER: 'off' }); const k2 = by(await b.c.get('/api/check'));
  assert.equal(k2.scheduler.status, 'not_set_up'); assert.match(k2.scheduler.why, /by hand/);
});

test('Gmail: connected is OK, a broken connection needs attention, none is "not set up"', async () => {
  const { s, c } = await setup(); const db = s.app.db;
  db.prepare("INSERT INTO connections (user_id, provider, account, scope, token_enc, status, created_at, updated_at) VALUES (1, 'gmail', 'a@b.c', 'read', 'x', 'connected', 1, 1)").run();
  assert.equal(by(await c.get('/api/check')).gmail.status, 'ok');
  db.prepare("UPDATE connections SET status = 'needs_reconnect'").run();
  const g = by(await c.get('/api/check')).gmail; assert.equal(g.status, 'attention'); assert.match(g.next, /Connect Gmail/);
});

test('AI model: Ollama unreachable and Ollama without the model both need attention; ready is OK', async () => {
  const mk = fetchImpl => setup({ NOVA_AI_PROVIDER: 'ollama' }, { fetch: fetchImpl });
  const down = await mk(async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:11434'); });
  const a = by(await down.c.get('/api/check')).ai; assert.equal(a.status, 'attention'); assert.match(a.next, /ollama serve/);
  const noModel = await mk(async () => new Response(JSON.stringify({ models: [{ name: 'other:1b' }] }), { status: 200 }));
  const b = by(await noModel.c.get('/api/check')).ai; assert.equal(b.status, 'attention'); assert.match(b.next, /ollama pull/);
  const ready = await mk(async () => new Response(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }] }), { status: 200 }));
  assert.equal(by(await ready.c.get('/api/check')).ai.status, 'ok');
  for (const x of [a, b]) assert.doesNotMatch(JSON.stringify(x), /ECONNREFUSED|127\.0\.0\.1/);
});

test('read-only and private: it changes no rows and returns no secrets, paths or addresses', async () => {
  const { s, c } = await setup({ NOVA_NTFY_TOPIC: 'super-secret-topic-name', NOVA_SECRET_KEY: 'k'.repeat(40) });
  const count = () => ['users', 'sessions', 'audit_log', 'notifications', 'connections'].map(t => s.app.db.prepare('SELECT COUNT(*) n FROM ' + t).get().n).join(',');
  const before = count(); const r = await c.get('/api/check'); const text = JSON.stringify(r.json);
  assert.equal(count(), before);
  assert.doesNotMatch(text, /super-secret-topic-name|kkkkkkkk|\.nova|\.db|\/home|\/tmp|node_modules|ntfy\.sh|roshan@/);
  assert.equal(by(r).notifications.status, 'ok'); assert.match(by(r).notifications.message, /phone/);
});

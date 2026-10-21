// Every message a person can see when something goes wrong must be plain words: no code names, stack traces, file paths,
// "undefined", "[object ...]" or "Error:". Three checks: the server's own wording (source), what the server really answers
// to wrong requests on every route (runtime), and the front end's toast and error wording (source).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);

const ROOT = path.join(__dirname, '..');
const BAD = /undefined|\[object|\bError:|\bTypeError|\bRangeError|SyntaxError|Exception|\bat \S+ \(|\.js:\d+|node_modules|SQLITE|ENOENT|ECONN|EACCES|[A-Za-z]:\\|\/(home|tmp|usr|var|root|etc)\//;
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

test('the pattern itself catches what it should (so the checks below mean something)', () => {
  for (const t of ['Cannot read properties of undefined', 'got [object Object]', 'Error: boom', 'at foo (/home/x/a.js:3:4)', 'ENOENT: no such file', 'C:\\Users\\a', 'see /tmp/x.db', 'SQLITE_BUSY']) assert.match(t, BAD, t);
  for (const t of ['Memory not found.', 'Pick a day from 2020 up to today.', 'Type DELETE MY DATA to confirm.']) assert.doesNotMatch(t, BAD, t);
});

test('server wording: no message written in server/ is unfriendly', () => {
  const found = [];
  for (const f of walk(path.join(ROOT, 'server')).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/HttpError\(\s*\d+\s*,\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) found.push([path.relative(ROOT, f), m[2]]);
  }
  assert.ok(found.length > 60, 'found ' + found.length + ' messages');
  for (const [f, msg] of found) { assert.doesNotMatch(msg, BAD, f + ': ' + msg); assert.ok(/^[A-Z“"(\d]/.test(msg), f + ': starts with a capital letter: ' + msg); }
});

test('front end wording: toasts and fallback error text are plain', () => {
  const found = [];
  for (const f of fs.readdirSync(ROOT).filter(f => /^(nova|app|core|boot|verify-page|setup-page)[a-z-]*\.js$/.test(f))) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/(?:J\.toast|toast|new Error)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g)) found.push([f, m[2]]);
  }
  assert.ok(found.length > 15, 'found ' + found.length);
  for (const [f, msg] of found) assert.doesNotMatch(msg, BAD, f + ': ' + msg);
});

function routes() {
  const out = new Set();
  for (const f of walk(path.join(ROOT, 'server')).filter(f => f.endsWith('.js')))
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/router\.(get|post|patch|put|delete)\(\s*'((?:\/api|\/auth)[^']*)'/g)) out.add(m[1].toUpperCase() + ' ' + m[2]);
  return [...out];
}

test('what the server answers to wrong requests on every route is plain words', async () => {
  const s = await boot({ NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000', NOVA_RATE_VERIFY_MAX: '100000' });
  const anon = s.client(); let c = s.client(); await c.login('roshan@example.com');
  const list = routes(); assert.ok(list.length > 80, 'routes: ' + list.length);
  const seen = []; const note = (label, r) => { if (r.status >= 400) { seen.push([label, r]); } };
  const garbage = [{}, { title: 12, id: 'x', text: null }, { text: 'x'.repeat(300000) }, { day: '2026-99-99', q: '☃', scope: 'zzz', fils: -5, dueAt: 'soon', via: 7 }, [], 'not json {'];
  let n = 0;
  for (const spec of list) {
    const [method, p0] = spec.split(' '); if (p0 === '/auth/logout' || p0 === '/api/sessions/revoke-others') continue;
    for (const id of ['999999', 'abc', '%00']) {
      const p = p0.replace(/:[a-zA-Z]+/g, id);
      note('anon ' + spec, await anon.req(method, p, method === 'GET' ? undefined : {}));
      if (++n % 25 === 0) { c = s.client(); await c.login('roshan@example.com'); }
      if (method === 'GET') { note(spec + ' ' + id, await c.get(p + (p.includes('?') ? '&' : '?') + 'day=zzz&q=%00&limit=-1&format=zzz')); continue; }
      for (const body of garbage) note(spec + ' ' + id + ' ' + JSON.stringify(body).slice(0, 40), await c.req(method, p, body));
      note(spec + ' no-csrf', await (async () => { const d = s.client(); await d.login('mallory@example.com'); d.setCsrf('wrong'); return d.req(method, p, {}); })());
    }
  }
  assert.ok(seen.length > 300, 'error responses seen: ' + seen.length);
  for (const [label, r] of seen) {
    if (r.status === 404 && !r.json) continue;
    assert.ok(r.json && r.json.error && typeof r.json.error.message === 'string', label + ' answers with a message: ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 100));
    const m = r.json.error.message;
    assert.doesNotMatch(m, BAD, label + ': ' + m); assert.ok(m.length > 8, label + ': too short: ' + m); assert.notEqual(m, r.json.error.code, label);
  }
  for (const [method, p, body] of [['POST', '/api/tasks', '{bad json'], ['POST', '/api/chat', '{"message": '], ['GET', '/api/no-such-page', undefined], ['PUT', '/api/health', {}]]) {
    const r = await c.req(method, p, body); assert.ok(r.status >= 400 && r.json && r.json.error, method + ' ' + p); assert.doesNotMatch(r.json.error.message, BAD, r.json.error.message);
  }
});

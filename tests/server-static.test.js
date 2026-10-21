// Serving files (server): gzip with the right Vary header, ETag and "304 Not Modified", files that are already compressed are left alone,
// nothing under /api/ or /auth/ is ever compressed or cached, and the decoded bytes are exactly the file.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { boot, closeAll } = require('./server-helpers');
const { createStatic, wantsGzip, matches } = require('../server/static');
test.after(closeAll);

const ROOT = path.join(__dirname, '..');
// A raw request: no automatic decoding, so what the server really sends is what we see.
function raw(base, method, p, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, base), r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: Object.assign({ 'accept-encoding': 'identity' }, headers || {}) }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }); r.on('error', reject); r.end();
  });
}

test('who wants gzip: yes, no, "*", and quality zero', () => {
  for (const [h, want] of [['gzip', true], ['gzip, deflate, br', true], ['br, gzip;q=0.5', true], ['gzip;q=0', false], ['identity', false], ['', false], [undefined, false], ['*', true], ['*;q=0', false], ['gzip;q=0, *', false], ['deflate', false]]) assert.equal(wantsGzip(h), want, String(h));
  assert.equal(matches('"a", "b"', '"b"'), true); assert.equal(matches('W/"a"', '"a"'), true); assert.equal(matches('*', '"x"'), true); assert.equal(matches('"a"', '"b"'), false); assert.equal(matches(undefined, '"a"'), false);
});

test('text files: gzip when asked (and only then), identical after decoding, Vary on every copy, smaller on the wire', async () => {
  const s = await boot(); const file = fs.readFileSync(path.join(ROOT, 'nova.js'));
  const plain = await raw(s.base, 'GET', '/nova.js'), gz = await raw(s.base, 'GET', '/nova.js', { 'accept-encoding': 'gzip, deflate, br' });
  assert.equal(plain.status, 200); assert.equal(plain.headers['content-encoding'], undefined); assert.deepEqual(plain.body, file); assert.equal(plain.headers.vary, 'Accept-Encoding');
  assert.equal(gz.status, 200); assert.equal(gz.headers['content-encoding'], 'gzip'); assert.equal(gz.headers.vary, 'Accept-Encoding'); assert.deepEqual(zlib.gunzipSync(gz.body), file, 'the decoded bytes are the file');
  assert.ok(gz.body.length < file.length * 0.5, 'compressed ' + gz.body.length + ' of ' + file.length); assert.equal(Number(gz.headers['content-length']), gz.body.length); assert.equal(Number(plain.headers['content-length']), file.length);
  assert.match(gz.headers['content-type'], /javascript/); assert.equal(gz.headers['cache-control'], 'no-cache'); assert.ok(gz.headers['content-security-policy'], 'the security headers are still sent');
  const q0 = await raw(s.base, 'GET', '/nova.js', { 'accept-encoding': 'gzip;q=0' }); assert.equal(q0.headers['content-encoding'], undefined);
  for (const p of ['/index.html', '/', '/design.css', '/manifest.webmanifest', '/verify', '/data/jobs.json']) { const a = await raw(s.base, 'GET', p), b = await raw(s.base, 'GET', p, { 'accept-encoding': 'gzip' });
    assert.equal(a.status, 200, p); assert.deepEqual(b.headers['content-encoding'] ? zlib.gunzipSync(b.body) : b.body, a.body, p + ' decodes to the same bytes'); }
});

test('ETag and 304: an unchanged file answers with no body; each copy has its own tag; a wrong tag gets the file', async () => {
  const s = await boot(); const plain = await raw(s.base, 'GET', '/app.css'), gz = await raw(s.base, 'GET', '/app.css', { 'accept-encoding': 'gzip' });
  assert.match(plain.headers.etag, /^"[0-9a-f]{27}"$/); assert.match(gz.headers.etag, /^"[0-9a-f]{27}-gzip"$/); assert.notEqual(plain.headers.etag, gz.headers.etag);
  assert.equal((await raw(s.base, 'GET', '/app.css')).headers.etag, plain.headers.etag, 'the tag is stable');
  const n1 = await raw(s.base, 'GET', '/app.css', { 'if-none-match': plain.headers.etag }); assert.equal(n1.status, 304); assert.equal(n1.body.length, 0); assert.equal(n1.headers.etag, plain.headers.etag); assert.equal(n1.headers.vary, 'Accept-Encoding'); assert.equal(n1.headers['cache-control'], 'no-cache'); assert.ok(n1.headers['content-security-policy']);
  const n2 = await raw(s.base, 'GET', '/app.css', { 'accept-encoding': 'gzip', 'if-none-match': gz.headers.etag }); assert.equal(n2.status, 304); assert.equal(n2.body.length, 0);
  const n3 = await raw(s.base, 'GET', '/app.css', { 'accept-encoding': 'gzip', 'if-none-match': plain.headers.etag }); assert.equal(n3.status, 200, 'the plain tag does not stand for the compressed copy');
  assert.equal((await raw(s.base, 'GET', '/app.css', { 'if-none-match': '"nope"' })).status, 200); assert.equal((await raw(s.base, 'GET', '/app.css', { 'if-none-match': 'W/' + plain.headers.etag + ', "x"' })).status, 304);
  const head = await raw(s.base, 'HEAD', '/app.css', { 'accept-encoding': 'gzip' }); assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.equal(head.headers['content-encoding'], 'gzip'); assert.equal(Number(head.headers['content-length']), gz.body.length);
});

test('files that are already compressed (fonts, pictures) are sent as they are, with a tag', async () => {
  const s = await boot(); const font = '/fonts/ibm-plex-sans-latin-400-normal.woff2', icon = '/icons/icon-192.png';
  for (const p of [font, icon]) { const r = await raw(s.base, 'GET', p, { 'accept-encoding': 'gzip' }); assert.equal(r.status, 200, p); assert.equal(r.headers['content-encoding'], undefined, p); assert.equal(r.headers.vary, undefined, p); assert.ok(r.headers.etag, p);
    assert.deepEqual(r.body, fs.readFileSync(path.join(ROOT, p))); assert.equal((await raw(s.base, 'GET', p, { 'if-none-match': r.headers.etag })).status, 304, p); }
});

test('the API is never compressed, tagged or cached; neither are sign-in answers or errors', async () => {
  const s = await boot(); const c = s.client();
  for (const [m, p] of [['GET', '/api/health'], ['GET', '/api/session'], ['GET', '/api/nope'], ['POST', '/auth/dev-login'], ['GET', '/api/profile']]) {
    const r = await raw(s.base, m, p, { 'accept-encoding': 'gzip', 'if-none-match': '*', 'content-type': 'application/json' });
    assert.equal(r.headers['cache-control'], 'no-store', m + ' ' + p); assert.equal(r.headers.etag, undefined, p); assert.equal(r.headers['content-encoding'], undefined, p); assert.notEqual(r.status, 304, p);
  }
  await c.login('roshan@example.com'); for (const p of ['/api/tasks', '/api/export', '/api/profile', '/api/orbit']) { const r = await c.raw('GET', p); assert.equal(r.headers.get('cache-control'), 'no-store', p); assert.equal(r.headers.get('etag'), null, p); }
  const missing = await raw(s.base, 'GET', '/not-a-file.js', { 'accept-encoding': 'gzip' }); assert.equal(missing.status, 404); assert.equal(missing.headers['cache-control'], 'no-store');
  const server = await raw(s.base, 'GET', '/server/index.js'); assert.equal(server.status, 404, 'server files are still not served'); assert.equal((await raw(s.base, 'GET', '/.env')).status, 404);
});

test('a changed file gets a new tag and new bytes; an unchanged one keeps its tag; a missing one is a 404 (unit test with a temporary folder)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-static-')), f = path.join(dir, 'a.js'); fs.writeFileSync(f, 'console.log(1);\n'.repeat(200));
  const st = createStatic({ root: dir, types: { '.js': 'text/javascript; charset=utf-8' }, headers: { 'X-Test': '1' } });
  const call = (p, h, m) => { const out = { status: 0, headers: {}, body: Buffer.alloc(0) }; const res = { writeHead: (s, hh) => { out.status = s; out.headers = hh; }, end: b => { if (b) out.body = b; } }; const ok = st.serve({ method: m || 'GET', headers: h || {} }, res, p); return Object.assign(out, { ok }); };
  const a = call('/a.js', { 'accept-encoding': 'gzip' }); assert.equal(a.status, 200); assert.equal(a.headers['X-Test'], '1'); assert.equal(zlib.gunzipSync(a.body).toString(), 'console.log(1);\n'.repeat(200));
  const again = call('/a.js', { 'accept-encoding': 'gzip' }); assert.equal(again.headers.ETag, a.headers.ETag);
  fs.writeFileSync(f, 'console.log(2);\n'.repeat(300), 'utf8'); const t = Date.now() / 1000 + 5; fs.utimesSync(f, t, t);
  const b = call('/a.js', { 'accept-encoding': 'gzip' }); assert.notEqual(b.headers.ETag, a.headers.ETag); assert.equal(zlib.gunzipSync(b.body).toString(), 'console.log(2);\n'.repeat(300));
  assert.equal(call('/a.js', { 'accept-encoding': 'gzip', 'if-none-match': a.headers.ETag }).status, 200, 'the old tag no longer matches');
  assert.equal(call('/nope.js').ok, false); assert.equal(call('/../etc/passwd').ok, false); fs.mkdirSync(path.join(dir, 'd')); assert.equal(call('/d').ok, false);
  fs.writeFileSync(path.join(dir, 'tiny.js'), 'x'); const tiny = call('/tiny.js', { 'accept-encoding': 'gzip' }); assert.equal(tiny.headers['Content-Encoding'], undefined, 'tiny files are not compressed'); assert.equal(tiny.body.toString(), 'x');
  fs.rmSync(dir, { recursive: true });
});

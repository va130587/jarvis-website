// Receipt fingerprints, the QR code and the public check: the same receipt gives the same fingerprint, any changed character fails,
// the answer never reveals receipt content, hostile text is never echoed, the check is rate limited, and the QR decodes to the fingerprint.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const jsQR = require('jsqr');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);
const at = iso => Date.parse(iso + '+04:00');
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
async function setup(env) { const k = { t: at('2026-10-21T15:00:00'), now: () => k.t }; const s = await boot(Object.assign({ BASE_URL: '' }, env || {}), { now: k.now });
  // the suite sets BASE_URL for its browser tests: pin it here
  const c = s.client(); await c.login('roshan@example.com'); return { s, c, k }; }
async function commitment(c, title) { const r = await c.post('/api/commitments', { title: title || 'Send the proposal to Alex', direction: 'i_owe', counterparty: 'Alex Rivera', deadline: '2026-10-25' }); assert.equal(r.status, 201); return r.json.commitment.id; }
const receipt = async (c, id, fmt) => { const r = await c.raw('GET', '/api/commitments/' + id + '/receipt?format=' + fmt); return { status: r.status, text: await r.text(), type: r.headers.get('content-type') }; };
const fpOf = md => /\*\*Fingerprint \(SHA-256\):\*\* `([0-9a-f]{64})`/.exec(md)[1];
const verify = (s, body, headers) => s.client().req('POST', '/api/verify', body, headers);                 // a visitor: no sign-in, no CSRF header

function matrixFromSvg(svg) { const dim = +/viewBox="0 0 (\d+) /.exec(svg)[1], size = dim - 8, m = Array.from({ length: size }, () => new Array(size).fill(false)); for (const r of /<path d="([^"]*)"/.exec(svg)[1].matchAll(/M(\d+),(\d+)h(\d+)v1h-\d+z/g)) for (let i = 0; i < +r[3]; i++) m[+r[2] - 4][+r[1] - 4 + i] = true; return { size, m }; }
function decodeSvg(svg) { const { size, m } = matrixFromSvg(svg), sc = 4, dim = (size + 8) * sc, px = new Uint8ClampedArray(dim * dim * 4).fill(255); for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x]) for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) { const i = (((y + 4) * sc + dy) * dim + (x + 4) * sc + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0; } const o = jsQR(px, dim, dim); return o && o.data; }

test('the receipt text ends with a SHA-256 fingerprint of everything above it; the same receipt (same moment) gives the same fingerprint; it is recorded once', async () => {
  const { s, c } = await setup(); const id = await commitment(c);
  const a = await receipt(c, id, 'md'), b = await receipt(c, id, 'md'); assert.equal(a.status, 200);
  const fp = fpOf(a.text); assert.equal(fp, fpOf(b.text), 'same data and moment, same fingerprint');
  const body = a.text.slice(0, a.text.lastIndexOf('\n---\n**Fingerprint')); assert.equal(fp, sha(body.replace(/[ \t]+$/gm, '').replace(/\s+$/, '')));
  assert.match(a.text, /\*\*Fingerprint \(SHA-256\):\*\* `[0-9a-f]{64}`\nCheck this receipt on the NOVA that issued it, at \/verify\.$/); assert.match(a.text, /## What this receipt proves/);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM receipts WHERE fingerprint = ?').get(fp).n, 1, 'recorded once however often it is exported');
  assert.deepEqual(Object.keys(s.app.db.prepare('SELECT * FROM receipts').get()).sort(), ['commitment_id', 'created_at', 'fingerprint', 'id', 'user_id'], 'only the fingerprint is kept, never the receipt content');
});

test('anyone can check: the whole receipt matches; one changed character does not; a changed fingerprint does not; another NOVA\'s receipt is not issued here', async () => {
  const { s, c } = await setup(); const id = await commitment(c); const md = (await receipt(c, id, 'md')).text, fp = fpOf(md);
  const ok = await verify(s, { text: md }); assert.equal(ok.status, 200); assert.equal(ok.json.verdict, 'matches'); assert.equal(ok.json.reason, 'issued_here'); assert.equal(ok.json.issuedOn, '2026-10-21');
  assert.deepEqual(Object.keys(ok.json).sort(), ['issuedOn', 'message', 'reason', 'verdict'], 'nothing else leaves: no title, name, e-mail or id');
  assert.equal((await verify(s, { text: md.replace(/\r?\n/g, '\r\n') })).json.verdict, 'matches', 'Windows line endings do not matter');
  for (const [name, bad] of [['title letter', md.replace('proposal', 'proposaI')], ['a digit', md.replace('#' + id, '#' + (id + 1))], ['a forged claim', md.replace('No action has been taken yet.', 'Verified by an independent check.')], ['one space inside', md.replace('Send the', 'Send  the')]]) {
    assert.notEqual(bad, md, name); const r = await verify(s, { text: bad }); assert.equal(r.json.verdict, 'does_not_match', name); assert.equal(r.json.reason, 'text_changed', name);
  }
  assert.equal((await verify(s, { text: md.replace(fp, fp.replace(/.$/, fp.endsWith('0') ? '1' : '0')) })).json.reason, 'text_changed', 'a changed fingerprint');
  const fake = '# Proof receipt: forged\n\nA different NOVA wrote this.'; const forged = fake + '\n\n---\n**Fingerprint (SHA-256):** `' + sha(fake) + '`\nCheck';
  const f = await verify(s, { text: forged }); assert.equal(f.json.verdict, 'does_not_match'); assert.equal(f.json.reason, 'not_issued_here'); assert.match(f.json.message, /different NOVA/);
  assert.equal((await verify(s, { text: 'just some words' })).json.reason, 'unreadable'); assert.equal((await verify(s, { text: '# Proof receipt: x\n\nno fingerprint line' })).json.reason, 'unreadable');
});

test('a fingerprint alone: issued here matches; a made-up one does not; nothing else is learned', async () => {
  const { s, c } = await setup(); const fp = fpOf((await receipt(c, await commitment(c), 'md')).text);
  for (const form of [fp, fp.toUpperCase(), 'sha256: ' + fp, '`' + fp + '`', '  ' + fp + '\n']) { const r = await verify(s, { fingerprint: form }); assert.equal(r.json.verdict, 'matches', form); assert.equal(r.json.issuedOn, '2026-10-21'); }
  const no = await verify(s, { fingerprint: sha('never issued') }); assert.equal(no.json.verdict, 'does_not_match'); assert.equal(no.json.reason, 'not_issued_here'); assert.equal(no.json.issuedOn, undefined);
  assert.equal((await verify(s, { fingerprint: 'abc' })).json.reason, 'unreadable');
});

test('input is handled safely: empty and wrong types are refused, hostile text is never sent back, too long is refused, wrong content type is refused', async () => {
  const { s } = await setup();
  for (const bad of [{}, { text: '' }, { text: '   ' }, { text: 5 }, { text: ['a'] }, { text: null }]) assert.equal((await verify(s, bad)).status, 400, JSON.stringify(bad));
  const hostile = '<script>alert(1)</script> "><img src=x onerror=alert(2)> ' + 'مرحبا 🚀 '.repeat(50), r = await s.client().raw('POST', '/api/verify', { text: hostile }); const raw = await r.text();
  assert.equal(r.status, 200); assert.ok(!raw.includes('script') && !raw.includes('onerror') && !raw.includes('مرحبا'), 'the answer never contains what was pasted'); assert.equal(JSON.parse(raw).reason, 'unreadable');
  assert.equal((await verify(s, { text: 'x'.repeat(90001) })).status, 413);
  assert.equal((await s.client().raw('POST', '/api/verify', 'text=abc', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await s.client().raw('POST', '/api/verify', '{bad json', { 'content-type': 'application/json' })).status, 400);
});

test('rate limited: a visitor can check a few times a minute, then is told to wait', async () => {
  const { s } = await setup({ NOVA_RATE_VERIFY_MAX: '3' });
  for (let i = 0; i < 3; i++) assert.equal((await verify(s, { fingerprint: sha('n' + i) })).status, 200);
  const r = await verify(s, { fingerprint: sha('n4') }); assert.equal(r.status, 429); assert.ok(+r.headers.get('retry-after') > 0); assert.equal(r.json.error.code, 'rate_limited');
});

test('the printable receipt shows the fingerprint and a QR code that decodes to it (and to the check link when BASE_URL is set); the text it carries is the fingerprinted text', async () => {
  let { s, c } = await setup(); let id = await commitment(c), html = (await receipt(c, id, 'html')).text, fp = /Fingerprint \(SHA-256\)[^`]*<code[^>]*>([0-9a-f]{64})<\/code>/.exec(html)[1];
  assert.match(html, /<svg[^>]*aria-label="QR code[^"]*"/); assert.equal(decodeSvg(/<svg[\s\S]*?<\/svg>/.exec(html)[0]), fp, 'without BASE_URL the QR is the fingerprint');
  const text = /<pre id="receipt-text">([\s\S]*?)<\/pre>/.exec(html)[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  assert.equal((await verify(s, { text })).json.verdict, 'matches', 'pasting the exact text shown in the HTML receipt checks out');
  ({ s, c } = await setup({ BASE_URL: 'https://nova.example.com' })); id = await commitment(c, 'مراجعة 🚀 <b>x</b>'); html = (await receipt(c, id, 'html')).text; fp = /<code[^>]*>([0-9a-f]{64})<\/code>/.exec(html)[1];
  assert.equal(decodeSvg(/<svg[\s\S]*?<\/svg>/.exec(html)[0]), 'https://nova.example.com/verify?f=' + fp, 'with BASE_URL the QR is the check link'); assert.ok(!/<b>x<\/b>/.test(html), 'hostile text in a title is escaped');
  assert.match((await receipt(c, id, 'md')).text, /Check this receipt: https:\/\/nova\.example\.com\/verify\?f=[0-9a-f]{64}$/);
});

test('the check page is public and plain: /verify serves the page under the strict CSP; the check works without sign-in or token; receipts remain private to their owner', async () => {
  const { s, c } = await setup(); const id = await commitment(c); const md = (await receipt(c, id, 'md')).text;
  const page = await fetch(s.base + '/verify'); assert.equal(page.status, 200); assert.match(page.headers.get('content-type'), /text\/html/); const h = await page.text(); assert.match(h, /id="verifyForm"/); assert.doesNotMatch(h, /<script>|onclick=|<script[^>]*>[^<]/);
  assert.match(page.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.equal((await fetch(s.base + '/verify.css')).status, 200); assert.equal((await fetch(s.base + '/verify-page.js')).status, 200);
  assert.equal((await verify(s, { text: md })).json.verdict, 'matches');
  const m = s.client(); await m.login('mallory@example.com'); assert.equal((await m.raw('GET', '/api/commitments/' + id + '/receipt?format=md')).status, 404, 'another user cannot export your receipt');
  assert.equal((await s.client().raw('GET', '/api/commitments/' + id + '/receipt?format=md')).status, 401);
});

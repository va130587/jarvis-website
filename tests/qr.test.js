// The QR encoder (server/qr.js) checked against an independent QR reader (jsQR, test-only): everything it makes must decode back
// to the exact text, for every size from version 1 to 10, with accented and Arabic text, and as the SVG NOVA puts in a receipt.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const jsQR = require('jsqr');
const { encode, toSvg } = require('../server/qr');

function raster(modules, size, scale) {
  scale = scale || 4; const quiet = 4, dim = (size + quiet * 2) * scale, px = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const i = (((y + quiet) * scale + dy) * dim + (x + quiet) * scale + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
  return { px, dim };
}
const decode = qr => { const r = raster(qr.modules, qr.size); const out = jsQR(r.px, r.dim, r.dim); return out && out.data; };
// the matrix back out of the SVG path ("M x,y hW v1 h-W z" per run of dark modules)
function fromSvg(svg) {
  const dim = +/viewBox="0 0 (\d+) /.exec(svg)[1], size = dim - 8, m = Array.from({ length: size }, () => new Array(size).fill(false));
  for (const r of /M(\d+),(\d+)h(\d+)v1h-\d+z/g[Symbol.matchAll](/<path d="([^"]*)"/.exec(svg)[1])) for (let i = 0; i < +r[3]; i++) m[+r[2] - 4][+r[1] - 4 + i] = true;
  return { size, modules: m };
}

test('known sizes: short text is version 1, 14 bytes still fits it, 15 needs version 2, 213 bytes is version 10, 214 is refused', () => {
  assert.equal(encode('hi').version, 1); assert.equal(encode('x'.repeat(14)).version, 1); assert.equal(encode('x'.repeat(15)).version, 2);
  assert.equal(encode('x'.repeat(213)).version, 10); assert.equal(encode('x'.repeat(213)).size, 57); assert.throws(() => encode('x'.repeat(214)), /too long/);
  assert.deepEqual(encode('same').modules, encode('same').modules, 'the same text always gives the same code');
});

test('every code decodes back to the exact text: lengths from 1 to 213 bytes (versions 1 to 10), a fingerprint, a link, accents, Arabic, emoji', () => {
  const rnd = n => crypto.randomBytes(n).toString('base64url').slice(0, n);
  const texts = [ 'a', 'NOVA', rnd(14), rnd(15), rnd(26), rnd(27), rnd(42), rnd(43), rnd(62), rnd(64), rnd(84), rnd(106), rnd(122), rnd(152), rnd(180), rnd(213),
    crypto.createHash('sha256').update('x').digest('hex'), 'https://nova.example.com/verify?f=' + crypto.createHash('sha256').update('y').digest('hex'), 'Café déjà vu — naïve', 'مراجعة طلب التأشيرة وتجديد الإقامة', 'Launch 🚀 ✅ 📅', 'line one\nline two' ];
  const seen = new Set();
  for (const t of texts) { const qr = encode(t); seen.add(qr.version); assert.equal(decode(qr), t, 'version ' + qr.version + ': ' + t.slice(0, 30)); }
  assert.ok([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every(v => seen.has(v)), 'all ten versions were covered: ' + [...seen].join(','));
  for (let i = 0; i < 60; i++) { const t = rnd(1 + Math.floor(Math.random() * 200)); assert.equal(decode(encode(t)), t, 'random #' + i + ' (' + t.length + ' bytes)'); }
});

test('the SVG for a receipt is the same code: parse its path and it decodes to the text; it is a plain image (no script, no font)', () => {
  const text = 'https://nova.example.com/verify?f=' + '0123456789abcdef'.repeat(4), svg = toSvg(encode(text), { label: 'QR code: check this receipt' });
  const back = fromSvg(svg), r = raster(back.modules, back.size); assert.equal(jsQR(r.px, r.dim, r.dim).data, text);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/); assert.doesNotMatch(svg, /<script|<text|font|onload|href/i); assert.match(svg, /role="img" aria-label="QR code: check this receipt"/);
});

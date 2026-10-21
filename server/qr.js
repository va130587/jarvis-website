// A small QR code encoder, written for NOVA so the proof receipt's QR code needs no outside library or service.
// Byte mode, error correction level M, versions 1 to 10 (up to 213 bytes): enough for a fingerprint and a link.
// The standard (ISO/IEC 18004) layout: finder, timing and alignment patterns, Reed-Solomon codes over GF(256), the best of 8 masks.
// tests/qr.test.js decodes what this makes with an independent QR reader.
'use strict';

const MAX_VERSION = 10;
const ECC_PER_BLOCK = [null, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];      // level M, by version
const NUM_BLOCKS = [null, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

const bit = (v, i) => ((v >>> i) & 1) !== 0;

// ---- Reed-Solomon over GF(256), polynomial 0x11D ----
function mul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; }
function rsGenerator(deg) {
  const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
  for (let i = 0; i < deg; i++) { for (let j = 0; j < r.length; j++) { r[j] = mul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; } root = mul(root, 0x02); }
  return r;
}
function rsRemainder(data, gen) {
  const r = new Array(gen.length).fill(0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); gen.forEach((c, i) => { r[i] ^= mul(c, f); }); }
  return r;
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2, size = ver * 4 + 17, step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2, out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}
function rawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
  return r;
}
const dataCodewords = ver => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

function encode(text) {
  const bytes = Buffer.from(String(text), 'utf8');
  let ver = 1;
  for (; ver <= MAX_VERSION; ver++) { const bits = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8; if (bits <= dataCodewords(ver) * 8) break; }
  if (ver > MAX_VERSION) throw new Error('That text is too long for the QR code (at most 213 bytes).');

  // 1. the data bits: mode (byte), length, bytes, terminator, padding
  const bits = []; const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  const cap = dataCodewords(ver) * 8; put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
  for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  // 2. split into blocks, add error correction, interleave
  const nb = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver], raw = Math.floor(rawDataModules(ver) / 8), shortBlocks = nb - raw % nb, shortLen = Math.floor(raw / nb);
  const gen = rsGenerator(eccLen), blocks = []; let k = 0;
  for (let i = 0; i < nb; i++) { const d = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1)); k += d.length; blocks.push({ d, e: rsRemainder(d, gen) }); }
  const all = [];
  for (let i = 0; i < blocks[nb - 1].d.length; i++) blocks.forEach(b => { if (i < b.d.length) all.push(b.d[i]); });
  for (let i = 0; i < eccLen; i++) blocks.forEach(b => all.push(b.e[i]));

  // 3. the grid: function patterns first, then the data in the zigzag order, then the best mask
  const size = ver * 4 + 17, mod = Array.from({ length: size }, () => new Array(size).fill(false)), fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, v) => { mod[y][x] = v; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4); } } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = alignmentPositions(ver);
  al.forEach((ax, i) => al.forEach((ay, j) => { if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }));
  const formatBits = mask => { const d = (0 << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); return ((d << 10) | r) ^ 0x5412; };   // level M = 0
  const drawFormat = mask => {
    const b = formatBits(mask);
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i)); set(8, 7, bit(b, 6)); set(8, 8, bit(b, 7)); set(7, 8, bit(b, 8)); for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i)); for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i)); set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) { let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25); const b = (ver << 12) | r; for (let i = 0; i < 18; i++) { const a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, bit(b, i)); set(c, a, bit(b, i)); } }

  const dbits = []; all.forEach(c => { for (let i = 7; i >= 0; i--) dbits.push((c >>> i) & 1); });
  let n = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - v : v;
      if (!fn[y][x] && n < dbits.length) mod[y][x] = dbits[n++] === 1;
    }
  }
  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => x * y % 2 + x * y % 3 === 0, (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const s = penalty(mod, size); if (s < bestScore) { bestScore = s; best = m; } applyMask(m); }
  applyMask(best); drawFormat(best);
  return { version: ver, size, modules: mod };
}

// Mask choice: the standard penalties (long runs, 2x2 blocks, finder-like patterns, dark/light balance).
function penalty(m, size) {
  let p = 0;
  const lines = []; for (let i = 0; i < size; i++) { lines.push(m[i]); lines.push(m.map(r => r[i])); }
  for (const line of lines) {
    let run = 1; for (let i = 1; i <= size; i++) { if (i < size && line[i] === line[i - 1]) run++; else { if (run >= 5) p += run - 2; run = 1; } }
    const s = line.map(v => (v ? '1' : '0')).join(''); for (const pat of ['10111010000', '00001011101']) { let at = s.indexOf(pat); while (at >= 0) { p += 40; at = s.indexOf(pat, at + 1); } }
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  let dark = 0; m.forEach(r => r.forEach(v => { if (v) dark++; }));
  return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
}

// An SVG (no scripts, no fonts): dark modules as one path, with the 4-module quiet zone the standard asks for.
function toSvg(qr, opts) {
  const o = opts || {}, quiet = 4, dim = qr.size + quiet * 2; let d = '';
  qr.modules.forEach((row, y) => { let x = 0; while (x < qr.size) { if (row[x]) { let w = 1; while (x + w < qr.size && row[x + w]) w++; d += 'M' + (x + quiet) + ',' + (y + quiet) + 'h' + w + 'v1h-' + w + 'z'; x += w; } else x++; } });
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '" width="' + (o.px || dim * 4) + '" height="' + (o.px || dim * 4) + '" shape-rendering="crispEdges" role="img" aria-label="' + (o.label || 'QR code') + '">' +
    '<rect width="' + dim + '" height="' + dim + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
module.exports = { encode, toSvg, MAX_VERSION };

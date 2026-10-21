// Serving the web files: gzip for text (Node's own zlib, nothing to install), an ETag so an unchanged file answers "304 Not Modified" with no body,
// and the right Vary header so caches never hand a compressed copy to a browser that did not ask for one.
// Only files are cached here, never anything under /api/ or /auth/ (those are answered by the API with "no-store").
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const TEXT = /^(text\/|application\/(json|manifest\+json|javascript)|image\/svg\+xml)/;
const MIN_GZIP = 1024, MAX_CACHED = 3 * 1024 * 1024;       // tiny files are not worth compressing; huge ones are streamed as they are

// Does this request accept gzip? ("gzip;q=0" means no, "*" means yes.)
function wantsGzip(header) {
  let q = null;
  for (const part of String(header || '').split(',')) {
    const [name, ...params] = part.trim().split(';'), n = name.trim().toLowerCase();
    if (n !== 'gzip' && n !== '*') continue;
    const m = params.map(p => /^\s*q\s*=\s*([\d.]+)/.exec(p)).find(Boolean), v = m ? parseFloat(m[1]) : 1;
    if (n === 'gzip' || q === null) q = v;
  }
  return q !== null && q > 0;
}
// If-None-Match: a list of tags, "*" or weak tags; a match means the browser already has this exact representation.
function matches(header, etag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some(t => t.trim().replace(/^W\//, '') === etag);
}

function createStatic({ root, types, headers }) {
  const cache = new Map();           // file -> the last version read (kept while its time and size are unchanged)
  function asset(file) {
    const st = fs.statSync(file), c = cache.get(file);
    if (c && c.mtime === st.mtimeMs && c.size === st.size) return c;
    const type = types[path.extname(file)] || 'application/octet-stream';
    if (st.size > MAX_CACHED) return { big: true, type, size: st.size };
    const body = fs.readFileSync(file), hash = crypto.createHash('sha1').update(body).digest('hex').slice(0, 27);
    let gz = null;
    if (TEXT.test(type) && body.length >= MIN_GZIP) { const z = zlib.gzipSync(body, { level: 9 }); if (z.length < body.length) gz = z; }
    const a = { mtime: st.mtimeMs, size: st.size, type, body, gz, text: TEXT.test(type), etag: '"' + hash + '"', gzEtag: '"' + hash + '-gzip"' };
    cache.set(file, a); return a;
  }
  // true if it answered; false if there is no such file (the caller then answers 404)
  function serve(req, res, pathname) {
    const file = path.join(root, pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
    const a = asset(file), head = req.method === 'HEAD';
    if (a.big) { res.writeHead(200, Object.assign({ 'Content-Type': a.type, 'Content-Length': a.size, 'Cache-Control': 'no-cache' }, headers)); if (head) res.end(); else fs.createReadStream(file).pipe(res); return true; }
    const gz = !!a.gz && wantsGzip(req.headers['accept-encoding']), etag = gz ? a.gzEtag : a.etag;
    const h = Object.assign({ 'Content-Type': a.type, 'Cache-Control': 'no-cache', ETag: etag }, a.text ? { Vary: 'Accept-Encoding' } : {}, headers);
    if (matches(req.headers['if-none-match'], etag)) { res.writeHead(304, h); res.end(); return true; }
    const body = gz ? a.gz : a.body;
    res.writeHead(200, Object.assign(h, { 'Content-Length': body.length }, gz ? { 'Content-Encoding': 'gzip' } : {}));
    res.end(head ? undefined : body); return true;
  }
  return { serve, wantsGzip, matches };
}
module.exports = { createStatic, wantsGzip, matches };

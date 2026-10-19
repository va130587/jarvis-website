// Tiny HTTP helpers: routing, JSON bodies, cookies, errors. No framework.
'use strict';

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code || 'error'; } }

function compile(pattern) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[a-z]+/gi, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  return { rx, keys };
}
class Router {
  constructor() { this.routes = []; }
  add(method, pattern, opts, handler) { if (!handler) { handler = opts; opts = {}; } this.routes.push(Object.assign({ method, handler }, compile(pattern), { opts })); }
  get(p, o, h) { this.add('GET', p, o, h); } post(p, o, h) { this.add('POST', p, o, h); }
  patch(p, o, h) { this.add('PATCH', p, o, h); } del(p, o, h) { this.add('DELETE', p, o, h); }
  match(method, pathname) {
    let pathHit = false;
    for (const r of this.routes) {
      const m = r.rx.exec(pathname);
      if (!m) continue;
      pathHit = true;
      if (r.method !== method) continue;
      const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return { route: null, pathHit };
  }
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function cookie(name, value, o) {
  o = o || {};
  return [name + '=' + encodeURIComponent(value), 'Path=/', 'HttpOnly', 'SameSite=Lax', o.secure ? 'Secure' : '', o.maxAge !== undefined ? 'Max-Age=' + Math.floor(o.maxAge) : ''].filter(Boolean).join('; ');
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    let dead = false;
    req.on('data', c => { if (dead) return; size += c.length; if (size > limit) { dead = true; chunks.length = 0; reject(new HttpError(413, 'Request too large.', 'too_large')); req.resume(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req, limit) {
  const raw = await readBody(req, limit || 100 * 1024);
  if (!raw) return {};
  if (!/application\/json/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Send JSON with Content-Type: application/json.', 'bad_type');
  try { const v = JSON.parse(raw); if (v === null || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; }
  catch (e) { throw new HttpError(400, 'The request body is not valid JSON.', 'bad_json'); }
}
function send(res, status, body, headers) {
  const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, Object.assign({ 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}));
  res.end(data);
}

// Small validators used by the API (strings are trimmed and length-limited; anything else is rejected, never coerced).
function str(v, name, o) {
  o = o || {};
  if (v === undefined || v === null) { if (o.optional) return undefined; throw new HttpError(400, name + ' is required.', 'invalid'); }
  if (typeof v !== 'string') throw new HttpError(400, name + ' must be text.', 'invalid');
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (!s && !o.allowEmpty) { if (o.optional) return undefined; throw new HttpError(400, name + ' cannot be empty.', 'invalid'); }
  if (s.length > (o.max || 500)) throw new HttpError(400, name + ' is too long (maximum ' + (o.max || 500) + ' characters).', 'invalid');
  return s;
}
function oneOf(v, name, allowed, o) {
  if ((v === undefined || v === null) && o && o.optional) return undefined;
  if (!allowed.includes(v)) throw new HttpError(400, name + ' must be one of: ' + allowed.join(', ') + '.', 'invalid');
  return v;
}
module.exports = { HttpError, Router, parseCookies, cookie, readJson, send, str, oneOf };

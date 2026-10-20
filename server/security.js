// Security helpers: headers/CSP, rate limiting, audit log, secret redaction.
'use strict';

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline'",   // unsafe-inline: the UI sets style="" attributes; scripts stay strict
  "font-src 'self'",
  "img-src 'self' data: https://lh3.googleusercontent.com",
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com https://graph.microsoft.com https://login.microsoftonline.com https://boards-api.greenhouse.io https://boards-api.eu.greenhouse.io https://api.lever.co https://api.ashbyhq.com https://cdn.jsdelivr.net https://huggingface.co https://*.huggingface.co https://raw.githubusercontent.com",
  "frame-src https://accounts.google.com https://login.microsoftonline.com",
  "object-src 'none'", "base-uri 'self'", "form-action 'self' https://accounts.google.com", "frame-ancestors 'none'"
].join('; ');

function securityHeaders(cfg) {
  const h = {
    'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY', 'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()', 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups'
  };
  if (cfg.secureCookies) h['Strict-Transport-Security'] = 'max-age=15552000; includeSubDomains';
  return h;
}

// Fixed-window rate limiter kept in memory (one process). key = group + client.
class RateLimiter {
  constructor(now) { this.now = now; this.hits = new Map(); }
  check(key, max, perMs) {
    const t = this.now(), e = this.hits.get(key);
    if (!e || t - e.start >= perMs) { this.hits.set(key, { start: t, n: 1 }); return { ok: true }; }
    e.n++;
    if (e.n > max) return { ok: false, retryAfter: Math.ceil((e.start + perMs - t) / 1000) };
    return { ok: true };
  }
  sweep() { const t = this.now(); for (const [k, e] of this.hits) if (t - e.start > 10 * 60e3) this.hits.delete(k); }
}

// Never let tokens, keys or long secrets reach logs or the audit table.
const SECRET_RX = /(sk-ant-[A-Za-z0-9_-]+|ya29\.[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|AIza[0-9A-Za-z_-]{20,}|GOCSPX-[A-Za-z0-9_-]+|(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+)/gi;
function redact(s) { return String(s == null ? '' : s).replace(SECRET_RX, '[redacted]').slice(0, 500); }

function audit(db, now, userId, action, detail, ip) {
  db.prepare('INSERT INTO audit_log (user_id, ts, action, detail, ip) VALUES (?, ?, ?, ?, ?)').run(userId == null ? null : userId, now(), action, detail ? redact(typeof detail === 'string' ? detail : JSON.stringify(detail)) : null, ip || null);
}
module.exports = { securityHeaders, RateLimiter, redact, audit, CSP };

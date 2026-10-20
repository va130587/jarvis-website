// Encryption for stored account tokens: AES-256-GCM with a key derived (scrypt) from NOVA_SECRET_KEY. Without that key NOVA stores no tokens.
'use strict';
const crypto = require('crypto');
const cache = new Map();
function key(secret) {
  if (!secret || secret.length < 16) { const e = new Error('NOVA_SECRET_KEY is not set (or shorter than 16 characters), so NOVA cannot store account tokens safely.'); e.code = 'no_secret_key'; throw e; }
  if (!cache.has(secret)) cache.set(secret, crypto.scryptSync(secret, 'nova-token-v1', 32));
  return cache.get(secret);
}
function seal(secret, obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(secret), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return 'v1.' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}
function unseal(secret, s) {
  if (!/^v1\./.test(String(s))) throw new Error('Unknown token format.');
  const b = Buffer.from(s.slice(3), 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', key(secret), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
}
module.exports = { seal, unseal };

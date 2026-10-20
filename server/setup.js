// First-run setup. When NOVA starts without OWNER_EMAILS (and without a .env file that sets it), `npm start` serves this small
// setup page instead of failing. It only listens on this computer (loopback), needs a one-time token printed in the terminal
// (so another program or web page cannot complete it), writes .env with owner-only permissions, and then NOVA starts for real.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOOPBACK = /^(127\.0\.0\.1|localhost|::1)$/;
const EMAIL = /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/;
const rand = n => crypto.randomBytes(n).toString('base64url');

// Builds the .env text. Only these keys are written; values are validated first. Returns { text, ntfyTopic }.
function buildEnv(o) {
  const email = String(o.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) throw Object.assign(new Error('Enter a valid e-mail address.'), { status: 400 });
  const ai = ['local', 'ollama'].includes(o.ai) ? o.ai : 'local';
  const model = /^[a-z0-9._:-]{1,40}$/i.test(String(o.ollamaModel || '')) ? o.ollamaModel : 'qwen2.5:7b';
  const ntfyTopic = o.ntfy ? 'nova-' + rand(18).replace(/[-_]/g, 'x') : '';
  const lines = [
    '# Written by NOVA first-run setup on ' + new Date().toISOString() + '. Keep this file private (it is in .gitignore).',
    '# Change any value and restart NOVA (npm start). See .env.example for every option.',
    'OWNER_EMAILS=' + email,
    'AUTH_MODE=dev',
    'HOST=127.0.0.1',
    'PORT=' + (o.port || 8787),
    '# Encrypts stored Gmail tokens. Back it up with your database; without it, Gmail must be reconnected.',
    'NOVA_SECRET_KEY=' + rand(32),
    'NOVA_AI_PROVIDER=' + ai,
    ai === 'ollama' ? 'NOVA_OLLAMA_MODEL=' + model : '# NOVA_OLLAMA_MODEL=qwen2.5:7b',
    ntfyTopic ? '# Phone push: subscribe to this topic in the free ntfy app. Anyone who knows it can read the messages.' : '# Phone push (optional): NOVA_NTFY_TOPIC=<a long random topic you subscribe to in the ntfy app>',
    ntfyTopic ? 'NOVA_NTFY_TOPIC=' + ntfyTopic : '',
    'NOVA_SCHEDULER=on', ''
  ].filter(l => l !== '');
  return { text: lines.join('\n') + '\n', ntfyTopic, email };
}

function checks(root) {
  const major = +process.versions.node.split('.')[0], minor = +process.versions.node.split('.')[1];
  let writable = true; try { fs.accessSync(root, fs.constants.W_OK); } catch (e) { writable = false; }
  return [
    { name: 'Node.js 22.13 or newer', ok: major > 22 || (major === 22 && minor >= 13), detail: 'You have ' + process.versions.node + '.' },
    { name: 'Built-in database (node:sqlite)', ok: (() => { try { require('node:sqlite'); return true; } catch (e) { return false; } })(), detail: 'No extra install needed.' },
    { name: 'NOVA folder is writable', ok: writable, detail: writable ? 'The database and settings can be saved.' : 'NOVA cannot save its settings here.' }
  ];
}

// Serves the setup page; resolves with the chosen settings once they are saved. opts: { root, envPath, host, port, log }
function runSetup(opts) {
  const root = opts.root, envPath = opts.envPath, token = rand(18), host = opts.host || '127.0.0.1', port = opts.port === undefined ? 8787 : opts.port;
  if (!LOOPBACK.test(host)) return Promise.reject(new Error('First-run setup only runs on this computer (HOST must be 127.0.0.1 or localhost). Set OWNER_EMAILS in .env instead.'));
  const files = { '/': ['setup.html', 'text/html; charset=utf-8'], '/setup-page.js': ['setup-page.js', 'text/javascript; charset=utf-8'], '/setup.css': ['setup.css', 'text/css; charset=utf-8'], '/design.css': ['design.css', 'text/css; charset=utf-8'] };
  const headers = { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' };
  let done;
  const finished = new Promise(r => { done = r; });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (st, o) => { res.writeHead(st, Object.assign({ 'Content-Type': 'application/json' }, headers)); res.end(JSON.stringify(o)); };
    if (req.method === 'GET' && files[url.pathname]) { res.writeHead(200, Object.assign({ 'Content-Type': files[url.pathname][1] }, headers)); return fs.createReadStream(path.join(root, files[url.pathname][0])).pipe(res); }
    if (req.method === 'GET' && url.pathname === '/setup/status') return json(200, { checks: checks(root), envExists: fs.existsSync(envPath), port });
    if (req.method === 'GET' && url.pathname === '/api/session') return json(200, { setup: true });
    if (req.method === 'POST' && url.pathname === '/setup/save') {
      const o = req.headers.origin;
      if (o && new URL(o).host !== req.headers.host) return json(403, { error: { message: 'Cross-site request blocked.' } });
      let body = '';
      req.on('data', d => { body += d; if (body.length > 4000) req.destroy(); });
      req.on('end', () => {
        let b; try { b = JSON.parse(body || '{}'); } catch (e) { return json(400, { error: { message: 'Bad request.' } }); }
        if (!b.token || b.token.length !== token.length || !crypto.timingSafeEqual(Buffer.from(String(b.token)), Buffer.from(token))) return json(403, { error: { message: 'Wrong setup code. Copy it from the terminal where you ran npm start.' } });
        if (fs.existsSync(envPath)) return json(409, { error: { message: 'A .env file already exists. Edit it instead, then restart NOVA.' } });
        let out; try { out = buildEnv(Object.assign({}, b, { port })); } catch (e) { return json(e.status || 400, { error: { message: e.message } }); }
        fs.writeFileSync(envPath, out.text, { mode: 0o600 });
        json(200, { ok: true, email: out.email, ntfyTopic: out.ntfyTopic || null });
        setTimeout(() => { server.closeAllConnections(); server.close(() => done({ email: out.email })); }, 300);
      });
      return;
    }
    json(404, { error: { message: 'Not found.' } });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const p = server.address().port;
      if (opts.log !== false) {
        console.log('\n  NOVA first-run setup');
        console.log('  Open  http://' + (host === '::1' ? '[::1]' : host) + ':' + p + '  in your browser.');
        console.log('  Setup code: ' + token + '   (paste it on the page)\n');
      }
      resolve({ port: p, token, finished, server });
    });
  });
}
module.exports = { runSetup, buildEnv, checks };

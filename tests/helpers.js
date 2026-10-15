// Shared test helpers: static server, browser launch, Google / Microsoft API mocks, speech mocks.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.ics': 'text/calendar', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain' };

function startServer(port) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(port || 0, '127.0.0.1', () => resolve({ url: 'http://127.0.0.1:' + srv.address().port, close: () => srv.close() }));
  });
}

function playwright() {
  try { return require('playwright'); } catch (e) { return require('/opt/node-tools/node_modules/playwright'); }
}
async function launch() {
  const pw = playwright();
  const opts = {};
  if (fs.existsSync('/opt/pw-browsers/chromium') && !process.env.PLAYWRIGHT_BROWSERS_PATH) opts.executablePath = '/opt/pw-browsers/chromium';
  return pw.chromium.launch(opts);
}
const BASE = () => process.env.BASE_URL || 'http://127.0.0.1:8000';

/* ---------- Fake Google Identity Services (the real sign-in needs a person) ---------- */
const FAKE_GIS = `
  window.__gis = { requests: [], revoked: [], next: { grant: 'all', error: null } };
  window.google = { accounts: { oauth2: {
    initTokenClient(cfg) {
      return { requestAccessToken(over) {
        const scope = (over && over.scope) || cfg.scope;
        window.__gis.requests.push({ scope, prompt: over && over.prompt, client_id: cfg.client_id });
        setTimeout(() => {
          const n = window.__gis.next;
          if (n.popupError) { cfg.error_callback && cfg.error_callback({ type: n.popupError }); return; }
          if (n.error) { cfg.callback({ error: n.error }); return; }
          const granted = n.grant === 'read' ? 'https://www.googleapis.com/auth/calendar.readonly' : scope;
          cfg.callback({ access_token: 'tok-' + window.__gis.requests.length, expires_in: 3599, scope: granted, token_type: 'Bearer' });
        }, 10);
      } };
    },
    hasGrantedAllScopes(resp, ...scopes) { return scopes.every(s => (resp.scope || '').split(' ').includes(s)); },
    revoke(token, cb) { window.__gis.revoked.push(token); cb && cb({ successful: true }); }
  } } };`;

// Fill defaults in place so a test can change state.fail etc. while the mock is running.
function fill(state) {
  state = state || {};
  const d = { calendars: [], events: {}, calls: [], fail: null, seq: 1 };
  Object.keys(d).forEach(k => { if (state[k] === undefined) state[k] = d[k]; });
  return state;
}

/* ---------- In-memory Google Calendar API ---------- */
function googleApi(state) {
  state = fill(state);
  return async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    const auth = req.headers()['authorization'] || '';
    state.calls.push(method + ' ' + url.pathname);
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (state.fail === 'offline') return route.abort('internetdisconnected');
    if (state.fail === 401 || !auth.startsWith('Bearer ')) return json(401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } });
    if (state.fail === 403) return json(403, { error: { code: 403, message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }], status: 'PERMISSION_DENIED' } });
    if (state.fail === 'api-disabled') return json(403, { error: { code: 403, message: 'Google Calendar API has not been used in project 123 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } });
    let m;
    if (url.pathname.endsWith('/users/me/calendarList')) return json(200, { items: state.calendars });
    if ((m = url.pathname.match(/\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/))) {
      const cal = decodeURIComponent(m[1]) === 'primary' ? state.calendars.find(c => c.primary).id : decodeURIComponent(m[1]);
      const list = state.events[cal] = state.events[cal] || [];
      const id = m[2] && decodeURIComponent(m[2]);
      if (method === 'GET' && !id) return json(200, { items: list.filter(e => e.status !== 'cancelled') });
      if (method === 'POST') { const body = JSON.parse(req.postData()); const ev = Object.assign({ id: 'g' + (state.seq++), status: 'confirmed', htmlLink: 'https://calendar.google.com/event?eid=x' }, body); list.push(ev); return json(200, ev); }
      const ev = list.find(e => e.id === id);
      if (!ev) return json(404, { error: { code: 404, message: 'Not Found' } });
      if (method === 'PATCH') { Object.assign(ev, JSON.parse(req.postData())); return json(200, ev); }
      if (method === 'DELETE') { list.splice(list.indexOf(ev), 1); return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }
    }
    return json(404, { error: { code: 404, message: 'Unknown mock path ' + url.pathname } });
  };
}

/* ---------- Fake MSAL.js + in-memory Microsoft Graph ---------- */
const FAKE_MSAL = `
  window.__msal = { logins: 0, silent: 'ok', popupError: null, cleared: 0 };
  class InteractionRequiredAuthError extends Error { constructor(m) { super(m); this.name = 'InteractionRequiredAuthError'; this.errorCode = 'interaction_required'; } }
  class PublicClientApplication {
    constructor(cfg) { this.cfg = cfg; window.__msal.cfg = cfg; this.acc = JSON.parse(localStorage.getItem('fake.msal.acc') || 'null'); }
    async initialize() {}
    getAllAccounts() { return this.acc ? [this.acc] : []; }
    async loginPopup(req) {
      if (window.__msal.popupError) { const e = new Error(window.__msal.popupError); e.errorCode = window.__msal.popupError.split(':')[0]; throw e; }
      window.__msal.logins++; window.__msal.scopes = req.scopes;
      this.acc = { username: 'roshan@outlook.com', homeAccountId: 'acc1' }; localStorage.setItem('fake.msal.acc', JSON.stringify(this.acc));
      return { account: this.acc, accessToken: 'ms-tok-' + window.__msal.logins };
    }
    async acquireTokenSilent(req) {
      if (window.__msal.silent !== 'ok') throw new InteractionRequiredAuthError('interaction_required');
      return { accessToken: 'ms-tok-silent', account: this.acc };
    }
    async acquireTokenPopup(req) { window.__msal.silent = 'ok'; window.__msal.logins++; return { accessToken: 'ms-tok-popup', account: this.acc }; }
    async clearCache() { window.__msal.cleared++; this.acc = null; localStorage.removeItem('fake.msal.acc'); }
  }
  window.msal = { PublicClientApplication, InteractionRequiredAuthError };`;

function graphApi(state) {
  state = fill(state);
  return async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    state.calls.push(method + ' ' + url.pathname);
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (state.fail === 'offline') return route.abort('internetdisconnected');
    if (state.fail === 401) return json(401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token has expired.' } });
    if (state.fail === 403) return json(403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied. Check credentials and try again.' } });
    let m;
    if (url.pathname === '/v1.0/me/calendars') return json(200, { value: state.calendars });
    if ((m = url.pathname.match(/^\/v1\.0\/me\/calendars\/([^/]+)\/calendarView$/))) {
      const id = decodeURIComponent(m[1]);
      return json(200, { value: (state.events[id] || []) });
    }
    if (url.pathname === '/v1.0/me/events' && method === 'POST') {
      const body = JSON.parse(req.postData()); const def = state.calendars.find(c => c.isDefaultCalendar).id;
      const ev = Object.assign({ id: 'm' + (state.seq++), webLink: 'https://outlook.live.com/calendar/item/x' }, body);
      (state.events[def] = state.events[def] || []).push(ev); return json(201, ev);
    }
    if ((m = url.pathname.match(/^\/v1\.0\/me\/events\/([^/]+)$/))) {
      const id = decodeURIComponent(m[1]);
      for (const k of Object.keys(state.events)) {
        const list = state.events[k], ev = list.find(e => e.id === id);
        if (!ev) continue;
        if (method === 'PATCH') { Object.assign(ev, JSON.parse(req.postData())); return json(200, ev); }
        if (method === 'DELETE') { list.splice(list.indexOf(ev), 1); return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }
      }
      return json(404, { error: { code: 'ErrorItemNotFound', message: 'Not found' } });
    }
    return json(404, { error: { code: 'NotFound', message: 'Unknown mock path ' + url.pathname } });
  };
}

/* ---------- Speech mocks (the test browser has no microphone or speakers) ---------- */
const FAKE_SPEECH = `
  window.__said = [];
  const synth = { speaking: false, paused: false, q: [], getVoices: () => [{ name: 'Google UK English Male', lang: 'en-GB', voiceURI: 'm' }], addEventListener() {},
    cancel() { const q = this.q; this.q = []; clearTimeout(this.t); this.speaking = false; q.forEach(u => u.onend && u.onend()); }, resume() {},
    speak(u) { window.__said.push(u.text); this.q.push(u); if (this.q.length === 1) this.run(); },
    run() { const u = this.q[0]; if (!u) { this.speaking = false; return; } this.speaking = true; u.onstart && u.onstart(); this.t = setTimeout(() => { this.q.shift(); u.onend && u.onend(); this.run(); }, 30); } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  window.__notes = [];
  window.Notification = function (title, o) { window.__notes.push(title + ': ' + (o && o.body)); };
  window.Notification.permission = 'granted'; window.Notification.requestPermission = () => Promise.resolve('granted');`;

/**
 * Opens Jarvis in a fresh browser context with mocks. Returns { page, ctx, errors, google, graph }.
 * opts: { width, height, now (Date ms to freeze "today"), data (localStorage data to start with), google, graph, offlineFonts }
 */
async function openApp(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: opts.width || 1440, height: opts.height || 900 }, timezoneId: opts.timezoneId || 'Asia/Dubai', acceptDownloads: true });
  const errors = [];
  const google = opts.google || {}, graph = opts.graph || {};
  google.calls = google.calls || []; graph.calls = graph.calls || [];
  await ctx.addInitScript(([speech, gis, init]) => {
    try { sessionStorage.setItem('jarvis.booted', '1'); } catch (e) {}
    if (init.data && !sessionStorage.getItem('test.seeded')) { localStorage.setItem('jarvis.v3', JSON.stringify(init.data)); sessionStorage.setItem('test.seeded', '1'); }
    if (init.now) {
      const RealDate = Date, offset = init.now - RealDate.now();
      // Freeze "now" (time keeps moving from this point) so dates in tests are predictable.
      // eslint-disable-next-line no-global-assign
      Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); } static now() { return RealDate.now() + offset; } };
    }
    (0, eval)(speech);
    if (init.fakeGis) (0, eval)(gis);
  }, [FAKE_SPEECH, FAKE_GIS, { data: opts.data || null, now: opts.now || null, fakeGis: opts.realGis ? false : true }]);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  if (!opts.realGis) await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* fake GIS already installed */' }));
  await ctx.route(/https:\/\/www\.googleapis\.com\/calendar\/v3\//, googleApi(google));
  await ctx.route(/\/vendor\/msal-browser-[\d.]+\.min\.js$/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_MSAL }));
  await ctx.route(/https:\/\/graph\.microsoft\.com\//, graphApi(graph));
  await ctx.route(/boards-api|api\.lever\.co|api\.ashbyhq\.com|api\.open-meteo\.com/, r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.type() + ': ' + m.text()); });
  await page.goto(BASE() + '/' + (opts.hash ? '#' + opts.hash : ''));
  await page.waitForFunction(() => window.J && J.cal && J.voice);
  return { page, ctx, errors, google, graph };
}

// Ask Jarvis something by typing (same system as voice) and return the reply text.
async function ask(page, text) {
  return page.evaluate(async t => {
    const out = await J.voice.command(t);
    return typeof out === 'string' ? out : out && (out.text || '');
  }, text);
}

// Confirm the open dialog, then wait for the result message (an older message is cleared first).
async function confirmAndWait(page, re) {
  await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
  await page.click('#confirmYes');
  await page.waitForFunction(src => new RegExp(src).test(document.getElementById('toast').textContent), re.source);
}

module.exports = { startServer, launch, openApp, ask, confirmAndWait, BASE, ROOT, googleApi, graphApi };

// The Gmail setup guide in the browser (stand-in Google): numbered steps with the exact addresses and Copy buttons, a live checklist,
// the plain message for every way Google can send you back, Test connection, and the same guide on Help. Keyboard only works;
// clean at four widths in both themes, also at 150% text.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const H = require('./helpers');
const { checkLayout } = require('./layout-check');
const { createApp } = require('../server');

const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
let browser; const closers = [];
test.before(async () => { browser = await H.launch(); });
test.after(async () => { await browser.close(); for (const f of closers) await f().catch(() => {}); });

function google() {
  const msgs = Array.from({ length: 6 }, (_, i) => ({ id: 'm' + i, threadId: 't' + i, internalDate: String(Date.now() - i * 3600e3), labelIds: ['INBOX'], snippet: 'Hello', payload: { headers: [{ name: 'From', value: 'A <a@x.example>' }, { name: 'Subject', value: 'Hi' }] } }));
  return new Promise(res => {
    const srv = http.createServer((req, resp) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
      const json = (st, o) => { resp.writeHead(st, { 'Content-Type': 'application/json' }); resp.end(JSON.stringify(o)); };
      if (req.url === '/token') return json(200, { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.readonly' });
      if (req.url === '/revoke') return json(200, {});
      if (req.url === '/gmail/v1/users/me/profile') return json(200, { emailAddress: 'me@gmail.example' });
      if (/^\/gmail\/v1\/users\/me\/messages\?/.test(req.url)) return json(200, { messages: msgs.map(m => ({ id: m.id })) });
      const one = /^\/gmail\/v1\/users\/me\/messages\/([^?]+)/.exec(req.url); if (one) return json(200, msgs.find(m => m.id === one[1]));
      json(404, {});
    }); });
    srv.listen(0, '127.0.0.1', () => res({ url: 'http://127.0.0.1:' + srv.address().port, close: () => new Promise(r => { srv.closeAllConnections(); srv.close(r); }) }));
  });
}
async function server(configured) {
  const g = await google(); closers.push(g.close);
  const env = { BASE_URL: '', NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-gm-')), 'g.db'), AUTH_MODE: 'dev', OWNER_EMAILS: 'a@nova.local', HOST: '127.0.0.1', PORT: '0', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' };
  if (configured !== false) Object.assign(env, { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret', NOVA_SECRET_KEY: 'a-long-random-test-key-0123456789', GOOGLE_TOKEN_URL: g.url + '/token', GOOGLE_REVOKE_URL: g.url + '/revoke', NOVA_GMAIL_API_URL: g.url });
  const app = createApp(env); closers.push(async () => { app.server.closeAllConnections(); await app.close(); });
  return { app, base: 'http://127.0.0.1:' + await app.listen() };
}
async function open(base, opts, hash) {
  const o = await H.openApp(browser, Object.assign({ base, hash: '' }, opts || {}));
  await o.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base }).catch(() => {});
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.fill('#novaDevEmail', 'a@nova.local'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  await o.page.evaluate(h => { location.hash = h; }, hash || 'email'); await o.page.waitForSelector('#gmGuide');
  return o;
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets/.test(e));
const axeRun = async page => { await page.evaluate(src => { if (!window.axe) (0, eval)(src); }, AXE); const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] })); return ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')); };
const connect = page => page.evaluate(async () => { const r = await NOVA.api('POST', '/api/gmail/connect', {}); const st = new URL(r.url).searchParams.get('state'); await fetch('/auth/gmail/callback?state=' + st + '&code=good', { redirect: 'manual' }); });

test('the guide: open when not connected, with the exact addresses, a live checklist, and Copy buttons that work by keyboard', async () => {
  const { base } = await server(); const { page, ctx, errors } = await open(base);
  assert.equal(await page.getAttribute('#gmGuide details', 'open') !== null, true);
  const text = await page.innerText('#gmGuide'); assert.match(text, /Connect Gmail: step by step/); assert.match(text, /Create a Google Cloud project/); assert.match(text, /Enable the Gmail API/); assert.match(text, /Test users/); assert.match(text, /Advanced.*Continue/s);
  assert.equal((await page.$$('#gmGuide .gm-steps > li')).length, 7);
  const codes = await page.$$eval('#gmGuide .gm-uri code', c => c.map(x => x.textContent)); assert.deepEqual(codes, [base + '/auth/gmail/callback', base + '/auth/google/callback']);
  const checks = await page.$$eval('#gmGuide .gm-checks li', l => l.map(x => x.innerText.replace(/\s+/g, ' '))); assert.equal(checks.length, 5); assert.match(checks[0], /client ID is set.*OK/i); assert.match(checks[4], /Check yourself/i);
  assert.ok(!(await page.innerText('main')).includes('csecret'), 'no secret on the page');
  await page.focus('#gmGuide [data-act="gmCopy"][data-id="gmail"]'); await page.keyboard.press('Enter');
  await page.waitForSelector('.toast:has-text("Copied the address"), #toast:has-text("Copied the address"), [role="status"]:has-text("Copied the address")');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), base + '/auth/gmail/callback');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('when settings are missing the checklist says what to do, and Connect is not offered', async () => {
  const { base } = await server(false); const { page, ctx } = await open(base);
  const checks = await page.$$eval('#gmGuide .gm-checks li', l => l.map(x => x.innerText.replace(/\s+/g, ' ')));
  assert.match(checks[0], /GOOGLE_CLIENT_ID.*to do/is); assert.match(checks[2], /NOVA_SECRET_KEY/i);
  assert.equal(await page.locator('button[data-act="dConnect"]').count(), 0); await ctx.close();
});

test('coming back from Google shows the plain cause and fix for each problem', async () => {
  const { base } = await server(); const { page, ctx } = await open(base);
  const cases = [['denied', /Test users/], ['redirect_mismatch', /exactly as written/], ['api_disabled', /Library.*Enable/], ['bad_client', /GOOGLE_CLIENT_SECRET/], ['scope', /view your email messages/], ['expired', /ten minutes/], ['network', /internet connection/]];
  for (const [reason, rx] of cases) {
    await page.goto(base + '/?gmail=' + reason + '#email'); await page.waitForSelector('.gmail-msg');
    assert.match(await page.innerText('.gmail-msg'), rx, reason);
    assert.equal(new URL(page.url()).search, '', 'the address is cleaned up');
  }
  await ctx.close();
});

test('Test connection passes and says it kept nothing; Disconnect is honest', async () => {
  const { base, app } = await server(); const { page, ctx, errors } = await open(base);
  await connect(page); await page.evaluate(() => { location.hash = 'dashboard'; }); await page.evaluate(() => { location.hash = 'email'; }); await page.waitForSelector('button[data-act="gmTest"]');
  assert.equal(await page.getAttribute('#gmGuide details', 'open'), null, 'folded away once connected');
  await page.keyboard.press('Tab'); await page.focus('button[data-act="gmTest"]'); await page.keyboard.press('Enter');
  await page.waitForSelector('.gm-result.ok'); assert.match(await page.innerText('.gm-result'), /Passed\. It works\. NOVA read the headers of 5 recent messages and kept nothing\./);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM emails').get().n, 0, 'nothing stored by the test');
  await page.click('button[data-act="dDisconnect"]'); await page.click('#confirmOk, dialog[open] button.primary, dialog[open] button:has-text("Disconnect")');
  await page.waitForSelector('button[data-act="dConnect"]'); assert.equal(app.db.prepare("SELECT COUNT(*) n FROM connections").get().n, 0);
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('the same guide is on the Help page', async () => {
  const { base } = await server(); const { page, ctx } = await open(base, {}, 'support');
  assert.match(await page.innerText('#gmGuide'), /Connect Gmail: step by step/); assert.equal((await page.$$('#gmGuide .gm-steps > li')).length, 7); await ctx.close();
});

for (const width of [390, 768, 1024, 1440]) for (const theme of ['dark', 'light']) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ': Smart Email guide and Help, also at 150% text', async () => {
    const { base } = await server(); const { page, ctx, errors } = await open(base, { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : undefined });
    await page.waitForTimeout(300); assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    await page.click('#gmGuide .gm-prob summary'); assert.deepEqual(await axeRun(page), []);
    await page.evaluate(() => document.documentElement.setAttribute('data-text', '150')); await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    await page.evaluate(() => { location.hash = 'support'; }); await page.waitForSelector('#gmGuide'); await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(page), []);
    assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

// Live checks against the real Google services (no mocks). Skipped with a clear reason when the network
// does not allow it. A real sign-in always needs a person to accept Google's consent screen.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let browser, server, page, ctx, reachable = null;
test.before(async () => {
  if (!process.env.BASE_URL) { server = await H.startServer(); process.env.BASE_URL = server.url; }
  browser = await H.launch();
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await page.goto(process.env.BASE_URL + '/redirect.html');
  reachable = await page.evaluate(() => fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList').then(r => r.status, e => 'unreachable: ' + e.message));
});
test.after(async () => { await ctx.close(); await browser.close(); if (server) server.close(); });

test('the Google Calendar API answers this browser (CORS allowed) and asks for sign-in', async t => {
  if (typeof reachable !== 'number') return t.skip('Google is not reachable from this machine (' + reachable + ').');
  assert.equal(reachable, 401, 'without a token Google answers 401 (and the browser could read the answer, so CORS works)');
  const body = await page.evaluate(() => fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList').then(r => r.json()));
  assert.equal(body.error.code, 401);
});

test('Google Identity Services loads and creates a token client for a Client ID', async t => {
  if (typeof reachable !== 'number') return t.skip('Google is not reachable from this machine.');
  const r = await page.evaluate(() => new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => {
      const id = '';
      const client = google.accounts.oauth2.initTokenClient({ client_id: id || '123456789012-test.apps.googleusercontent.com', scope: 'https://www.googleapis.com/auth/calendar.readonly', callback: () => {} });
      resolve({ ok: typeof client.requestAccessToken === 'function', revoke: typeof google.accounts.oauth2.revoke === 'function', has: typeof google.accounts.oauth2.hasGrantedAllScopes === 'function' });
    };
    s.onerror = () => resolve({ ok: false, error: 'script failed to load' });
    document.head.appendChild(s);
  }));
  assert.deepEqual(r, { ok: true, revoke: true, has: true });
});

test('real sign-in with your own Client ID', t => {
  if (!process.env.GOOGLE_CLIENT_ID) return t.skip('No GOOGLE_CLIENT_ID given. A real sign-in also needs a person to accept Google\'s consent screen, so it is checked by hand: Settings → Calendar connections → Connect Google Calendar.');
  t.skip('GOOGLE_CLIENT_ID is set, but the consent screen needs a person. Open the site and click Connect Google Calendar.');
});

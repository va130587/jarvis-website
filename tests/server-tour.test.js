// First-run tour (server): remembered per account in the database; people who already had an account are not shown it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
test.after(closeAll);

test('a new account has not seen the tour; marking it done is remembered for that account only', async () => {
  const s = await boot({ NOVA_TOUR: 'on' }); const a = s.client(), b = s.client();
  await a.login('roshan@example.com'); await b.login('mallory@example.com');
  assert.equal((await a.get('/api/session')).json.tour, true);
  assert.equal((await a.get('/api/profile')).json.user.tourSeen, false);
  const r = await a.req('PATCH', '/api/profile', { tour: 'done' }); assert.equal(r.status, 200); assert.equal(r.json.user.tourSeen, true);
  assert.equal((await a.get('/api/profile')).json.user.tourSeen, true);
  assert.equal((await b.get('/api/profile')).json.user.tourSeen, false, 'another account is not affected');
  assert.ok(s.app.db.prepare("SELECT tour_done_at FROM users WHERE email = 'roshan@example.com'").get().tour_done_at > 0);
});

test('only "done" is accepted, and the tour can be switched off for the whole server', async () => {
  const s = await boot({ NOVA_TOUR: 'off' }); const a = s.client(); await a.login('roshan@example.com');
  assert.equal((await a.get('/api/session')).json.tour, false);
  for (const bad of ['again', true, 1, null, {}]) { const r = await a.req('PATCH', '/api/profile', { tour: bad }); assert.equal(r.status, 400, JSON.stringify(bad)); assert.match(r.json.error.message, /marked as finished/); }
  assert.equal((await a.get('/api/profile')).json.user.tourSeen, false);
});

test('people who already had an account when this was added are marked as done', async () => {
  const os = require('os'), path = require('path'), fs = require('fs'), { DatabaseSync } = require('node:sqlite');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-tour-')), 't.db');
  const first = await boot({ NOVA_DB: file }); first.client(); await first.client().login('roshan@example.com');
  const raw = new DatabaseSync(file); raw.exec('ALTER TABLE users DROP COLUMN tour_done_at'); raw.exec('ALTER TABLE users DROP COLUMN demo_steps'); raw.exec('DROP TABLE energy_marks'); raw.exec('ALTER TABLE users DROP COLUMN energy_plan'); raw.exec('UPDATE schema_version SET v = 8'); raw.close();     // as it was before the tour existed
  await first.close();
  const second = await boot({ NOVA_DB: file }); const c = second.client(); await c.login('roshan@example.com');
  assert.equal((await c.get('/api/profile')).json.user.tourSeen, true);
});

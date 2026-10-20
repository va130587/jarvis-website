// Notifications: always stored in NOVA (the bell, and browser pop-ups while NOVA is open); optionally pushed to a phone through ntfy (free).
// The ntfy topic comes only from the environment, is never returned by the API and never written to logs.
'use strict';

function createNotifier(cfg, db, deps) {
  const now = cfg.now, doFetch = (deps && deps.fetch) || fetch;
  const pushOn = () => !!cfg.ntfy.topic;

  async function push(title, body, o) {
    if (!pushOn()) return 'off';
    try {
      const h = { Title: ascii(title), Tags: o.tags || 'bell', Priority: o.priority || 'default' };
      if (o.click) h.Click = o.click;
      if (cfg.ntfy.token) h.Authorization = 'Bearer ' + cfg.ntfy.token;
      const r = await doFetch(cfg.ntfy.url + '/' + encodeURIComponent(cfg.ntfy.topic), { method: 'POST', headers: h, body: String(body).slice(0, 3500), signal: AbortSignal.timeout(8000) });
      return r.ok ? 'sent' : 'failed: HTTP ' + r.status;
    } catch (e) { return 'failed: ' + (e && e.name === 'TimeoutError' ? 'timeout' : 'network'); }
  }
  // HTTP header values must be plain ASCII; ntfy shows the body in full UTF-8 anyway.
  const ascii = s => String(s).normalize('NFKD').replace(/[^\x20-\x7e]/g, '').slice(0, 120) || 'NOVA';

  // Returns the stored notification, or null when one with the same `dedupe` key already exists (so a retried job never notifies twice).
  async function notify(userId, n) {
    const r = db.prepare('INSERT OR IGNORE INTO notifications (user_id, kind, title, body, link, dedupe, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, n.kind, n.title.slice(0, 160), n.body.slice(0, 4000), n.link || null, n.dedupe || null, now());
    if (!r.changes) return null;
    const id = Number(r.lastInsertRowid);
    if (n.push !== false) {
      const st = await push(n.title, n.body, { tags: n.tags, priority: n.priority, click: cfg.baseUrl ? cfg.baseUrl + '/' + (n.link || '') : null });
      db.prepare('UPDATE notifications SET push = ? WHERE id = ?').run(st, id);
    }
    return view(db.prepare('SELECT * FROM notifications WHERE id = ?').get(id));
  }
  const view = r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, push: r.push, at: r.created_at, read: !!r.read_at });

  function register(router) {
    router.get('/api/notifications', ctx => {
      const after = +ctx.url.searchParams.get('after') || 0, uid = ctx.auth.user.id;
      const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? AND id > ? ORDER BY id DESC LIMIT 40').all(uid, after);
      const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(uid).n;
      return { status: 200, body: { notifications: rows.map(view), unread, push: { ntfy: pushOn() } } };
    });
    router.post('/api/notifications/:id/read', ctx => {
      db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL').run(now(), +ctx.params.id, ctx.auth.user.id);
      return { status: 200, body: { ok: true } };
    });
    router.post('/api/notifications/read-all', ctx => {
      const r = db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), ctx.auth.user.id);
      return { status: 200, body: { ok: true, marked: Number(r.changes) } };
    });
    router.post('/api/notifications/test', async ctx => {
      const n = await notify(ctx.auth.user.id, { kind: 'test', title: 'NOVA test notification', body: 'If you can read this, notifications reach you.' + (pushOn() ? ' It was also sent to your phone topic.' : ''), link: '#automation', dedupe: 'test-' + now() });
      return { status: 200, body: { notification: n } };
    });
  }
  return { notify, register, pushOn };
}
module.exports = { createNotifier };

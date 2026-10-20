// The scheduler: runs each person's daily jobs at a Dubai time, even with the browser closed, as long as the NOVA server is running.
// Guarantees (all tested with a fake clock):
//  - no duplicates: a run is keyed by (schedule, due time) in the database, and every hand-over is an atomic compare-and-set, so two ticks
//    or two server processes cannot both run the same occurrence;
//  - retries: a failed job is retried up to 3 attempts with back-off (1, 5, 15 minutes), then marked failed and you are told;
//  - missed runs (server was off) are collapsed into ONE run that says how many were missed, instead of a burst of old briefings;
//  - a run stuck in "running" (process crashed) is picked up again after 10 minutes and counts as an attempt.
'use strict';
const { nextRun, hhmm, describe, label, validDays } = require('./clock');
const { HttpError } = require('../http');
const { audit } = require('../security');

const BACKOFF = [60e3, 5 * 60e3, 15 * 60e3], MAX_ATTEMPTS = 3, STUCK_MS = 10 * 60e3, JOB_TIMEOUT_MS = 60e3;
const KINDS = {
  briefing: { name: 'Daily briefing', description: 'Builds your briefing (overdue, due today, follow-ups, approvals, important e-mail) and notifies you.', hour: 7, minute: 30, days: 'daily', enabled: 1 },
  deadlines: { name: 'Deadline check', description: 'Tells you what is overdue or due tomorrow, only if there is something.', hour: 17, minute: 0, days: 'daily', enabled: 1 },
  followups: { name: 'Follow-up nudges', description: 'Reminds you to chase things people owe you once their follow-up date arrives. It never contacts anyone.', hour: 10, minute: 0, days: 'weekdays', enabled: 1 },
  email: { name: 'E-mail check', description: 'Reads new Gmail messages (read-only), sorts them and tells you about critical ones. Skipped when Gmail is not connected.', hour: 8, minute: 0, days: 'daily', enabled: 1 }
};

function createScheduler(cfg, db, jobs) {
  const now = cfg.now;
  let timer = null, busy = null;

  function ensureDefaults(userId) {
    const t = now();
    for (const [kind, d] of Object.entries(KINDS))
      db.prepare('INSERT OR IGNORE INTO schedules (user_id, kind, hour, minute, days, enabled, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(userId, kind, d.hour, d.minute, d.days, d.enabled, nextRun(t, d.hour, d.minute, d.days), t, t);
  }

  // One pass: queue due occurrences, then execute queued runs whose time has come. Safe to call at any time and concurrently.
  function tick() {
    if (busy) return busy;
    const p = (async () => {
      {
        const t = now();
        for (const u of db.prepare('SELECT id FROM users').all()) ensureDefaults(u.id);
        for (const s of db.prepare('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at <= ?').all(t)) {
          let due = s.next_run_at, missed = 0;
          for (let n = nextRun(due, s.hour, s.minute, s.days), i = 0; n <= t && i < 1000; n = nextRun(n, s.hour, s.minute, s.days), i++) { due = n; missed++; }
          const claimed = db.prepare('UPDATE schedules SET next_run_at = ?, last_run_at = ?, updated_at = ? WHERE id = ? AND next_run_at = ?').run(nextRun(t, s.hour, s.minute, s.days), t, t, s.id, s.next_run_at).changes;
          if (!claimed) continue;                                                     // another tick or process took it
          db.prepare("INSERT OR IGNORE INTO schedule_runs (schedule_id, user_id, kind, due_at, trigger, status, missed) VALUES (?, ?, ?, ?, 'schedule', 'pending', ?)").run(s.id, s.user_id, s.kind, due, missed);
        }
        db.prepare("UPDATE schedule_runs SET status = 'retrying', next_attempt_at = ?, error = 'The previous attempt did not finish (the server may have stopped).' WHERE status = 'running' AND started_at < ? AND attempts < ?").run(t, t - STUCK_MS, MAX_ATTEMPTS);
        db.prepare("UPDATE schedule_runs SET status = 'failed', finished_at = ?, error = 'The job stopped responding on every attempt.' WHERE status = 'running' AND started_at < ? AND attempts >= ?").run(t, t - STUCK_MS, MAX_ATTEMPTS);
        for (const r of db.prepare("SELECT * FROM schedule_runs WHERE status IN ('pending', 'retrying') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY id").all(t)) await execute(r);
        if (jobs.everyTick) await jobs.everyTick().catch(e => console.error('[nova] reminder delivery failed: ' + String(e && e.message).slice(0, 200)));
      }
    })();
    busy = p.finally(() => { busy = null; });         // reset after the whole pass (also when it finished without awaiting anything)
    return busy;
  }

  async function execute(r) {
    const t = now();
    const claimed = db.prepare("UPDATE schedule_runs SET status = 'running', attempts = attempts + 1, started_at = ? WHERE id = ? AND status = ?").run(t, r.id, r.status).changes;
    if (!claimed) return null;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.user_id), job = jobs[r.kind];
    const run = db.prepare('SELECT * FROM schedule_runs WHERE id = ?').get(r.id);
    try {
      if (!user) throw new Error('The account no longer exists.');
      if (!job) throw new Error('Unknown job ' + r.kind);
      let to;
      const out = await Promise.race([job(user, run), new Promise((_, rej) => { to = setTimeout(() => rej(new Error('The job took longer than ' + JOB_TIMEOUT_MS / 1000 + ' seconds.')), JOB_TIMEOUT_MS); if (to.unref) to.unref(); })]).finally(() => clearTimeout(to));
      const st = out && out.skipped ? 'skipped' : 'succeeded';
      db.prepare('UPDATE schedule_runs SET status = ?, finished_at = ?, summary = ?, error = NULL, next_attempt_at = NULL WHERE id = ?').run(st, now(), String((out && (out.summary || out.skipped)) || 'Done.').slice(0, 500), r.id);
    } catch (e) {
      const msg = String(e && e.message || e).slice(0, 300), attempts = run.attempts;
      if (attempts < MAX_ATTEMPTS) db.prepare("UPDATE schedule_runs SET status = 'retrying', error = ?, next_attempt_at = ? WHERE id = ?").run(msg, now() + BACKOFF[attempts - 1], r.id);
      else {
        db.prepare("UPDATE schedule_runs SET status = 'failed', error = ?, finished_at = ?, next_attempt_at = NULL WHERE id = ?").run(msg, now(), r.id);
        if (user && jobs.onFailure) await jobs.onFailure(user, run, msg).catch(() => {});
      }
    }
    return runView(db.prepare('SELECT * FROM schedule_runs WHERE id = ?').get(r.id));
  }

  const runView = r => ({ id: r.id, kind: r.kind, name: (KINDS[r.kind] || {}).name || r.kind, dueAt: r.due_at, trigger: r.trigger, status: r.status, attempts: r.attempts, missed: r.missed,
    nextAttemptAt: r.next_attempt_at, startedAt: r.started_at, finishedAt: r.finished_at, durationMs: r.finished_at && r.started_at ? r.finished_at - r.started_at : null, error: r.error, summary: r.summary });
  const view = s => {
    const last = db.prepare('SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY id DESC LIMIT 1').get(s.id);
    return { id: s.id, kind: s.kind, name: KINDS[s.kind].name, description: KINDS[s.kind].description, time: hhmm(s.hour, s.minute), days: s.days, daysLabel: describe(s.days), enabled: !!s.enabled,
      nextRunAt: s.enabled ? s.next_run_at : null, nextRunLabel: s.enabled ? label(s.next_run_at) + ' (Dubai)' : 'Off', lastRun: last ? runView(last) : null };
  };
  const own = (userId, id) => { const s = db.prepare('SELECT * FROM schedules WHERE id = ? AND user_id = ?').get(id, userId); if (!s) throw new HttpError(404, 'Schedule not found.', 'not_found'); return s; };

  async function runNow(userId, id) {
    const s = own(userId, id), t = now();
    const r = db.prepare("INSERT INTO schedule_runs (schedule_id, user_id, kind, due_at, trigger, status) VALUES (?, ?, ?, ?, 'manual', 'pending')").run(s.id, userId, s.kind, -t - Math.floor(Math.random() * 1000));   // manual runs never collide with scheduled ones
    return execute(db.prepare('SELECT * FROM schedule_runs WHERE id = ?').get(Number(r.lastInsertRowid)));
  }

  function register(router) {
    router.get('/api/schedules', ctx => {
      ensureDefaults(ctx.auth.user.id);
      const uid = ctx.auth.user.id;
      return { status: 200, body: { schedules: db.prepare('SELECT * FROM schedules WHERE user_id = ? ORDER BY id').all(uid).map(view),
        runs: db.prepare('SELECT * FROM schedule_runs WHERE user_id = ? ORDER BY id DESC LIMIT 25').all(uid).map(runView),
        scheduler: { running: !!timer, intervalSeconds: Math.round(cfg.scheduler.intervalMs / 1000), timeZone: 'Asia/Dubai (UTC+4, no daylight saving)' }, now: now() } };
    });
    router.patch('/api/schedules/:id', ctx => {
      const s = own(ctx.auth.user.id, +ctx.params.id), b = ctx.body, t = now();
      let { hour, minute, days, enabled } = s;
      if (b.enabled !== undefined) { if (typeof b.enabled !== 'boolean') throw new HttpError(400, 'enabled must be true or false.', 'invalid'); enabled = b.enabled ? 1 : 0; }
      if (b.time !== undefined) { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(b.time)); if (!m) throw new HttpError(400, 'time must be HH:MM (24-hour, Dubai time).', 'invalid'); hour = +m[1]; minute = +m[2]; }
      if (b.days !== undefined) { if (!validDays(b.days)) throw new HttpError(400, 'days must be daily, weekdays, weekends or a list like 1,3,5 (0 = Sunday).', 'invalid'); days = String(b.days); }
      db.prepare('UPDATE schedules SET hour = ?, minute = ?, days = ?, enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?').run(hour, minute, days, enabled, nextRun(t, hour, minute, days), t, s.id);
      audit(db, now, ctx.auth.user.id, 'schedule_updated', s.kind + ' ' + hhmm(hour, minute) + ' ' + days + (enabled ? ' on' : ' off'), ctx.req.socket.remoteAddress);
      return { status: 200, body: { schedule: view(db.prepare('SELECT * FROM schedules WHERE id = ?').get(s.id)) } };
    });
    router.post('/api/schedules/:id/run', async ctx => {
      const run = await runNow(ctx.auth.user.id, +ctx.params.id);
      audit(db, now, ctx.auth.user.id, 'schedule_run_now', run.kind + ' -> ' + run.status, ctx.req.socket.remoteAddress);
      return { status: 200, body: { run } };
    });
  }

  function start() {
    if (timer || !cfg.scheduler.enabled) return;
    timer = setInterval(() => { tick().catch(e => console.error('[nova] scheduler tick failed: ' + String(e && e.message).slice(0, 200))); }, cfg.scheduler.intervalMs);
    timer.unref();
  }
  function stop() { clearInterval(timer); timer = null; }
  return { tick, runNow, ensureDefaults, register, start, stop, KINDS };
}
module.exports = { createScheduler, KINDS, BACKOFF, MAX_ATTEMPTS };

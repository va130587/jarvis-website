// Day Replay: what NOVA did on one day, in order, from the records it already keeps (run steps, ProofLoop moves, notifications,
// focus sessions, scheduled jobs, the audit log). Read-only: nothing here writes. Dubai days. Only the signed-in user's own rows.
'use strict';
const { HttpError } = require('./http');
const { LABEL } = require('./proofloop/machine');

const DAY = 86400e3, OFFSET = 4 * 3600e3, CAP = 500;
const dayStart = iso => Date.parse(iso + 'T00:00:00+04:00');
const hhmmss = ms => new Date(ms + OFFSET).toISOString().slice(11, 19);
const dubaiDay = ms => new Date(ms + OFFSET).toISOString().slice(0, 10);
const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// run_steps kinds worth showing, with a plain label (the others, like "plan" and "tool_call", are internal detail)
const STEP = {
  request: ['You asked', 'asked'], approval_requested: ['Preview shown, waiting for you', 'preview'], approval_granted: ['You approved', 'approved'],
  approval_rejected: ['You rejected', 'rejected'], verified: ['Result checked', 'verified'], error: ['Something went wrong', 'problem'], cancelled: ['Cancelled', 'rejected'], proofloop: ['ProofLoop', 'proof']
};
// audit actions that tell the story of the day; everything else stays in Security and Settings
const AUDIT = { login: 'You signed in', logout: 'You signed out', memory_added: 'A memory was saved', memory_approved: 'You approved a memory', memory_corrected: 'A memory was corrected', profile_updated: 'Your profile was changed',
  kb_document_added: 'A document was added to the Knowledge Base', kb_document_deleted: 'A document was deleted', email_demo_loaded: 'Demo e-mail loaded', email_draft_created: 'A reply draft was written (never sent)',
  email_send_refused: 'NOVA refused to send e-mail (read-only access)', email_tracked: 'An e-mail promise was tracked in ProofLoop', gmail_connected: 'Gmail was connected (read-only)', gmail_disconnected: 'Gmail was disconnected',
  reminder_created: 'A reminder was set', schedule_updated: 'A scheduled job was changed', schedule_run_now: 'You ran a job by hand', day_plan_saved: 'A day plan was saved', briefing_created: 'A daily briefing was made',
  voice_approval: 'You approved by voice', voice_approval_refused: 'A spoken approval was refused (needs a button)', sessions_revoked: 'Other devices were signed out', demo_loaded: 'Demo data was loaded', demo_reset: 'Demo data was reset' };

function createReplay(cfg, db, { now }) {
  function replay(userId, day) {
    const t0 = dayStart(day), t1 = t0 + DAY, ev = [];
    const add = (ts, group, title, detail, link, id) => { if (ts >= t0 && ts < t1) ev.push({ ts, at: hhmmss(ts), group, title, detail: detail ? clip(detail, 200) : '', link: link || null, key: id }); };

    for (const s of db.prepare('SELECT id, run_id, kind, summary, ts FROM run_steps WHERE user_id = ? AND ts >= ? AND ts < ? AND kind IN (' + Object.keys(STEP).map(() => '?').join(',') + ') ORDER BY ts, id').all(userId, t0, t1, ...Object.keys(STEP)))
      add(s.ts, STEP[s.kind][1], STEP[s.kind][0], s.summary, s.kind === 'proofloop' ? '#proofloop' : '#chat', 'step' + s.id);
    for (const e of db.prepare('SELECT e.id, e.ts, e.from_status, e.to_status, e.note, e.actor, c.title FROM commitment_events e JOIN commitments c ON c.id = e.commitment_id WHERE e.user_id = ? AND e.ts >= ? AND e.ts < ?').all(userId, t0, t1))
      add(e.ts, 'proof', 'ProofLoop: ' + (LABEL[e.to_status] || e.to_status), e.title + (e.note ? ' · ' + e.note : ''), '#proofloop', 'ce' + e.id);
    for (const n of db.prepare('SELECT id, title, body, link, created_at FROM notifications WHERE user_id = ? AND created_at >= ? AND created_at < ?').all(userId, t0, t1))
      add(n.created_at, 'notice', 'NOVA told you: ' + clip(n.title, 90), n.body, n.link, 'n' + n.id);
    for (const f of db.prepare('SELECT id, title, planned_min, started_at, ended_at, status FROM focus_sessions WHERE user_id = ? AND ((started_at >= ? AND started_at < ?) OR (ended_at >= ? AND ended_at < ?))').all(userId, t0, t1, t0, t1)) {
      add(f.started_at, 'focus', 'Focus started', clip(f.title, 100) + ' · ' + f.planned_min + ' min', '#focus', 'fs' + f.id);
      if (f.ended_at) add(f.ended_at, 'focus', f.status === 'completed' ? 'Focus finished' : 'Focus stopped', clip(f.title, 100), '#focus', 'fe' + f.id);
    }
    for (const r of db.prepare('SELECT id, kind, status, trigger, finished_at, started_at, summary, error FROM schedule_runs WHERE user_id = ? AND COALESCE(finished_at, started_at) >= ? AND COALESCE(finished_at, started_at) < ?').all(userId, t0, t1))
      add(r.finished_at || r.started_at, 'job', 'Scheduled job: ' + r.kind.replace(/_/g, ' ') + ' (' + r.status + ')', r.error || r.summary, '#automation', 'sr' + r.id);
    for (const a of db.prepare('SELECT id, ts, action, detail FROM audit_log WHERE user_id = ? AND ts >= ? AND ts < ?').all(userId, t0, t1))
      if (AUDIT[a.action]) add(a.ts, 'security', AUDIT[a.action], a.action.startsWith('login') || a.action === 'logout' ? '' : a.detail, '#security', 'au' + a.id);

    ev.sort((a, b) => a.ts - b.ts || String(a.key).localeCompare(String(b.key)));
    const total = ev.length, shown = ev.slice(0, CAP);
    const hours = Array(24).fill(0); for (const e of ev) hours[Math.floor((e.ts - t0) / 3600e3)]++;
    return { day, today: dubaiDay(now()), total, truncated: total > CAP, events: shown.map(({ key, ...e }) => e), hours, first: total ? ev[0].at : null, last: total ? ev[total - 1].at : null };
  }
  function register(router) {
    router.get('/api/replay', ctx => {
      const q = ctx.url.searchParams.get('day') || dubaiDay(now());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(q) || isNaN(Date.parse(q + 'T00:00:00Z')) || new Date(q + 'T00:00:00Z').toISOString().slice(0, 10) !== q) throw new HttpError(400, 'Pick a day as a date, for example 2026-10-21.', 'invalid');
      if (q > dubaiDay(now() + DAY) || q < '2020-01-01') throw new HttpError(400, 'Pick a day from 2020 up to today.', 'invalid');
      return { status: 200, body: replay(ctx.auth.user.id, q) };
    });
  }
  return { replay, register };
}
module.exports = { createReplay };

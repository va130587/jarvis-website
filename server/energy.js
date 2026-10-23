// Energy marks: one tap (high, medium or low) at three points of the day, kept in my own account. After 7 days with at least one mark NOVA shows my
// own pattern ("You usually mark high energy in the morning (6 of 8 days)") and the planner may put hard tasks (60 minutes or more) in those hours.
// Energy is never guessed from anything else. With less than 7 days of marks NOVA says so and the planner does nothing different.
'use strict';
const { HttpError, oneOf } = require('./http');
const { audit } = require('./security');
const { parts } = require('./daily/clock');

const SLOTS = [
  { id: 'morning', label: 'Morning', from: 9 * 60, to: 12 * 60, window: '09:00 to 12:00' },
  { id: 'afternoon', label: 'Afternoon', from: 12 * 60, to: 17 * 60, window: '12:00 to 17:00' },
  { id: 'evening', label: 'Evening', from: 17 * 60, to: 18 * 60, window: '17:00 to 18:00' }
];
const LEVELS = ['high', 'medium', 'low'], MIN_DAYS = 7, MIN_MARKS = 4, HIGH_SHARE = 0.5;
const RULE = 'A pattern needs marks on at least ' + MIN_DAYS + ' different days. A part of the day counts as "usually high" when it was marked high on at least half of its marked days, and at least ' + MIN_MARKS + ' days were marked.';

function createEnergy(cfg, db) {
  const now = cfg.now, today = () => parts(now()).iso;
  function state(userId) {
    const rows = db.prepare('SELECT day, slot, level FROM energy_marks WHERE user_id = ?').all(userId), t = today();
    const days = new Set(rows.map(r => r.day)).size, ready = days >= MIN_DAYS;
    const pattern = SLOTS.map(s => { const m = rows.filter(r => r.slot === s.id), high = m.filter(r => r.level === 'high').length; return { slot: s.id, label: s.label, high, total: m.length, usuallyHigh: ready && m.length >= MIN_MARKS && high / m.length >= HIGH_SHARE }; });
    const highSlots = pattern.filter(p => p.usuallyHigh).map(p => p.slot);
    const on = !!(db.prepare('SELECT energy_plan FROM users WHERE id = ?').get(userId) || {}).energy_plan;
    const names = pattern.filter(p => p.usuallyHigh).map(p => p.label.toLowerCase() + ' (' + p.high + ' of ' + p.total + ' days)');
    const summary = !ready ? 'Not enough data yet: ' + days + ' of ' + MIN_DAYS + ' days marked. Mark your energy each day and your own pattern appears after ' + MIN_DAYS + ' days.'
      : highSlots.length ? 'You usually mark high energy in the ' + names.join(' and in the ') + '.' : 'No part of the day is usually high for you yet.';
    return { today: t, slots: SLOTS.map(s => ({ id: s.id, label: s.label, window: s.window, level: (rows.find(r => r.day === t && r.slot === s.id) || {}).level || null })), levels: LEVELS,
      days, minDays: MIN_DAYS, ready, pattern, highSlots, summary, rule: RULE, plan: { on: on && ready && highSlots.length > 0, wanted: on, available: ready && highSlots.length > 0,
        note: !ready ? 'Needs ' + MIN_DAYS + ' days of marks first, so nothing changes yet.' : !highSlots.length ? 'No usual high-energy time found yet, so nothing changes.' : on ? 'Hard tasks (60 minutes or more) go in your high-energy time when they fit. Urgent items still come first.' : 'Off. The planner ignores your energy.' } };
  }
  // The windows (in minutes from midnight) the planner may use, or null when the switch is off or there is not enough data.
  function windows(userId) {
    const st = state(userId); if (!st.plan.on) return null;
    return SLOTS.filter(s => st.highSlots.includes(s.id)).map(s => [s.from, s.to]);
  }
  function register(router) {
    router.get('/api/energy', ctx => ({ status: 200, body: state(ctx.auth.user.id) }));
    router.post('/api/energy', ctx => {
      const slot = oneOf(ctx.body.slot, 'slot', SLOTS.map(s => s.id)), uid = ctx.auth.user.id;
      if (ctx.body.level === null) db.prepare('DELETE FROM energy_marks WHERE user_id = ? AND day = ? AND slot = ?').run(uid, today(), slot);
      else { const level = oneOf(ctx.body.level, 'level', LEVELS); db.prepare('INSERT INTO energy_marks (user_id, day, slot, level, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, day, slot) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at').run(uid, today(), slot, level, now()); }
      audit(db, now, uid, 'energy_marked', slot + ' ' + (ctx.body.level === null ? 'cleared' : ctx.body.level), ctx.req.socket.remoteAddress);
      return { status: 200, body: state(uid) };
    });
    router.post('/api/energy/plan', ctx => {
      if (typeof ctx.body.on !== 'boolean') throw new HttpError(400, 'Choose whether the planner should use your energy pattern: on or off.', 'invalid');
      const uid = ctx.auth.user.id, st = state(uid);
      if (ctx.body.on && !st.plan.available) throw new HttpError(409, st.ready ? 'No usual high-energy time was found yet, so there is nothing to use. Nothing changed.' : 'Not enough data yet: mark your energy on ' + MIN_DAYS + ' different days first. Nothing changed.', 'not_enough_data');
      db.prepare('UPDATE users SET energy_plan = ? WHERE id = ?').run(ctx.body.on ? 1 : 0, uid);
      audit(db, now, uid, 'energy_plan', ctx.body.on ? 'on' : 'off', ctx.req.socket.remoteAddress);
      return { status: 200, body: state(uid) };
    });
  }
  return { state, windows, register, SLOTS, MIN_DAYS };
}
module.exports = { createEnergy, SLOTS };

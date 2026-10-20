// Life tracker: time and money parsing, reminders delivered by the scheduler (fake clock), habits and streaks, expenses and budgets.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, closeAll } = require('./server-helpers');
const { parseWhen, parseMoney, categorize, clock } = require('../server/life');
test.after(closeAll);
const at = iso => Date.parse(iso + '+04:00');
async function setup(t) { const k = { t, now: () => k.t }; const s = await boot({}, { now: k.now }); const c = s.client(); await c.login('roshan@example.com'); return { s, c, k }; }
const MIN = 60e3;

test('time phrases in Dubai time: relative, clock, parts of day, weekdays, repeats; unclear times are refused', () => {
  const now = at('2026-10-19T08:00:00');                        // Monday 08:00
  const W = s => { const r = parseWhen(s, now); return r && new Date(r.dueAt + 4 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + (r.repeat !== 'none' ? ' ' + r.repeat : ''); };
  assert.equal(W('in 20 minutes'), '2026-10-19 08:20'); assert.equal(W('in an hour'), '2026-10-19 09:00'); assert.equal(W('in half an hour'), '2026-10-19 08:30'); assert.equal(W('in 2 hrs'), '2026-10-19 10:00');
  assert.equal(W('at 6pm'), '2026-10-19 18:00'); assert.equal(W('at 18:30'), '2026-10-19 18:30'); assert.equal(W('at 6'), '2026-10-19 18:00', '"at 6" means the evening');
  assert.equal(W('at 7am'), '2026-10-20 07:00', 'already passed today -> tomorrow'); assert.equal(W('at noon'), '2026-10-19 12:00');
  assert.equal(W('tonight'), '2026-10-19 21:00'); assert.equal(W('tomorrow at 9'), '2026-10-20 09:00'); assert.equal(W('tomorrow at 9am'), '2026-10-20 09:00'); assert.equal(W('tomorrow morning'), '2026-10-20 09:00');
  assert.equal(W('friday at 10am'), '2026-10-23 10:00'); assert.equal(W('on monday at 7am'), '2026-10-26 07:00', 'today\'s time passed -> next week');
  assert.equal(W('every day at 8'), '2026-10-20 08:00 daily', '8 means 8 am, and 08:00 today has just passed'); assert.equal(W('every weekday at 7:30am'), '2026-10-20 07:30 weekdays');
  assert.equal(W('every weekday at 7:30am').length > 0, true);
  const fri = at('2026-10-23T09:00:00'); const r = parseWhen('every weekday at 7:30am', fri); assert.equal(new Date(r.dueAt + 4 * 3600e3).toISOString().slice(0, 10), '2026-10-26', 'Friday after 7:30 -> Monday');
  for (const bad of ['someday', 'at 25:00', 'at 13pm', 'in 0 minutes', 'in 99999 minutes', 'later', 'at teatime']) assert.equal(parseWhen(bad, now), null, bad);
  assert.equal(clock('12am'), 0); assert.equal(clock('12pm'), 720);
});

test('money and categories', () => {
  assert.equal(parseMoney('45'), 4500); assert.equal(parseMoney('45.5'), 4550); assert.equal(parseMoney('AED 1,25'), 125); assert.equal(parseMoney('30 dirhams'), 3000); assert.equal(parseMoney('12dhs'), 1200);
  for (const bad of ['', 'free', '-5', '0', '99999999']) assert.equal(parseMoney(bad), null, bad);
  assert.equal(categorize('lunch at the cafe'), 'food'); assert.equal(categorize('Careem to work'), 'transport'); assert.equal(categorize('Carrefour'), 'groceries'); assert.equal(categorize('DEWA bill'), 'bills'); assert.equal(categorize('mystery'), 'other');
});

test('reminders: set by sentence with approval, delivered once by the scheduler, repeats, late notice, cancel, snooze, private', async () => {
  const { s, c, k } = await setup(at('2026-10-19T08:00:00'));
  const say = async m => { const r = (await c.post('/api/chat', { message: m })).json; return r.run && r.run.pendingApproval ? (await c.post('/api/approvals/' + r.run.pendingApproval.id + '/approve')).json : r; };
  let r = (await c.post('/api/chat', { message: 'remind me in 20 minutes to check the oven' })).json;
  assert.equal(r.status, 'awaiting_approval'); assert.match(r.run.pendingApproval.preview.changes[0], /Remind you "check the oven" at Mon 19 Oct, 08:20 \(Dubai\)/);
  assert.equal(r.run.pendingApproval.voiceOk, true, 'small and undoable, so it can be approved by voice');
  assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM reminders').get().n, 0, 'nothing until approved');
  const a = (await c.post('/api/approvals/' + r.run.pendingApproval.id + '/approve')).json; assert.match(a.result, /Read back from the database: reminder #1 is scheduled/);
  await say('remind me every weekday at 7:30am to take vitamins');
  assert.match((await say('remind me at 25:00 to x')).reply, /could not understand the time "at 25:00"/);
  r = await say('remind me to submit the report tomorrow'); assert.match(r.result, /Created the task "submit the report" \(due 2026-10-20\)/, 'a date only stays a task');
  const notes = async () => (await c.get('/api/notifications')).json.notifications.filter(n => n.kind === 'reminder').map(n => n.title + ' | ' + n.body);
  k.t = at('2026-10-19T08:19:00'); await s.app.scheduler.tick(); assert.deepEqual(await notes(), []);
  k.t = at('2026-10-19T08:20:10'); await Promise.all([s.app.scheduler.tick(), s.app.life.deliver()]); await s.app.scheduler.tick();
  let n = await notes(); assert.equal(n.length, 1); assert.match(n[0], /^Reminder: check the oven \| Set by you/);
  assert.equal((await c.get('/api/life')).json.reminders.find(x => x.text === 'check the oven').status, 'sent');
  // weekday repeat: Tue 07:30 fires, next is Wed; Fri -> Mon; late delivery says so
  k.t = at('2026-10-20T07:31:00'); await c.login('roshan@example.com'); await s.app.scheduler.tick();
  let v = (await c.get('/api/life')).json.reminders.find(x => x.text === 'take vitamins'); assert.equal(v.status, 'pending'); assert.equal(v.dueAt, at('2026-10-21T07:30:00'));
  k.t = at('2026-10-23T07:30:30'); await c.login('roshan@example.com'); await s.app.scheduler.tick();
  v = (await c.get('/api/life')).json.reminders.find(x => x.text === 'take vitamins'); assert.equal(v.dueAt, at('2026-10-26T07:30:00'), 'Friday -> Monday');
  n = await notes(); assert.ok(n.some(x => /This was due Wed 21 Oct/.test(x)), 'missed while off: delivered late, and it says so');
  // API: create with "when", cancel, snooze; validation; private
  const made = (await c.post('/api/reminders', { text: 'water the plants', when: 'in 5 minutes' })).json.reminder;
  assert.equal(made.dueAt, k.t + 5 * MIN);
  assert.equal((await c.post('/api/reminders', { text: 'x', when: 'whenever' })).status, 400);
  assert.equal((await c.post('/api/reminders', { text: 'x', dueAt: k.t - 1 })).status, 400);
  assert.equal((await c.post('/api/reminders/' + made.id + '/cancel')).status, 200); assert.equal((await c.post('/api/reminders/' + made.id + '/cancel')).status, 404);
  assert.equal((await c.post('/api/reminders/1/snooze', { minutes: 10 })).json.reminder.dueAt, k.t + 10 * MIN);
  const m = s.client(); await m.login('mallory@example.com');
  assert.equal((await m.get('/api/life')).json.reminders.length, 0); assert.equal((await m.post('/api/reminders/1/cancel')).status, 404); assert.equal((await m.post('/api/reminders/1/snooze', {})).status, 404);
  await s.close();
});

test('habits: check-ins, streaks (today may still be open), weekday habits skip weekends, best streak, 13-week grid, window, voice phrase', async () => {
  const { s, c } = await setup(at('2026-10-23T20:00:00'));             // Friday
  const h = (await c.post('/api/habits', { name: 'Reading' })).json.habit;
  assert.equal((await c.post('/api/habits', { name: 'reading' })).status, 409);
  for (const d of ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-21', '2026-10-22']) await c.post('/api/habits/' + h.id + '/check', { day: d });
  let st = (await c.get('/api/life')).json.habits[0];
  assert.equal(st.streak, 2, 'Wed + Thu (today still open)'); assert.equal(st.best, 3); assert.equal(st.doneToday, false);
  assert.equal(st.grid[st.grid.length - 1].day, '2026-10-23'); assert.equal(new Date(st.grid[0].day + 'T12:00:00Z').getUTCDay(), 1, 'grid starts on a Monday');
  const r = (await c.post('/api/chat', { message: 'check in reading' })).json;
  const done = (await c.post('/api/approvals/' + r.run.pendingApproval.id + '/approve')).json; assert.match(done.result, /Checked in "Reading"\. Streak: 3 days/);
  assert.equal((await c.post('/api/habits/' + h.id + '/check', { day: '2026-10-01' })).status, 400, 'only the last 6 days');
  assert.equal((await c.post('/api/habits/' + h.id + '/check', { day: '2026-10-24' })).status, 400, 'not the future');
  const g = (await c.post('/api/habits', { name: 'Gym', schedule: 'weekdays' })).json.habit;
  for (const d of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) await c.post('/api/habits/' + g.id + '/check', { day: d });
  s.app.db.prepare("INSERT INTO habit_checks (habit_id, user_id, day, created_at) VALUES (?, 1, '2026-10-16', 1)").run(g.id);     // older history (the API only allows the last 6 days)
  st = (await c.get('/api/life')).json.habits.find(x => x.name === 'Gym'); assert.equal(st.streak, 6, 'the weekend does not break a weekday habit');
  assert.match((await c.post('/api/chat', { message: 'check in swimming' })).json.reply, /could not find a habit called "swimming"\. Your habits: Reading, Gym/);
  await c.post('/api/habits/' + g.id + '/archive'); assert.equal((await c.get('/api/life')).json.habits.length, 1);
  const m = s.client(); await m.login('mallory@example.com'); assert.equal((await m.post('/api/habits/' + h.id + '/check', {})).status, 404);
  await s.close();
});

test('money: add by sentence or form, automatic category, month summary vs last month, budget alerts once at 80% and 100%, delete, private', async () => {
  const { s, c } = await setup(at('2026-10-15T12:00:00'));
  await c.post('/api/expenses', { amount: '200', note: 'Carrefour', day: '2026-09-10' });
  const r = (await c.post('/api/chat', { message: 'I spent 45.50 AED on lunch with Sara' })).json;
  assert.match(r.run.pendingApproval.preview.changes[0], /Spent AED 45\.50 on lunch with Sara \(category: food\)/);
  await c.post('/api/approvals/' + r.run.pendingApproval.id + '/approve');
  await c.post('/api/expenses', { amount: 30, note: 'Careem' });
  assert.equal((await c.post('/api/expenses', { amount: 'lots' })).status, 400); assert.equal((await c.post('/api/expenses', { amount: 5, category: 'yachts' })).status, 400);
  assert.equal((await c.post('/api/expenses', { amount: 5, day: '2026-10-16' })).status, 400, 'not in the future');
  let m = (await c.get('/api/life')).json.money;
  assert.equal(m.total, 7550); assert.equal(m.totalLabel, 'AED 75.50'); assert.equal(m.prevTotal, 20000);
  assert.deepEqual(m.byCategory.map(x => x.category), ['food', 'transport']);
  assert.match((await c.post('/api/chat', { message: 'how much did I spend this month?' })).json.reply, /This month you spent AED 75\.50, mostly on food \(AED 45\.50\), transport \(AED 30\)\. Last month: AED 200\./);
  // budget alerts
  await c.post('/api/budget', { amount: 100 });
  let b = (await c.get('/api/notifications')).json.notifications.filter(x => x.kind === 'budget'); assert.equal(b.length, 0, '75% is under 80%');
  await c.post('/api/expenses', { amount: 10, note: 'coffee' });
  b = (await c.get('/api/notifications')).json.notifications.filter(x => x.kind === 'budget'); assert.equal(b.length, 1); assert.match(b[0].title, /80% of your 2026-10 budget/);
  await c.post('/api/expenses', { amount: 1, note: 'gum' });
  assert.equal((await c.get('/api/notifications')).json.notifications.filter(x => x.kind === 'budget').length, 1, 'not repeated');
  await c.post('/api/expenses', { amount: 20, note: 'cinema' });
  b = (await c.get('/api/notifications')).json.notifications.filter(x => x.kind === 'budget'); assert.equal(b.length, 2); assert.match(b[0].title, /Budget used up/);
  m = (await c.get('/api/life')).json.money; assert.equal(m.budget.usedPct, 107); assert.equal(m.budget.pacePct, 48);
  const id = m.recent[0].id; assert.equal((await c.del('/api/expenses/' + id)).status, 200); assert.equal((await c.del('/api/expenses/' + id)).status, 404);
  assert.equal((await c.post('/api/budget', { amount: null })).json.budget, null);
  const o = s.client(); await o.login('mallory@example.com');
  assert.equal((await o.get('/api/life')).json.money.total, 0); assert.equal((await o.del('/api/expenses/1')).status, 404);
  await c.post('/api/data/delete', { scope: 'all', confirm: 'DELETE MY DATA' });
  for (const t of ['reminders', 'habits', 'habit_checks', 'expenses', 'budgets']) assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM ' + t + ' WHERE user_id = 1').get().n, 0, t);
  await s.close();
});

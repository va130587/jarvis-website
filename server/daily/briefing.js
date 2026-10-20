// The daily briefing: one short, honest picture of the day built only from NOVA's own data (tasks, ProofLoop commitments,
// waiting approvals and, if connected, e-mail). No AI model is needed, so it costs nothing and works offline.
'use strict';
const { parts, DAY_NAMES, DAY } = require('./clock');
const { LABEL } = require('../proofloop/machine');

const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const addIso = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function relDay(iso, today) {
  if (!iso) return 'no date';
  if (iso === today) return 'today'; if (iso === addIso(today, 1)) return 'tomorrow'; if (iso === addIso(today, -1)) return 'yesterday';
  const diff = Math.round((Date.parse(iso) - Date.parse(today)) / DAY);
  return diff < 0 ? plural(-diff, 'day') + ' late' : DAY_NAMES[new Date(iso + 'T12:00:00Z').getUTCDay()] + (diff > 6 ? ' ' + iso : '');
}

function createBriefing(cfg, db) {
  const now = cfg.now;

  function build(user) {
    const t = now(), p = parts(t), today = p.iso, soon = addIso(today, 3), uid = user.id;
    const tasks = db.prepare("SELECT id, title, due FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = 'open' ORDER BY (due IS NULL), due, id").all(uid);
    const overdueT = tasks.filter(x => x.due && x.due < today), todayT = tasks.filter(x => x.due === today), soonT = tasks.filter(x => x.due && x.due > today && x.due <= soon);
    const doneYesterday = db.prepare("SELECT COUNT(*) n FROM tasks WHERE user_id = ? AND status = 'done' AND completed_at >= ? AND completed_at < ?").get(uid, Date.parse(addIso(today, -1) + 'T00:00:00+04:00'), Date.parse(today + 'T00:00:00+04:00')).n;
    const open = db.prepare("SELECT * FROM commitments WHERE user_id = ? AND status NOT IN ('completed', 'failed', 'cancelled', 'verified')").all(uid);
    const lateC = open.filter(c => c.deadline && c.deadline < today), confirmC = open.filter(c => c.status === 'awaiting_confirmation');
    const followC = open.filter(c => c.direction === 'owed_to_me' && c.follow_up_at && c.follow_up_at <= today && !(c.deadline && c.deadline < today));
    const dueSoonC = open.filter(c => c.direction === 'i_owe' && c.deadline && c.deadline >= today && c.deadline <= soon);
    const approvals = db.prepare("SELECT id, tool, preview FROM approvals WHERE user_id = ? AND status = 'pending' AND expires_at > ? ORDER BY id").all(uid, t);
    const conn = db.prepare("SELECT status FROM connections WHERE user_id = ? AND provider = 'gmail'").get(uid);
    const mails = db.prepare('SELECT * FROM emails WHERE user_id = ? AND received_at >= ? ORDER BY received_at DESC').all(uid, t - 2 * DAY);
    const demo = open.some(c => c.is_demo) || mails.some(m => m.is_demo);

    const sections = [];
    const item = (text, sub, link, tone) => ({ text, sub: sub || '', link: link || '', tone: tone || '' });
    const late = overdueT.map(x => item(x.title, 'Task · ' + relDay(x.due, today), '#hub', 'red')).concat(lateC.map(c => item(c.title, (c.direction === 'i_owe' ? 'You promised' : 'Owed to you') + (c.counterparty ? ' · ' + c.counterparty : '') + ' · ' + relDay(c.deadline, today) + (c.is_demo ? ' · demo' : ''), '#proofloop', 'red')));
    if (late.length) sections.push({ key: 'late', title: 'Overdue', tone: 'red', items: late });
    const todayItems = todayT.map(x => item(x.title, 'Task · due today', '#hub')).concat(dueSoonC.filter(c => c.deadline === today).map(c => item(c.title, 'You promised' + (c.counterparty ? ' ' + c.counterparty : '') + ' · due today', '#proofloop', 'gold')));
    sections.push({ key: 'today', title: 'Due today', tone: '', items: todayItems, empty: 'Nothing is due today.' });
    const soonItems = soonT.map(x => item(x.title, 'Task · ' + relDay(x.due, today), '#hub')).concat(dueSoonC.filter(c => c.deadline > today && c.status !== 'awaiting_confirmation').map(c => item(c.title, 'You promised' + (c.counterparty ? ' ' + c.counterparty : '') + ' · ' + relDay(c.deadline, today), '#proofloop')));
    if (soonItems.length) sections.push({ key: 'soon', title: 'Next three days', tone: '', items: soonItems });
    const chase = followC.map(c => item('Follow up with ' + (c.counterparty || 'them') + ': ' + c.title, 'Owed to you · ' + (c.deadline ? 'due ' + relDay(c.deadline, today) : 'no deadline') + ' · ' + LABEL[c.status] + (c.is_demo ? ' · demo' : ''), '#proofloop', 'gold'))
      .concat(confirmC.map(c => item('Confirm or chase: ' + c.title, 'Waiting for confirmation, NOT verified yet' + (c.is_demo ? ' · demo' : ''), '#proofloop', 'gold')));
    if (chase.length) sections.push({ key: 'chase', title: 'Follow-ups', tone: 'gold', items: chase });
    if (approvals.length) sections.push({ key: 'approvals', title: 'Waiting for your approval', tone: 'gold', items: approvals.map(a => { let pv = {}; try { pv = JSON.parse(a.preview); } catch (e) { /* keep empty */ } return item(pv.action || a.tool, (pv.changes && pv.changes[0]) || '', '#dashboard', 'gold'); }) });
    const imp = mails.filter(m => m.priority === 'critical' || m.priority === 'important'), reply = mails.filter(m => m.category === 'needs_reply'), sus = mails.filter(m => m.priority === 'review');
    const mailDeadlines = mails.filter(m => m.deadline && m.deadline >= today && m.deadline <= soon);
    if (conn || mails.length) {
      const mi = imp.slice(0, 4).map(m => item(m.subject || '(no subject)', (m.from_name || m.from_addr) + ' · ' + (m.priority === 'critical' ? 'Critical' : 'Important') + (m.deadline ? ' · deadline ' + relDay(m.deadline, today) : '') + (m.is_demo ? ' · demo' : ''), '#email', m.priority === 'critical' ? 'red' : 'gold'));
      if (sus.length) mi.push(item(plural(sus.length, 'message') + ' may be phishing', 'Do not click links or share codes until you check them', '#email', 'red'));
      sections.push({ key: 'email', title: 'E-mail (last 48 hours)', tone: '', items: mi, empty: mails.length ? 'Nothing important in the last 48 hours.' : 'No e-mail synced yet.' });
    }

    // The single thing that matters most today, with the reason it was picked.
    let focus = null;
    const iOweLate = lateC.find(c => c.direction === 'i_owe');
    if (iOweLate) focus = { text: iOweLate.title, why: 'You promised this' + (iOweLate.counterparty ? ' to ' + iOweLate.counterparty : '') + ' and it is ' + relDay(iOweLate.deadline, today) + '.', link: '#proofloop' };
    else if (overdueT.length) focus = { text: overdueT[0].title, why: 'Your oldest overdue task (' + relDay(overdueT[0].due, today) + ').', link: '#hub' };
    else if (mails.find(m => m.priority === 'critical')) { const m = mails.find(x => x.priority === 'critical'); focus = { text: 'Reply to ' + (m.from_name || m.from_addr) + ': ' + m.subject, why: m.deadline ? 'It has a deadline ' + relDay(m.deadline, today) + '.' : 'It was marked critical.', link: '#email' }; }
    else if (todayT.length) focus = { text: todayT[0].title, why: 'It is due today.', link: '#hub' };
    else if (dueSoonC.length) focus = { text: dueSoonC[0].title, why: 'You promised it for ' + relDay(dueSoonC[0].deadline, today) + '.', link: '#proofloop' };

    const h = p.h, greeting = (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + ', ' + user.display_name;
    const counts = { overdue: late.length, today: todayItems.length, soon: soonItems.length, followUps: chase.length, approvals: approvals.length, importantEmail: imp.length, needsReply: reply.length, suspicious: sus.length, mailDeadlines: mailDeadlines.length, doneYesterday };
    const bits = [];
    if (counts.overdue) bits.push(plural(counts.overdue, 'overdue item'));
    bits.push(counts.today ? plural(counts.today, 'thing') + ' due today' : 'nothing due today');
    if (counts.followUps) bits.push(plural(counts.followUps, 'follow-up'));
    if (counts.approvals) bits.push(plural(counts.approvals, 'approval') + ' waiting');
    if (counts.importantEmail) bits.push(plural(counts.importantEmail, 'important e-mail'));
    const headline = 'You have ' + bits.slice(0, -1).join(', ') + (bits.length > 1 ? ' and ' : '') + bits[bits.length - 1] + '.';
    const quiet = !counts.overdue && !counts.today && !counts.followUps && !counts.approvals && !counts.importantEmail;
    const spoken = greeting + '. It is ' + DAY_NAMES[p.wd] + '. ' + (quiet ? 'Your day is clear. ' : headline + ' ') + (focus ? 'The most important thing: ' + focus.text + '. ' + focus.why + ' ' : '') +
      (doneYesterday ? 'Yesterday you finished ' + plural(doneYesterday, 'task') + '. ' : '') + (counts.suspicious ? 'Careful: ' + plural(counts.suspicious, 'e-mail') + ' may be phishing.' : '');
    return { day: today, weekday: DAY_NAMES[p.wd], generatedAt: t, greeting, headline: quiet ? 'Your day is clear. Nothing is overdue or due today.' : headline, quiet, focus, sections, counts, spoken: spoken.trim(), demo, gmail: conn ? conn.status : 'not_connected' };
  }

  // Builds, stores and returns a briefing. `trigger`: 'schedule' | 'manual'.
  function create(user, trigger) {
    const b = build(user);
    const r = db.prepare('INSERT INTO briefings (user_id, day, data, trigger, created_at) VALUES (?, ?, ?, ?, ?)').run(user.id, b.day, JSON.stringify(b), trigger, now());
    db.prepare('DELETE FROM briefings WHERE user_id = ? AND id NOT IN (SELECT id FROM briefings WHERE user_id = ? ORDER BY id DESC LIMIT 30)').run(user.id, user.id);
    return Object.assign({ id: Number(r.lastInsertRowid), trigger }, b);
  }
  function latest(userId) { const r = db.prepare('SELECT * FROM briefings WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId); return r ? Object.assign({ id: r.id, trigger: r.trigger }, JSON.parse(r.data)) : null; }
  function history(userId) { return db.prepare('SELECT id, day, trigger, created_at, data FROM briefings WHERE user_id = ? ORDER BY id DESC LIMIT 7').all(userId).map(r => { const d = JSON.parse(r.data); return { id: r.id, day: r.day, trigger: r.trigger, at: r.created_at, headline: d.headline, focus: d.focus && d.focus.text }; }); }

  return { build, create, latest, history };
}
module.exports = { createBriefing, relDay };

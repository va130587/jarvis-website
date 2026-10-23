// Quick capture: type or paste a messy sentence; NOVA splits it into separate proposed changes (task, reminder, note, expense, promise) with the
// free fixed-phrase rules, shows ONE combined preview, and changes nothing until you approve. Each approved item then goes through the SAME agent
// path as everything else (preview record, approval, execution, verification, undo entry), so the Undo list and Day Replay show it.
// It only ever ADDS things: nothing is deleted, forgotten or sent, at most 20 items at once, and pasted text is data, never instructions.
'use strict';
const crypto = require('crypto');
const { HttpError } = require('./http');
const { audit } = require('./security');
const { validate } = require('./agent/schema');
const { matchIntent, parseDue } = require('./agent/planner');
const { parseWhen, parseMoney, categorize, CATEGORIES } = require('./life');
const { parts: dubaiParts } = require('./daily/clock');
const { createTrust } = require('./proofloop/trust');

const ALLOWED = ['tasks.create', 'notes.create', 'reminders.create', 'expenses.add', 'commitments.create'];
const KIND = { 'tasks.create': 'Task', 'notes.create': 'Note', 'reminders.create': 'Reminder', 'expenses.add': 'Expense', 'commitments.create': 'Promise' };
const MAX_ITEMS = 20, MAX_TEXT = 2000, MAX_PART = 300, TTL = 15 * 60e3, MAX_PENDING = 3;
const WEEKDAY = '(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)', DUE_WORD = '(?:today|tomorrow|' + WEEKDAY + '|\\d{4}-\\d{2}-\\d{2})';
const VERBS = new Set(('call phone ring text email e-mail message send reply buy pay book submit finish write prepare renew review check order study read practise practice print sign fill return schedule plan clean fix update ask tell pick get make file collect pack ' +
  'cancel confirm follow upload download backup back organise organize wash cook water charge apply register join visit see meet attend bring take drop clear sort email set').split(' '));
const DESTRUCTIVE = /^(?:please\s+)?(?:delete|remove|erase|wipe|forget|clear all|reset|drop all|destroy)\b/i;
const FILLER = /^(?:(?:and|also|then|plus|please|remember to|don'?t forget to|i need to|i have to|i must|i should|need to|have to|to)\s+)+/i;
const dayName = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const hm = ms => new Date(ms + 4 * 3600e3).toISOString().slice(11, 16);
const aed = f => 'AED ' + (f / 100).toFixed(f % 100 ? 2 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

// ---- splitting ----
// Newlines and semicolons always split. Commas split except inside numbers ("AED 1,200"). "and" splits only before something that starts a new item.
const NEW_ITEM = new RegExp('\\s+and\\s+(?=(?:remind|note|call|email|text|send|buy|pay|book|submit|spent|spend|paid|i\\s|renew|finish|write|prepare|review|check|order|reply|study|read|print|sign|fill|return|schedule|plan|clean|fix|update|aed\\s|\\d+\\s*(?:aed|dirhams?|dhs?)|[A-Z][a-z]+\\s+owes))', 'i');
function split(text) {
  const out = [];
  for (const line of String(text).replace(/\r/g, '').split(/\n+|;/)) {
    const safe = line.replace(/(\d),(\d{3})(?!\d)/g, '$1\u0001$2');
    for (const piece of safe.split(',')) for (const p of piece.split(NEW_ITEM)) { const t = p.replace(/\u0001/g, ',').trim(); if (t) out.push(t); }
  }
  return out;
}

function createCapture(cfg, db, { now, agent, effects, registry }) {
  const pending = new Map(), trust = createTrust(db, now);
  const sweep = () => { for (const [k, v] of pending) if (v.at + TTL < now()) pending.delete(k); };
  const today = () => dubaiParts(now()).iso;

  // The end-of-sentence date: "... by friday", "... tomorrow". Returns { rest, due }.
  function takeDue(s) {
    const m = new RegExp('\\s+(?:(?:by|on|before|due|for)\\s+)?(' + DUE_WORD + ')\\s*$', 'i').exec(s);
    if (!m) return { rest: s, due: null };
    const due = parseDue(m[1].toLowerCase(), now()); return due ? { rest: s.slice(0, m.index).trim(), due } : { rest: s, due: null };
  }
  // A clock time anywhere in the part: "tomorrow 3pm", "at 15:30", "in 20 minutes", "friday at 9". Returns { rest, when } or null.
  const TIME = [new RegExp('\\b(in \\d{1,3} ?(?:minutes?|mins?|hours?|hrs?))\\b', 'i'),
    new RegExp('\\b((?:today|tomorrow|' + WEEKDAY + ')\\s+(?:at\\s+)?\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)\\b', 'i'), new RegExp('\\b(at\\s+\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)\\b', 'i'), new RegExp('\\b(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))\\b', 'i'), new RegExp('\\b(\\d{1,2}:\\d{2})\\b')];
  function takeTime(s) {
    for (const rx of TIME) {
      const m = rx.exec(s); if (!m) continue;
      let phrase = m[1].toLowerCase().replace(/\s+/g, ' ');
      if (!/^in /.test(phrase) && !/\bat\b/.test(phrase)) phrase = /^(today|tomorrow|[a-z]+day) /.test(phrase) ? phrase.replace(/^(\S+) /, '$1 at ') : 'at ' + phrase;
      const w = parseWhen(phrase, now()); if (!w) continue;
      const rest = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').replace(/\s+(?:at|on|by|for)\s*$/i, '').trim();
      return { rest, when: w, phrase };
    }
    return null;
  }
  const MONEY = /(?:\b(?:aed|dhs?|dirhams?)\s*(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:aed|dhs?|dirhams?)\b)/i;

  // One part -> { tool, input, confident, reason } or { no: reason }
  function classify(raw) {
    let t = raw.replace(FILLER, '').trim().replace(/[.!]+$/, '').trim();
    if (!/[\p{L}\p{N}]/u.test(t)) return { no: 'There is nothing here to add.' };
    if (t.length > MAX_PART) return { no: 'This part is too long (over ' + MAX_PART + ' characters). Split it into shorter parts.' };
    if (DESTRUCTIVE.test(t)) return { no: 'Quick capture only adds things. It never deletes, forgets or removes anything. Use NOVA Chat for that.' };
    let m;
    if ((m = /^notes?\s*(?:that\s+|:\s*|-\s*)(.+)$/i.exec(t))) return { tool: 'notes.create', input: { text: m[1].trim() }, confident: true };
    // phrases NOVA's chat rules already understand ("remind me at 3pm to ...", "I spent 25 dirhams on ...", "Sara owes me ...")
    let intent = null; try { intent = matchIntent(t, { db, user: { id: 0 }, now }); } catch (e) { intent = null; }
    if (intent && intent.call && ALLOWED.includes(intent.call.name) && !intent.final) return { tool: intent.call.name, input: intent.call.input, confident: true };
    if ((m = /^[Ii]\s+promised\s+([A-Z][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*)?)\s+(.+)$/u.exec(t))) {
      const d = takeDue(m[2]); if (d.rest.length >= 3) return { tool: 'commitments.create', input: Object.assign({ title: d.rest, direction: 'i_owe', counterparty: m[1] }, d.due ? { deadline: d.due } : {}), confident: true };
    }
    if ((m = MONEY.exec(t))) {
      const fils = parseMoney(String(m[1] || m[2]).replace(/,(?=\d{3}\b)/g, '')), note = t.replace(MONEY, ' ').replace(/\b(?:i\s+)?(?:spent|paid|pay|bought|buy|for|on)\b/ig, ' ').replace(/\s+/g, ' ').trim();
      if (fils) return { tool: 'expenses.add', input: Object.assign({ fils, category: categorize(note || t) }, note ? { note: clip(note, 120) } : {}), confident: !!note, reason: note ? null : 'I see an amount but not what it was for.' };
    }
    const tm = takeTime(t);
    if (tm && tm.rest.replace(/^(?:remind me|me)\s+(?:to\s+)?/i, '').trim().length >= 2) return { tool: 'reminders.create', input: { text: clip(tm.rest.replace(/^(?:remind me|me)\s+(?:to\s+)?/i, '').trim(), 200), dueAt: tm.when.dueAt, repeat: tm.when.repeat || 'none' }, confident: true };
    const d = takeDue(t), first = (d.rest.split(/\s+/)[0] || '').toLowerCase(), words = d.rest.split(/\s+/).length;
    if (d.rest.length < 2) return { no: 'I could not tell what to add.' };
    const latin = /[A-Za-z]/.test(d.rest);
    const verbLed = VERBS.has(first) || /^(?:add|create|make)\s+(?:a\s+)?(?:task|to-?do)\b/i.test(d.rest);
    const title = d.rest.replace(/^(?:add|create|make)\s+(?:a\s+|an\s+)?(?:task|to-?do)(?:\s+(?:to|for))?\s*:?\s*/i, '').trim() || d.rest;
    if (verbLed) return { tool: 'tasks.create', input: Object.assign({ title: clip(title, 200) }, d.due ? { due: d.due } : {}), confident: true };
    if (d.due && words <= 12) return { tool: 'tasks.create', input: { title: clip(title, 200), due: d.due }, confident: false, reason: 'I am not sure this is a task: it has a date but does not start with an action.' };
    if (!latin || words <= 6) return { tool: 'tasks.create', input: { title: clip(title, 200) }, confident: false, reason: 'I am not sure this is a task.' };
    return { no: 'I could not tell what kind of thing this is. Tick it to keep it as a note.' };
  }

  function label(tool, i) {
    switch (tool) {
      case 'tasks.create': return i.title + (i.due ? ', due ' + dayName(i.due) : ', no date');
      case 'reminders.create': { const p = dubaiParts(i.dueAt); return i.text + ', ' + (p.iso === today() ? 'today' : dayName(p.iso)) + ' ' + hm(i.dueAt) + (i.repeat && i.repeat !== 'none' ? ' (' + i.repeat + ')' : ''); }
      case 'notes.create': return i.text;
      case 'expenses.add': return aed(i.fils) + (i.note ? ' on ' + i.note : '') + ' (' + i.category + ')';
      case 'commitments.create': return (i.direction === 'owed_to_me' ? (i.counterparty || 'Someone') + ' owes you: ' : 'You owe ' + (i.counterparty || 'someone') + ': ') + i.title + (i.deadline ? ', due ' + dayName(i.deadline) : '');
      default: return '';
    }
  }
  const sameKey = (tool, i) => tool + '|' + norm(i.title || i.text || '') + '|' + (i.due || i.deadline || i.dueAt || '') + '|' + (i.fils || '') + '|' + norm(i.note || '') + '|' + norm(i.counterparty || '');

  function preview(user, text) {
    if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'Type or paste what you want to capture.', 'invalid');
    if (text.length > MAX_TEXT) throw new HttpError(400, 'That is too long for Quick capture (the limit is 2,000 characters). Split it into parts.', 'too_long');
    const items = [], no = [], seen = new Set(); let over = 0, n = 0, k = 0;
    for (const raw of split(text)) {
      const c = classify(raw);
      if (c.no) { no.push({ key: 'n' + (++k), text: clip(raw, MAX_PART), reason: c.no }); continue; }
      if (n >= MAX_ITEMS) { over++; continue; }
      const tool = registry.get(c.tool), v = tool ? validate(tool.schema, c.input) : { ok: false, error: 'unknown' };
      if (!v.ok) { no.push({ key: 'n' + (++k), text: clip(raw, MAX_PART), reason: 'I could not make this into a valid ' + KIND[c.tool].toLowerCase() + ': ' + v.error + '.' }); continue; }
      const key = sameKey(c.tool, c.input); let confident = c.confident, reason = c.reason || null, duplicate = null;
      if (seen.has(key)) { duplicate = 'The same as another part of this text.'; confident = false; }
      seen.add(key);
      const fx = effects.effects(user, c.tool, c.input, null);
      if (!duplicate && Array.isArray(fx) && fx.some(e => /already have an open task with the same title/.test(e))) { duplicate = 'You already have an open task with this title.'; confident = false; }
      if (!duplicate && c.tool === 'notes.create' && db.prepare('SELECT 1 FROM notes WHERE user_id = ? AND deleted_at IS NULL AND lower(text) = lower(?)').get(user.id, c.input.text)) { duplicate = 'You already have a note with this text.'; confident = false; }
      if (!duplicate && c.tool === 'commitments.create' && db.prepare("SELECT 1 FROM commitments WHERE user_id = ? AND lower(title) = lower(?) AND direction = ? AND status NOT IN ('completed','failed','cancelled')").get(user.id, c.input.title, c.input.direction)) { duplicate = 'You already track this promise.'; confident = false; }
      // "Before you promise": a heads-up when this week already holds 3 or more of my open promises
      const heads = c.tool === 'commitments.create' && c.input.direction === 'i_owe' && c.input.deadline ? trust.headsUp(user.id, c.input.deadline) : null;
      items.push({ key: 'i' + (++n), kind: KIND[c.tool], tool: c.tool, input: c.input, label: label(c.tool, c.input), confident, reason: duplicate || reason, duplicate: !!duplicate, effects: fx, headsUp: heads && heads.message ? heads.message : null });
    }
    if (!items.length && !no.length) throw new HttpError(400, 'There is nothing to capture in that text.', 'invalid');
    sweep(); for (const [id, v] of pending) if (v.uid === user.id && pending.size >= MAX_PENDING) pending.delete(id);
    const id = crypto.randomBytes(12).toString('hex'); pending.set(id, { uid: user.id, items, no, at: now() });
    return { captureId: id, items, notUnderstood: no, overLimit: over, limit: MAX_ITEMS, categories: CATEGORIES, expiresInMinutes: Math.round(TTL / 60e3) };
  }

  // fields a person may edit before approving, per tool
  const EDIT = { 'tasks.create': ['title', 'due'], 'notes.create': ['text'], 'reminders.create': ['text', 'dueAt'], 'expenses.add': ['fils', 'category', 'note'], 'commitments.create': ['title', 'counterparty', 'deadline'] };
  async function apply(auth, ip, id, body) {
    sweep();
    const p = pending.get(String(id));
    if (!p || p.uid !== auth.user.id) throw new HttpError(404, 'That capture preview has expired. Type it again to start over. Nothing was added.', 'not_found');
    const select = Array.isArray(body.select) ? body.select.map(String) : null;
    if (!select) throw new HttpError(400, 'Choose what to add. Nothing was added.', 'invalid');
    const edits = body.edits && typeof body.edits === 'object' && !Array.isArray(body.edits) ? body.edits : {};
    pending.delete(String(id));
    const chosen = [];
    for (const it of p.items) if (select.includes(it.key)) chosen.push(it);
    for (const n of p.no) if (select.includes(n.key)) chosen.push({ key: n.key, tool: 'notes.create', kind: 'Note', input: { text: n.text }, label: n.text, fromNote: true });
    if (!chosen.length) throw new HttpError(400, 'Nothing was selected, so nothing was added.', 'invalid');
    if (chosen.length > MAX_ITEMS) throw new HttpError(400, 'Quick capture adds at most ' + MAX_ITEMS + ' things at once. Nothing was added.', 'too_many');
    const results = [], user = auth.user;
    for (const it of chosen) {
      let input = Object.assign({}, it.input); const e = edits[it.key];
      if (e && typeof e === 'object') for (const f of EDIT[it.tool]) if (e[f] !== undefined) { if (e[f] === '' || e[f] === null) delete input[f]; else input[f] = e[f]; }
      const tool = registry.get(it.tool), v = tool ? validate(tool.schema, input) : { ok: false, error: 'unknown tool' };
      if (!ALLOWED.includes(it.tool) || !v.ok) { results.push({ key: it.key, kind: it.kind, label: it.label, ok: false, message: 'Not added: ' + (v.ok ? 'this kind of change is not allowed here' : 'the edited value is not valid (' + v.error + ')') + '.' }); continue; }
      const lab = label(it.tool, input);
      try {
        let run = await agent.start({ user, session: auth.session, ip }, 'Quick capture: ' + KIND[it.tool] + ': ' + lab, { call: { name: it.tool, input }, understood: 'Quick capture: ' + KIND[it.tool].toLowerCase() + ' "' + clip(lab, 80) + '"' });
        if (run && run.pendingApproval) run = await agent.approve({ user, session: auth.session, ip }, run.pendingApproval.id);
        const ok = !!run && run.status === 'completed';
        results.push({ key: it.key, kind: it.kind, label: lab, ok, message: ok ? (run.result || 'Added.') : ((run && (run.failure || run.result)) || 'It could not be added. Nothing was changed.') });
      } catch (err) { results.push({ key: it.key, kind: it.kind, label: lab, ok: false, message: err instanceof HttpError ? err.message : 'It could not be added. Nothing was changed.' }); }
    }
    const added = results.filter(r => r.ok).length;
    audit(db, now, user.id, 'capture_applied', added + ' of ' + results.length + ' added', ip);
    return { ok: true, added, total: results.length, results };
  }

  function register(router) {
    router.post('/api/capture/preview', { group: 'chat' }, ctx => ({ status: 200, body: preview(ctx.auth.user, ctx.body.text) }));
    router.post('/api/capture/apply', { group: 'chat' }, async ctx => {
      if (ctx.body.approve !== true) throw new HttpError(400, 'Press Approve to add these. Nothing was added.', 'approval_required');
      return { status: 200, body: await apply(ctx.auth, ctx.req.socket.remoteAddress, ctx.body.captureId, ctx.body) };
    });
    router.post('/api/capture/cancel', ctx => { pending.delete(String(ctx.body.captureId)); return { status: 200, body: { ok: true } }; });
  }
  return { register, preview, apply, split, classify };
}
module.exports = { createCapture, split, ALLOWED, MAX_ITEMS, MAX_TEXT };

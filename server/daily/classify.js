// E-mail triage without AI: every priority comes with the reasons that produced it, so you can see why and disagree.
// Priorities: critical, important, normal, low, review (possible phishing: check before you click anything).
// Categories: suspicious, newsletter, needs_reply, deadline, fyi.   Input is untrusted text: it is only matched, never executed or obeyed.
'use strict';
const { parseDue, dubaiDate } = require('../agent/planner');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WD = '(today|tomorrow|tonight|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+\\d{1,2}(?:st|nd|rd|th)?)';
const DEADLINE_RX = new RegExp('\\b(?:by|before|until|no later than|deadline(?: is)?:?|due(?: on| by)?|closes(?: on)?|expires(?: on)?)\\s+(?:end of\\s+|eod\\s+)?(?:this\\s+|next\\s+)?' + WD + '\\b', 'i');
const PROMISE_RX = /\b(?:i|we)(?:'ll| will| shall| am going to| are going to)\s+((?:send|share|forward|get back to you|confirm|deliver|email|update you|let you know|reply)[^.!?\n]{0,80})/i;
const ASK_RX = /\b(?:can you|could you|would you|will you|please (?:send|confirm|reply|share|let me know|review|submit|complete|sign|call)|let me know|are you available|kindly (?:send|confirm|reply|share|submit)|your (?:response|reply|confirmation) is (?:needed|required))\b/i;
const JOB_RX = /\b(?:interview|offer letter|job offer|shortlist(?:ed)?|assessment|recruit(?:er|ment)?|hiring|application|internship|position|vacancy|onboarding)\b/i;
const PHISH_RX = /\b(?:verify your (?:account|identity|details)|confirm your (?:password|bank|card|account)|reset your password immediately|account (?:has been |will be )?(?:suspended|locked|closed)|unusual sign-?in|gift cards?|wire transfer|bitcoin|crypto wallet|you (?:have )?won|lottery|claim your (?:prize|reward)|urgent action required|act now|otp|one-time (?:pass)?code)\b/i;
const BRAND_RX = /\b(bank|paypal|apple|microsoft|google|amazon|netflix|dhl|fedex|aramex|customs|police|ministry|government|visa services|immigration|tax)\b/i;
const FREEMAIL_RX = /@(?:gmail|googlemail|yahoo|hotmail|outlook|live|aol|proton|icloud|mail)\.[a-z.]+$/i;
const BULK_RX = /^(?:no-?reply|noreply|newsletter|news|updates?|notifications?|marketing|info|hello|team|digest)@/i;
const URGENT_RX = /\b(?:urgent|asap|immediately|today|by end of day|eod|time-sensitive)\b/i;

function toIso(word, receivedAt) {
  const w = String(word).toLowerCase().replace(/(\d)(st|nd|rd|th)\b/, '$1').trim();
  if (w === 'tonight') return dubaiDate(receivedAt);
  const d = parseDue(w, receivedAt); if (d) return d;
  let m = /^(\d{1,2})\s+([a-z]{3})/.exec(w) || null, day, mon;
  if (m) { day = +m[1]; mon = MONTHS.indexOf(m[2]); } else if ((m = /^([a-z]{3})[a-z]*\s+(\d{1,2})$/.exec(w))) { mon = MONTHS.indexOf(m[1]); day = +m[2]; }
  if (!m || mon < 0 || day < 1 || day > 31) return null;
  const rec = dubaiDate(receivedAt), y = +rec.slice(0, 4);
  let iso = y + '-' + String(mon + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  if (iso < rec && (Date.parse(rec) - Date.parse(iso)) > 60 * 86400e3) iso = (y + 1) + iso.slice(4);         // "5 Jan" in December means next year
  return isNaN(Date.parse(iso)) ? null : iso;
}

// e: { fromName, fromAddr, subject, snippet, labels:[], unsubscribe:bool, receivedAt }   ctx: { today, known:Set(lowercase names/addresses), owner }
function classify(e, ctx) {
  const text = (e.subject || '') + ' \n ' + (e.snippet || ''), reasons = [], from = String(e.fromAddr || '').toLowerCase(), name = String(e.fromName || '');
  const labels = e.labels || [], known = ctx.known || new Set();
  const bulk = !!e.unsubscribe || BULK_RX.test(from) || labels.some(l => /CATEGORY_(PROMOTIONS|SOCIAL|FORUMS)/.test(l));
  const isKnown = known.has(from) || (name && [...known].some(k => k.length > 2 && name.toLowerCase().includes(k)));
  const dm = DEADLINE_RX.exec(text), deadline = dm ? toIso(dm[1], e.receivedAt) : null;
  const pm = !bulk && PROMISE_RX.exec(e.snippet || ''), promise = pm ? pm[1].trim().replace(/\s+/g, ' ') : null;
  const asks = !bulk && (ASK_RX.test(text) || /\?/.test(e.snippet || ''));
  const job = JOB_RX.test(text);

  // 1. possible phishing first: it overrides everything else
  const sig = [];
  if (PHISH_RX.test(text)) sig.push('asks for account details, codes, payment or claims a prize');
  const brand = BRAND_RX.exec(name);
  if (brand && FREEMAIL_RX.test(from)) sig.push('the name says "' + brand[1] + '" but it was sent from a free personal mailbox');
  if (/\b(?:bit\.ly|tinyurl|t\.co|goo\.gl|rb\.gy)\//i.test(text)) sig.push('uses a shortened link that hides where it goes');
  if (sig.length >= 2 || (sig.length && URGENT_RX.test(text))) {
    return { priority: 'review', category: 'suspicious', reasons: sig.map(x => x.charAt(0).toUpperCase() + x.slice(1) + '.').concat(['Do not click links, open attachments or share codes until you have checked it another way.']), deadline: null, promise: null };
  }
  if (sig.length) reasons.push('Be careful: ' + sig[0] + '.');

  const days = deadline ? Math.round((Date.parse(deadline) - Date.parse(ctx.today)) / 86400e3) : null;
  if (bulk) {
    reasons.push(e.unsubscribe ? 'It has an unsubscribe link (a mailing list).' : labels.some(l => /CATEGORY_/.test(l)) ? 'Gmail filed it under ' + labels.find(l => /CATEGORY_/.test(l)).replace('CATEGORY_', '').toLowerCase() + '.' : 'It comes from an automated address.');
    return { priority: deadline && days !== null && days >= 0 && days <= 2 ? 'normal' : 'low', category: 'newsletter', reasons: reasons.concat(deadline ? ['It mentions a date: ' + deadline + '.'] : []), deadline, promise: null };
  }
  if (asks) reasons.push('They ask you something directly.');
  if (job) reasons.push('It is about a job, an application or an interview.');
  if (isKnown) reasons.push('You already track something with this person in NOVA.');
  if (deadline) reasons.push('Deadline ' + (days < 0 ? 'passed (' + deadline + ')' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days (' + deadline + ')') + '.');
  if (promise) reasons.push('They promised: "' + promise + '". You can track it in ProofLoop.');
  const urgent = URGENT_RX.test(text);
  if (urgent && (asks || job)) reasons.push('It says it is urgent.');

  let priority = 'normal';
  if (deadline && days !== null && days >= 0 && days <= 1 && (asks || job || isKnown)) priority = 'critical';
  else if (urgent && asks && (job || isKnown)) priority = 'critical';
  else if (asks || job || isKnown || (deadline && days !== null && days >= 0 && days <= 7) || promise) priority = 'important';
  if (!reasons.length) reasons.push('A personal message with no request or deadline found.');
  const category = asks ? 'needs_reply' : deadline ? 'deadline' : 'fyi';
  return { priority, category, reasons, deadline, promise };
}
module.exports = { classify, toIso };

/* Jarvis: app core. Data, UAE dates, parsing and screens.
   Plain JavaScript, no build step. All data stays in this browser (localStorage). */
(function () {
  'use strict';

  var TZ = 'Asia/Dubai';
  var KEY = 'jarvis.data.v2';
  var STALE_DAYS = 42; // a skill turns red after 6 weeks with no new win
  var STAGES = [['interested', 'Interested'], ['applied', 'Applied'], ['progress', 'In progress'], ['done', 'Done']];
  var KINDS = [['job', 'Job'], ['project', 'Project'], ['course', 'Course']];
  var VIEWS = {
    today: 'Today', commitments: 'Commitments', growth: 'Growth', opportunities: 'Opportunities',
    review: 'Weekly review', approvals: 'Approvals', profile: 'My profile'
  };

  /* ---------- small helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function cap(s) { s = String(s || '').trim(); return s.charAt(0).toUpperCase() + s.slice(1); }
  function titleCase(s) { return String(s || '').trim().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  var motionQuery = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  function calm() { return !!(motionQuery && motionQuery.matches); }
  function joinList(items) {
    if (items.length < 2) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  /* ---------- dates (always Asia/Dubai) ---------- */
  var partFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  function nowParts(d) {
    var o = {};
    partFmt.formatToParts(d || new Date()).forEach(function (p) { o[p.type] = p.value; });
    if (o.hour === '24') o.hour = '00';
    return o;
  }
  function today() { var p = nowParts(); return p.year + '-' + p.month + '-' + p.day; }
  function hourNow() { return +nowParts().hour; }
  function toDate(iso) { return new Date(iso + 'T12:00:00Z'); }
  function addDays(iso, n) { var d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dow(iso) { return toDate(iso).getUTCDay(); } // 0 Sun ... 5 Fri, 6 Sat
  function diff(a, b) { return Math.round((toDate(b) - toDate(a)) / 864e5); }
  // UAE work week is Monday to Friday; the weekend is Saturday and Sunday.
  function weekEnd(t) { t = t || today(); return addDays(t, (5 - dow(t) + 7) % 7); }
  function weekStart(t) { t = t || today(); return addDays(t, -((dow(t) + 6) % 7)); }
  function isWeekday(t) { var d = dow(t); return d >= 1 && d <= 5; }
  function fmtDate(iso, o) {
    return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }, o || {})).format(toDate(iso));
  }
  function longDate(iso) { return fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
  function spokenDate(iso) { return fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long' }); }
  function dueLabel(iso) {
    if (!iso) return 'No date';
    var n = diff(today(), iso);
    if (n === 0) return 'Due today';
    if (n === 1) return 'Due tomorrow';
    if (n < 0) return plural(-n, 'day') + ' overdue';
    if (n < 7) return 'Due ' + fmtDate(iso, { weekday: 'long', day: undefined, month: undefined });
    return 'Due in ' + n + ' days';
  }
  function ago(iso) {
    if (!iso) return 'never';
    var n = diff(iso, today());
    if (n <= 0) return 'today';
    if (n === 1) return 'yesterday';
    if (n < 14) return n + ' days ago';
    return Math.floor(n / 7) + ' weeks ago';
  }
  function timeNow() {
    return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date());
  }
  function aed(n) {
    return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', currencyDisplay: 'code', maximumFractionDigits: 0 }).format(n);
  }

  /* ---------- understanding dates in plain English ---------- */
  var WORDNUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, 'a couple of': 2, 'couple of': 2, 'a few': 3, few: 3 };
  var MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var DAY_RX = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday|mon|tues|tue|wed|thurs|thur|thu|fri)';
  var MON_RX = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';

  function makeDate(y, m, d) {
    var dt = new Date(Date.UTC(y, m, d, 12));
    if (dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null;
    return dt.toISOString().slice(0, 10);
  }
  function nextWeekday(base, idx, mod) {
    var n = (idx - dow(base) + 7) % 7;
    if (mod === 'next') {
      if (n === 0) n = 7;
      else if (isWeekday(base) && addDays(base, n) <= weekEnd(base)) n += 7;
    }
    return addDays(base, n);
  }
  var DATE_RULES = [
    [/\bday after tomorrow\b/, function (m, b) { return addDays(b, 2); }],
    [/\b(?:today|tonight|end of (?:the )?day|eod|close of business|cob)\b/, function (m, b) { return b; }],
    [/\btomorrow\b/, function (m, b) { return addDays(b, 1); }],
    [/\b(?:(?:the )?end of (?:the |this )?(?:work ?)?week|eow|this week)\b/, function (m, b) { return weekEnd(b); }],
    [/\bnext week\b/, function (m, b) { return addDays(weekStart(b), 7); }],
    [/\b(?:(?:the )?end of (?:the |this )?month|eom|month end)\b/, function (m, b) {
      var d = toDate(b); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
    }],
    [/\bin (\d+|a couple of|couple of|a few|few|a|an|one|two|three|four|five|six|seven|eight|nine|ten) (day|week|month)s?\b/, function (m, b) {
      var n = /^\d+$/.test(m[1]) ? +m[1] : WORDNUM[m[1]];
      return addDays(b, n * (m[2] === 'week' ? 7 : m[2] === 'month' ? 30 : 1));
    }],
    [new RegExp('\\b(?:(next|this|coming) )?' + DAY_RX + '\\b'), function (m, b) {
      var idx = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[2].slice(0, 3));
      return nextWeekday(b, idx, m[1]);
    }],
    [/\b(\d{4})-(\d{2})-(\d{2})\b/, function (m) { return makeDate(+m[1], +m[2] - 1, +m[3]); }],
    [new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?(?: of)? ' + MON_RX + '(?:,? (\\d{4}))?(?![a-z])'), function (m, b) { return dayMonth(+m[1], m[2], m[3], b); }],
    [new RegExp('\\b' + MON_RX + ' (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b'), function (m, b) { return dayMonth(+m[2], m[1], m[3], b); }],
    [/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, function (m, b) { // UAE style: day/month
      var y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : +b.slice(0, 4);
      var iso = makeDate(y, +m[2] - 1, +m[1]);
      if (iso && !m[3] && iso < b) iso = makeDate(y + 1, +m[2] - 1, +m[1]);
      return iso;
    }],
    [/\bthe (\d{1,2})(?:st|nd|rd|th)\b/, function (m, b) {
      var d = toDate(b), y = d.getUTCFullYear(), mo = d.getUTCMonth();
      var iso = makeDate(y, mo, +m[1]);
      if (!iso || iso < b) iso = makeDate(mo === 11 ? y + 1 : y, (mo + 1) % 12, +m[1]);
      return iso;
    }]
  ];
  function dayMonth(day, mon, year, b) {
    var mi = MON.indexOf(mon.slice(0, 3));
    var y = year ? +year : +b.slice(0, 4);
    var iso = makeDate(y, mi, day);
    if (iso && !year && iso < b) iso = makeDate(y + 1, mi, day);
    return iso;
  }
  // Finds a due date in text. Returns { date, start, end } where start/end cover the phrase (with "by", "on"...).
  function parseDue(text, base) {
    base = base || today();
    var t = String(text || '').toLowerCase();
    for (var i = 0; i < DATE_RULES.length; i++) {
      var m = t.match(DATE_RULES[i][0]);
      if (!m) continue;
      var date = DATE_RULES[i][1](m, base);
      if (!date) continue;
      var start = m.index, end = m.index + m[0].length;
      var pre = t.slice(0, start).match(/(?:\b(?:by|on|before|due|until|till|for|at|no later than|latest by)\s+)+$/);
      if (pre) start -= pre[0].length;
      return { date: date, start: start, end: end };
    }
    return null;
  }

  /* ---------- quick capture: "I'll send the report to Omar by Friday" ---------- */
  var NOT_PEOPLE = /^(me|myself|you|it|them|him|her|us|this|that|these|those|do|be|go|work|bed|sleep|lunch|dinner|the office|office|home|everyone|all)$/i;
  function knownPeople() {
    return state.profile.people.map(function (p) { return p.name; }).filter(Boolean);
  }
  function parseCapture(text) {
    var s = String(text || '').trim().replace(/[.!?]+$/, '');
    s = s.replace(/^(?:hey |ok |okay )?jarvis[,:]?\s*/i, '');
    s = s.replace(/^(?:please\s+)?(?:remind me (?:to|that i (?:need|have) to|about)|i'?ll|i will|i shall|i'?m going to|i am going to|i'?m gonna|i need to|i have to|i'?ve got to|i must|i promised (?:to|that i'?d)|i promise to|add (?:a |another )?(?:task|commitment|promise|reminder)(?: to)?:?|new (?:task|commitment|promise):?|to-?do:?)\s+/i, '');
    var due = parseDue(s);
    if (due) s = (s.slice(0, due.start) + ' ' + s.slice(due.end)).replace(/\s+/g, ' ').trim();
    s = s.replace(/[,;:]+$/, '').trim();

    var who = '', what = s;
    var people = knownPeople();
    var m = s.match(/\s+(to|for|with)\s+((?:the\s+)?[A-Za-z][\w'.-]*(?:\s+[A-Za-z][\w'.-]*)?)$/i);
    if (m) {
      var cand = m[2].trim(), prep = m[1].toLowerCase(), first = cand.split(/\s+/)[0];
      var known = people.filter(function (p) { return p.toLowerCase().split(/\s+/)[0] === first.toLowerCase(); })[0];
      var ok = !!known ||
        (prep === 'to' && !NOT_PEOPLE.test(cand) && !NOT_PEOPLE.test(first)) ||
        (prep !== 'to' && /^[A-Z]/.test(first) && cand.split(/\s+/).length === 1);
      if (ok) {
        who = known && cand.split(/\s+/).length === 1 ? known : titleCase(cand.replace(/^the\s+/i, 'the '));
        var rest = s.slice(0, m.index).trim();
        what = rest.split(/\s+/).length >= 2 ? rest : s;
      }
    }
    if (!who) {
      people.some(function (p) {
        var first = p.split(/\s+/)[0];
        if (first && new RegExp('\\b' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(s)) { who = p; return true; }
        return false;
      });
    }
    // Write known names properly even when speech recognition gives lower case.
    people.forEach(function (p) {
      var first = p.split(/\s+/)[0];
      if (first) what = what.replace(new RegExp('\\b' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), first);
    });
    return { what: cap(what), who: who, due: due ? due.date : '' };
  }

  /* ---------- fuzzy matching ---------- */
  var STOP = {};
  'the a an to for of and with my me i on by as is be at in it this that please mark done complete completed finished finish task item off check tick as'.split(' ').forEach(function (w) { STOP[w] = 1; });
  function tokens(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1 && !STOP[w]; });
  }
  function overlap(q, target) {
    var qt = tokens(q), tt = tokens(target);
    if (!qt.length) return 0;
    var hits = qt.filter(function (w) {
      return tt.some(function (x) { return x === w || (w.length > 3 && x.length > 3 && x.slice(0, 4) === w.slice(0, 4)); });
    }).length;
    return hits / qt.length + hits * 0.01;
  }

  /* ---------- data ---------- */
  function blank() {
    return {
      v: 2,
      profile: { name: 'Roshan', goal: '', goalSample: false, strengths: [], people: [] },
      commitments: [], skills: [], wins: [], opps: [], drafts: [],
      settings: { hey: false, speak: true, voice: '', rate: 1 }
    };
  }
  function sampleData() {
    var t = today(), d = blank(), S = true;
    d.profile.goal = 'Become Head of Engineering within two years, leading a team of 30+ people.';
    d.profile.goalSample = S;
    d.profile.strengths = ['Systems thinking', 'Calm under pressure', 'Clear writing', 'Building trust with stakeholders'].map(function (n) { return { id: uid(), name: n, sample: S }; });
    d.profile.people = [
      { id: uid(), name: 'Omar', role: 'Manager', note: 'Weekly 1:1 on Mondays. Likes short written updates.', sample: S },
      { id: uid(), name: 'Sara', role: 'Mentor', note: 'Former CTO. Meet once a month.', sample: S },
      { id: uid(), name: 'Priya', role: 'Key peer, Product', note: 'Co-owns the roadmap.', sample: S },
      { id: uid(), name: 'Khalid', role: 'Sponsor, VP Operations', note: 'Speaks for me in leadership meetings.', sample: S }
    ];
    d.commitments = [
      { id: uid(), what: 'Send the Q3 cost report', who: 'Omar', due: addDays(t, -2), done: false, created: addDays(t, -8), sample: S },
      { id: uid(), what: 'Share the vendor comparison', who: 'Priya', due: t, done: false, created: addDays(t, -4), sample: S },
      { id: uid(), what: 'Book a mentoring session', who: 'Sara', due: addDays(t, 1), done: false, created: addDays(t, -3), sample: S },
      { id: uid(), what: 'Review the hiring plan draft', who: 'Khalid', due: weekEnd(addDays(t, 1)), done: false, created: addDays(t, -2), sample: S },
      { id: uid(), what: 'Prepare board update slides', who: 'Omar', due: addDays(t, 10), done: false, created: addDays(t, -1), sample: S },
      { id: uid(), what: 'Reply to the audit team', who: 'Audit team', due: addDays(t, -1), done: true, doneOn: addDays(t, -1), created: addDays(t, -6), sample: S }
    ];
    var sk = ['Leadership and people', 'Cloud architecture', 'Public speaking', 'Financial planning'].map(function (n) {
      return { id: uid(), name: n, created: addDays(t, -90), sample: S };
    });
    d.skills = sk;
    d.wins = [
      { id: uid(), text: 'Led the incident review that cut repeat outages by 30%', skillId: sk[0].id, date: addDays(t, -3), sample: S },
      { id: uid(), text: 'Moved reporting jobs to serverless, saving AED 4,000 a month', skillId: sk[1].id, date: addDays(t, -12), sample: S },
      { id: uid(), text: 'Presented the roadmap to 40 people at the town hall', skillId: sk[2].id, date: addDays(t, -20), sample: S },
      { id: uid(), text: 'Built the first department budget model', skillId: sk[3].id, date: addDays(t, -50), sample: S },
      { id: uid(), text: 'Coached two engineers into senior roles', skillId: sk[0].id, date: addDays(t, -33), sample: S }
    ];
    d.opps = [
      { id: uid(), name: 'Head of Engineering', kind: 'job', org: 'Fintech scale-up, Dubai', stage: 'interested', tags: 'leadership, cloud, financial, hiring', value: 55000, note: 'Monthly salary. Referral possible through Sara.', sample: S },
      { id: uid(), name: 'Executive leadership programme', kind: 'course', org: 'Business school, Dubai', stage: 'applied', tags: 'leadership, speaking, strategy', value: 12500, note: 'Course fee. Ask about company sponsorship.', sample: S },
      { id: uid(), name: 'Cloud cost optimisation', kind: 'project', org: 'Internal', stage: 'progress', tags: 'cloud, financial', value: 240000, note: 'Target yearly saving.', sample: S },
      { id: uid(), name: 'Cloud architect certification', kind: 'course', org: 'Online', stage: 'done', tags: 'cloud, security', value: 1100, note: 'Exam fee.', sample: S }
    ];
    d.drafts = [
      { id: uid(), to: 'Omar', subject: 'Q3 cost report: new time', body: 'Hi Omar,\n\nThe Q3 cost report needs one more day so the cloud numbers are final. You will have it tomorrow by 10 am.\n\nThanks,\nRoshan', status: 'pending', sample: S },
      { id: uid(), to: 'Sara', subject: 'Mentoring session', body: 'Hi Sara,\n\nCould we meet next week for 45 minutes? I would value your view on the Head of Engineering role.\n\nBest,\nRoshan', status: 'pending', sample: S }
    ];
    d.isSample = true;
    return d;
  }
  function normalize(d) {
    var b = blank();
    d = d && typeof d === 'object' ? d : {};
    var out = {
      v: 2,
      profile: Object.assign(b.profile, d.profile || {}),
      settings: Object.assign(b.settings, d.settings || {})
    };
    ['commitments', 'skills', 'wins', 'opps', 'drafts'].forEach(function (k) { out[k] = Array.isArray(d[k]) ? d[k].filter(Boolean) : []; });
    if (!Array.isArray(out.profile.strengths)) out.profile.strengths = [];
    if (!Array.isArray(out.profile.people)) out.profile.people = [];
    out.profile.strengths = out.profile.strengths.map(function (s) { return typeof s === 'string' ? { id: uid(), name: s } : s; });
    if (!out.profile.name) out.profile.name = 'Roshan';
    return out;
  }

  var state;
  var storageOk = true;
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); storageOk = true; }
    catch (e) {
      if (storageOk) toast('Could not save. Browser storage is full or blocked.');
      storageOk = false;
    }
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* fall through to sample data */ }
    var s = normalize(sampleData());
    return s;
  }
  function hasSample() {
    var p = state.profile;
    return p.goalSample || p.strengths.some(isSample) || p.people.some(isSample) ||
      ['commitments', 'skills', 'wins', 'opps', 'drafts'].some(function (k) { return state[k].some(isSample); });
  }
  function isSample(x) { return x && x.sample; }
  function notSample(x) { return !(x && x.sample); }
  function clearSample() {
    snapshot();
    var p = state.profile;
    if (p.goalSample) { p.goal = ''; p.goalSample = false; }
    p.strengths = p.strengths.filter(notSample);
    p.people = p.people.filter(notSample);
    ['commitments', 'skills', 'wins', 'opps', 'drafts'].forEach(function (k) { state[k] = state[k].filter(notSample); });
    save();
    toast('Sample data cleared. Jarvis is ready for your own data.', true);
  }

  var undoSnap = null;
  function snapshot() { undoSnap = JSON.stringify(state); }
  function undo() {
    if (!undoSnap) return;
    state = normalize(JSON.parse(undoSnap));
    undoSnap = null;
    save();
    toast('Restored.');
  }
  function save() { persist(); render(false); }

  /* ---------- queries ---------- */
  function byDue(a, b) { return (a.due || '9999').localeCompare(b.due || '9999'); }
  function openItems() { return state.commitments.filter(function (c) { return !c.done; }); }
  function overdue() { var t = today(); return openItems().filter(function (c) { return c.due && c.due < t; }).sort(byDue); }
  function dueToday() { var t = today(); return openItems().filter(function (c) { return c.due === t; }); }
  function dueWeek() {
    var t = today(), we = weekEnd(t);
    return openItems().filter(function (c) { return c.due && c.due > t && c.due <= we; }).sort(byDue);
  }
  function pendingDrafts() { return state.drafts.filter(function (d) { return d.status === 'pending'; }); }
  function skillWins(id) { return state.wins.filter(function (w) { return w.skillId === id; }); }
  function skillInfo(s) {
    var wins = skillWins(s.id);
    var last = wins.reduce(function (m, w) { return !m || w.date > m ? w.date : m; }, '');
    var since = diff(last || s.created || today(), today());
    var recent = wins.filter(function (w) { return diff(w.date, today()) <= 90; }).length;
    return { wins: wins.length, last: last, since: since, stale: since >= STALE_DAYS, momentum: clamp(Math.round(recent / 4 * 100), 0, 100) };
  }
  function staleSkills() {
    return state.skills.map(function (s) { return { s: s, i: skillInfo(s) }; })
      .filter(function (x) { return x.i.stale; })
      .sort(function (a, b) { return b.i.since - a.i.since; });
  }
  function profileWords() {
    var txt = state.skills.map(function (s) { return s.name; }).join(' ') + ' ' +
      state.profile.strengths.map(function (s) { return s.name; }).join(' ') + ' ' + state.profile.goal;
    return tokens(txt);
  }
  function wordHit(w, words) {
    return words.some(function (x) { return x === w || (w.length > 3 && x.length > 3 && x.slice(0, 4) === w.slice(0, 4)); });
  }
  function matchScore(o) {
    if (o.score !== undefined && o.score !== null && o.score !== '' && !isNaN(+o.score)) return clamp(Math.round(+o.score), 0, 100);
    var words = profileWords();
    var tags = String(o.tags || '').split(/[,;]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (tags.length) {
      var hits = tags.filter(function (tag) { return tokens(tag).some(function (w) { return wordHit(w, words); }); }).length;
      return clamp(Math.round(35 + 60 * hits / tags.length), 0, 98);
    }
    var nameHits = tokens(o.name + ' ' + (o.org || '')).filter(function (w) { return wordHit(w, words); }).length;
    return clamp(45 + nameHits * 12, 0, 95);
  }
  function stageName(id) { var s = STAGES.filter(function (x) { return x[0] === id; })[0]; return s ? s[1] : 'Interested'; }
  function kindName(id) { var s = KINDS.filter(function (x) { return x[0] === id; })[0]; return s ? s[1] : 'Opportunity'; }

  function itemPhrase(c) {
    var named = c.who && c.what.toLowerCase().indexOf(c.who.toLowerCase()) >= 0;
    return c.what + (c.who && !named ? ' for ' + c.who : '');
  }
  function spokenDue(iso) {
    if (!iso) return 'with no date yet';
    var n = diff(today(), iso);
    if (n === 0) return 'due today';
    if (n === 1) return 'due tomorrow, ' + spokenDate(iso);
    if (n < 0) return 'due ' + spokenDate(iso) + ', which has passed';
    return 'due ' + spokenDate(iso);
  }
  function nextStep() {
    var t = today();
    var o = overdue();
    if (o.length) {
      var n = diff(o[0].due, t);
      return { text: 'Finish "' + itemPhrase(o[0]) + '". It was due ' + (n === 1 ? 'yesterday' : n + ' days ago') + '.', view: 'commitments', label: 'Open commitments', tone: 'red' };
    }
    var d = dueToday();
    if (d.length) return { text: 'Complete "' + itemPhrase(d[0]) + '". It is due today.', view: 'commitments', label: 'Open commitments' };
    var p = pendingDrafts();
    if (p.length) return { text: 'Review ' + plural(p.length, 'draft') + ' waiting in Approvals.', view: 'approvals', label: 'Open approvals' };
    var st = staleSkills();
    if (st.length) return { text: 'Log a win for "' + st[0].s.name + '". It has had no progress for ' + Math.floor(st[0].i.since / 7) + ' weeks.', view: 'growth', label: 'Open growth' };
    var w = dueWeek();
    if (w.length) return { text: 'Get ahead on "' + itemPhrase(w[0]) + '", ' + dueLabel(w[0].due).toLowerCase() + '.', view: 'commitments', label: 'Open commitments' };
    var op = state.opps.filter(function (x) { return x.stage === 'interested'; })
      .sort(function (a, b) { return matchScore(b) - matchScore(a); })[0];
    if (op && matchScore(op) >= 60) return { text: 'Take the next step on "' + op.name + '". It is a ' + matchScore(op) + '% match.', view: 'opportunities', label: 'Open opportunities' };
    return { text: 'You are clear. Capture each new promise the moment you make it.', view: 'commitments', label: 'Capture a promise' };
  }
  function weekReview() {
    var t = today(), ws = weekStart(t);
    return {
      start: ws, end: addDays(ws, 4),
      wins: state.wins.filter(function (w) { return w.date >= ws && w.date <= t; }).sort(function (a, b) { return b.date.localeCompare(a.date); }),
      kept: state.commitments.filter(function (c) { return c.done && c.doneOn && c.doneOn >= ws; }),
      slipped: overdue(),
      next: nextStep()
    };
  }

  /* ---------- actions (used by screens and by voice) ---------- */
  function addCommitment(c) {
    var item = { id: uid(), what: cap(c.what), who: (c.who || '').trim(), due: c.due || '', done: false, created: today() };
    state.commitments.push(item);
    save();
    return item;
  }
  function setDone(id, done) {
    var c = state.commitments.filter(function (x) { return x.id === id; })[0];
    if (!c) return null;
    c.done = done; c.doneOn = done ? today() : '';
    save();
    return c;
  }
  function findCommitment(q, includeDone) {
    var best = null, bestScore = 0;
    state.commitments.forEach(function (c) {
      if (c.done && !includeDone) return;
      var s = overlap(q, c.what + ' ' + c.who);
      if (s > bestScore) { best = c; bestScore = s; }
    });
    return bestScore >= 0.5 ? best : null;
  }
  function guessSkill(text) {
    var best = null, bestScore = 0;
    state.skills.forEach(function (s) {
      var sc = overlap(s.name, text);
      if (sc > bestScore) { best = s; bestScore = sc; }
    });
    return bestScore > 0.3 ? best : null;
  }
  function addWin(text, skillId, date) {
    var sk = skillId ? null : guessSkill(text);
    var w = { id: uid(), text: cap(text), skillId: skillId || (sk ? sk.id : ''), date: date || today() };
    state.wins.push(w);
    save();
    return { win: w, skill: skillById(w.skillId) };
  }
  function skillById(id) { return state.skills.filter(function (s) { return s.id === id; })[0] || null; }
  function addOpp(o) {
    var item = { id: uid(), name: cap(o.name), kind: o.kind || 'job', org: o.org || '', stage: o.stage || 'interested', tags: o.tags || '', value: o.value || '', note: o.note || '' };
    state.opps.push(item);
    save();
    return item;
  }

  /* ---------- UI: toast ---------- */
  var toastTimer;
  function toast(msg, withUndo) {
    var el = $('#toast');
    if (!el) return;
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (withUndo && undoSnap ? '<button type="button" class="btn small" data-act="undo">Undo</button>' : '');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, withUndo ? 6000 : 3500);
  }

  /* ---------- UI: form dialog ---------- */
  var dialogCfg = null;
  function openForm(cfg) {
    var dlg = $('#formDialog');
    dialogCfg = cfg;
    $('#formTitle').textContent = cfg.title;
    $('#dialogSave').textContent = cfg.submit || 'Save';
    $('#formError').textContent = '';
    $('#dialogFields').innerHTML = cfg.fields.map(function (f, i) {
      var id = 'fld_' + f.name, v = f.value == null ? '' : f.value, ctl;
      var common = ' id="' + id + '" name="' + f.name + '"' + (f.required ? ' required aria-required="true"' : '') + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '');
      if (f.type === 'textarea') ctl = '<textarea' + common + ' rows="' + (f.rows || 4) + '">' + esc(v) + '</textarea>';
      else if (f.type === 'select') ctl = '<select' + common + '>' + f.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
      else ctl = '<input type="' + (f.type || 'text') + '"' + common + ' value="' + esc(v) + '"' + (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') + (f.type === 'number' ? ' inputmode="numeric"' : '') + '>';
      return '<div class="field' + (f.half ? ' half' : '') + '"><label for="' + id + '">' + esc(f.label) + '</label>' + ctl + (f.hint ? '<small>' + esc(f.hint) + '</small>' : '') + '</div>';
    }).join('');
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    var first = $('#dialogFields input, #dialogFields textarea, #dialogFields select');
    if (first) first.focus();
  }
  function closeForm() {
    var dlg = $('#formDialog');
    if (dlg.open && typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
    dialogCfg = null;
  }
  function bindDialog() {
    $('#dialogForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!dialogCfg) return closeForm();
      var vals = {}, missing = null;
      dialogCfg.fields.forEach(function (f) {
        var el = $('#fld_' + f.name);
        vals[f.name] = el ? el.value.trim() : '';
        if (f.required && !vals[f.name] && !missing) missing = f;
      });
      if (missing) { $('#formError').textContent = missing.label + ' is required.'; $('#fld_' + missing.name).focus(); return; }
      var cfg = dialogCfg;
      closeForm();
      cfg.onSave(vals);
    });
    $('#dialogCancel').addEventListener('click', closeForm);
    $('#formDialog').addEventListener('close', function () { dialogCfg = null; });
  }

  /* ---------- rendering helpers ---------- */
  function tag(text, cls) { return '<span class="tag ' + (cls || '') + '">' + esc(text) + '</span>'; }
  function sampleTag(x) { return x && x.sample ? tag('Sample', 'sample') : ''; }
  function iconBtn(act, id, label, path) {
    return '<button type="button" class="icon-btn" data-act="' + act + '" data-id="' + esc(id) + '" aria-label="' + esc(label) + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg></button>';
  }
  var ICON = {
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    del: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    right: '<path d="M9 6l6 6-6 6"/>'
  };
  function head(eyebrow, title, sub, actions) {
    return '<header class="view-head"><div><p class="eyebrow mono">' + esc(eyebrow) + '</p><h1>' + esc(title) + '</h1>' +
      (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' + (actions ? '<div class="head-actions">' + actions + '</div>' : '') + '</header>';
  }
  function empty(text) { return '<p class="empty">' + esc(text) + '</p>'; }
  function bar(pct, cls) { return '<span class="bar ' + (cls || '') + '" role="presentation"><i style="--w:' + clamp(pct, 0, 100) + '%"></i></span>'; }
  function greeting() { var h = hourNow(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

  function commitmentRow(c) {
    var t = today(), late = !c.done && c.due && c.due < t;
    return '<li class="item' + (late ? ' late' : '') + (c.done ? ' done' : '') + '">' +
      '<button type="button" class="check" role="checkbox" aria-checked="' + (c.done ? 'true' : 'false') + '" data-act="toggle" data-id="' + c.id + '" aria-label="' + esc((c.done ? 'Mark not done: ' : 'Mark done: ') + c.what) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9"/></svg></button>' +
      '<div class="item-main"><p class="item-title">' + esc(c.what) + '</p><p class="item-meta mono">' +
      (c.who ? '<span>To ' + esc(c.who) + '</span>' : '') +
      '<span class="due">' + (c.done ? 'Done ' + esc(ago(c.doneOn)) : esc(dueLabel(c.due)) + (c.due ? ' · ' + esc(fmtDate(c.due)) : '')) + '</span>' +
      sampleTag(c) + '</p></div>' +
      '<div class="item-actions">' + iconBtn('editC', c.id, 'Edit ' + c.what, ICON.edit) + iconBtn('delC', c.id, 'Delete ' + c.what, ICON.del) + '</div></li>';
  }

  /* ---------- screens ---------- */
  var commitFilter = 'open';
  var screens = {};

  screens.today = function () {
    var t = today(), o = overdue(), d = dueToday(), w = dueWeek(), ns = nextStep(), name = state.profile.name || 'Roshan';
    var line;
    if (!o.length && !d.length) line = w.length ? 'Nothing is overdue or due today. ' + plural(w.length, 'promise') + ' due later this week.' : 'Your slate is clear. Nothing is overdue or due today.';
    else line = 'You have ' + (o.length ? plural(o.length, 'overdue promise') : '') + (o.length && d.length ? ' and ' : '') + (d.length ? plural(d.length, 'promise') + ' due today' : '') + '.';
    var deck = o.concat(d).slice(0, 5);
    return '<section class="today">' +
      '<div class="hero">' +
        '<div class="orb-stage"><button type="button" class="orb-btn" id="orbBtn" data-act="orb" aria-label="Talk to Jarvis"><canvas id="coreOrb" aria-hidden="true"></canvas></button>' +
        '<p class="orb-caption mono" id="orbCaption" aria-hidden="true">Tap to talk</p></div>' +
        '<div class="hero-text">' +
          '<p class="eyebrow mono">' + esc(longDate(t)) + ' · Dubai</p>' +
          '<h1 class="greet">' + esc(greeting()) + ', ' + esc(name) + '</h1>' +
          '<p class="lead">' + esc(line) + '</p>' +
          '<div class="hero-actions"><button type="button" class="btn primary" data-act="talk"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>Talk to Jarvis</button>' +
          '<button type="button" class="btn ghost" data-act="say" data-say="brief me">Brief me</button></div>' +
          '<p class="hint">Tap the core or press <kbd>J</kbd>, then try <q>what\'s due today</q>.</p>' +
          '<p class="voice-line mono" id="voiceLine" aria-live="polite"></p>' +
        '</div>' +
      '</div>' +
      '<div class="stats">' +
        '<a class="stat panel' + (o.length ? ' red' : '') + '" href="#commitments"><span class="label mono">Overdue</span><b class="num mono" data-count="' + o.length + '">' + o.length + '</b><small>past their date</small></a>' +
        '<a class="stat panel" href="#commitments"><span class="label mono">Due today</span><b class="num mono" data-count="' + d.length + '">' + d.length + '</b><small>' + esc(fmtDate(t)) + '</small></a>' +
        '<a class="stat panel" href="#commitments"><span class="label mono">This week</span><b class="num mono" data-count="' + w.length + '">' + w.length + '</b><small>through ' + esc(fmtDate(weekEnd(t), { weekday: 'long', day: undefined, month: undefined })) + '</small></a>' +
      '</div>' +
      '<div class="grid-2">' +
        '<article class="panel next' + (ns.tone === 'red' ? ' red' : '') + '"><h2 class="label mono">Suggested next step</h2><p class="next-text">' + esc(ns.text) + '</p>' +
          '<a class="btn small" href="#' + ns.view + '">' + esc(ns.label) + '</a></article>' +
        '<article class="panel"><h2 class="label mono">On deck</h2>' +
          (deck.length ? '<ul class="items compact">' + deck.map(commitmentRow).join('') + '</ul>' : empty('Nothing overdue or due today.')) +
        '</article>' +
      '</div>' +
    '</section>';
  };

  screens.commitments = function () {
    var t = today(), we = weekEnd(t);
    var list = state.commitments.filter(function (c) { return commitFilter === 'all' || (commitFilter === 'done' ? c.done : !c.done); });
    var groups = [
      ['Overdue', function (c) { return !c.done && c.due && c.due < t; }, 'red'],
      ['Today', function (c) { return !c.done && c.due === t; }],
      ['This week', function (c) { return !c.done && c.due > t && c.due <= we; }],
      ['Later', function (c) { return !c.done && c.due > we; }],
      ['No date', function (c) { return !c.done && !c.due; }],
      ['Done', function (c) { return c.done; }]
    ];
    var body = groups.map(function (g) {
      var items = list.filter(g[1]);
      if (g[0] === 'Done') items.sort(function (a, b) { return (b.doneOn || '').localeCompare(a.doneOn || ''); });
      else items.sort(byDue);
      if (!items.length) return '';
      return '<section class="group' + (g[2] ? ' ' + g[2] : '') + '"><h2 class="label mono">' + g[0] + ' <span>' + items.length + '</span></h2><ul class="items">' + items.map(commitmentRow).join('') + '</ul></section>';
    }).join('');
    var tabs = [['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(function (f) {
      return '<button type="button" class="seg' + (commitFilter === f[0] ? ' on' : '') + '" aria-pressed="' + (commitFilter === f[0]) + '" data-act="filter" data-id="' + f[0] + '">' + f[1] + '</button>';
    }).join('');
    return head('Promises', 'Commitments', 'Every promise you make: what, to whom and by when.', '<button type="button" class="btn" data-act="addC">Add commitment</button>') +
      '<form class="panel capture" data-form="capture" autocomplete="off">' +
        '<label class="label mono" for="capIn">Quick capture</label>' +
        '<div class="capture-row"><input id="capIn" type="text" placeholder="I\'ll send the report to Omar by Friday" enterkeyhint="done"><button type="submit" class="btn primary">Add</button></div>' +
        '<p class="cap-preview mono" id="capPreview" aria-live="polite">Type a promise in plain English. Jarvis finds the person and the date.</p>' +
      '</form>' +
      '<div class="toolbar"><div class="segs" role="group" aria-label="Show">' + tabs + '</div></div>' +
      (body || empty(commitFilter === 'done' ? 'Nothing completed yet.' : 'No open promises. Capture one above.'));
  };

  screens.growth = function () {
    var g = state.profile.goal;
    var skills = state.skills.map(function (s) {
      var i = skillInfo(s);
      return '<article class="panel skill' + (i.stale ? ' red' : '') + '">' +
        '<div class="skill-top"><h3>' + esc(s.name) + '</h3>' + sampleTag(s) + '</div>' +
        '<p class="skill-status mono">' + (i.stale ? '<span class="dot red"></span>No new win for ' + Math.floor(i.since / 7) + ' weeks' : '<span class="dot"></span>Active') + '</p>' +
        '<div class="meter"><span class="mono">Momentum</span>' + bar(i.momentum, i.stale ? 'red' : '') + '<span class="mono">' + i.momentum + '%</span></div>' +
        '<p class="skill-meta mono"><span>' + plural(i.wins, 'win') + '</span><span>Last: ' + esc(ago(i.last)) + '</span></p>' +
        '<div class="item-actions">' + iconBtn('editSkill', s.id, 'Rename ' + s.name, ICON.edit) + iconBtn('delSkill', s.id, 'Delete ' + s.name, ICON.del) + '</div>' +
      '</article>';
    }).join('');
    var wins = state.wins.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    var skillOpts = '<option value="">No skill</option>' + state.skills.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('');
    return head('Growth', 'Growth', 'Your goal, the skills you are building, and the proof.', '<button type="button" class="btn" data-act="addSkill">Add skill</button>') +
      '<article class="panel goal"><h2 class="label mono">My goal</h2><p class="goal-text">' + (g ? esc(g) : '<span class="muted">No goal yet. Add one so Jarvis can match opportunities to it.</span>') + ' ' + (state.profile.goalSample ? tag('Sample', 'sample') : '') + '</p>' +
        '<button type="button" class="btn small ghost" data-act="editGoal">Edit goal</button></article>' +
      '<h2 class="section-title">Skills I am building</h2>' +
      '<p class="section-note">A skill turns <span class="red-text">red</span> after 6 weeks with no new win.</p>' +
      (skills ? '<div class="skills">' + skills + '</div>' : empty('No skills yet. Add the skills that move you toward your goal.')) +
      '<h2 class="section-title">Wins log</h2>' +
      '<form class="panel win-form" data-form="win" autocomplete="off">' +
        '<div class="field grow"><label for="winText">Achievement</label><input id="winText" type="text" placeholder="Cut cloud costs by 12%"></div>' +
        '<div class="field"><label for="winSkill">Skill</label><select id="winSkill">' + skillOpts + '</select></div>' +
        '<div class="field"><label for="winDate">Date</label><input id="winDate" type="date" value="' + today() + '"></div>' +
        '<button type="submit" class="btn primary">Log win</button>' +
      '</form>' +
      (wins.length ? '<ul class="items wins">' + wins.map(function (w) {
        var s = skillById(w.skillId);
        return '<li class="item"><span class="win-mark" aria-hidden="true"></span><div class="item-main"><p class="item-title">' + esc(w.text) + '</p><p class="item-meta mono"><span>' + esc(fmtDate(w.date)) + '</span>' + (s ? '<span>' + esc(s.name) + '</span>' : '') + sampleTag(w) + '</p></div>' +
          '<div class="item-actions">' + iconBtn('editWin', w.id, 'Edit win', ICON.edit) + iconBtn('delWin', w.id, 'Delete win', ICON.del) + '</div></li>';
      }).join('') + '</ul>' : empty('No wins logged yet. Say "log a win" to Jarvis.'));
  };

  screens.opportunities = function () {
    var active = state.opps.filter(function (o) { return o.stage !== 'done'; });
    var avg = active.length ? Math.round(active.reduce(function (s, o) { return s + matchScore(o); }, 0) / active.length) : 0;
    var cols = STAGES.map(function (st, si) {
      var items = state.opps.filter(function (o) { return (o.stage || 'interested') === st[0]; })
        .sort(function (a, b) { return matchScore(b) - matchScore(a); });
      return '<section class="col"><h2 class="label mono">' + st[1] + ' <span>' + items.length + '</span></h2>' +
        (items.length ? items.map(function (o) {
          var sc = matchScore(o), level = sc >= 75 ? 'high' : sc >= 55 ? 'mid' : 'low';
          return '<article class="panel opp">' +
            '<div class="opp-top"><span class="tag">' + esc(kindName(o.kind)) + '</span>' + sampleTag(o) + '</div>' +
            '<h3>' + esc(o.name) + '</h3>' + (o.org ? '<p class="opp-org">' + esc(o.org) + '</p>' : '') +
            '<div class="meter"><span class="mono">Match</span>' + bar(sc, level) + '<span class="mono">' + sc + '%</span></div>' +
            (o.value ? '<p class="opp-value mono">' + esc(aed(+o.value)) + '</p>' : '') +
            (o.note ? '<p class="opp-note">' + esc(o.note) + '</p>' : '') +
            '<div class="item-actions">' +
              (si > 0 ? iconBtn('stageBack', o.id, 'Move ' + o.name + ' back to ' + STAGES[si - 1][1], ICON.left) : '') +
              (si < STAGES.length - 1 ? iconBtn('stageFwd', o.id, 'Move ' + o.name + ' to ' + STAGES[si + 1][1], ICON.right) : '') +
              iconBtn('editOpp', o.id, 'Edit ' + o.name, ICON.edit) + iconBtn('delOpp', o.id, 'Delete ' + o.name, ICON.del) +
            '</div></article>';
        }).join('') : '<p class="empty small">None</p>') + '</section>';
    }).join('');
    return head('Pipeline', 'Opportunities', 'Jobs, projects and courses, scored against your goal and skills.', '<button type="button" class="btn" data-act="addOpp">Add opportunity</button>') +
      '<div class="stats small">' +
        '<div class="stat panel"><span class="label mono">Active</span><b class="num mono" data-count="' + active.length + '">' + active.length + '</b></div>' +
        '<div class="stat panel"><span class="label mono">Average match</span><b class="num mono"><span data-count="' + avg + '">' + avg + '</span>%</b></div>' +
        '<div class="stat panel"><span class="label mono">Done</span><b class="num mono" data-count="' + (state.opps.length - active.length) + '">' + (state.opps.length - active.length) + '</b></div>' +
      '</div>' +
      '<div class="board">' + cols + '</div>';
  };

  screens.review = function () {
    var r = weekReview();
    function list(items, fn, none) { return items.length ? '<ul class="plain">' + items.map(fn).join('') + '</ul>' : empty(none); }
    return head('Every Friday', 'Weekly review', 'Week of ' + esc(fmtDate(r.start, { weekday: undefined })) + ' to ' + esc(fmtDate(r.end, { weekday: undefined })) + ' (Monday to Friday).', '<button type="button" class="btn" data-act="say" data-say="how was my week">Read it to me</button>') +
      '<div class="stats">' +
        '<div class="stat panel gold"><span class="label mono">Wins</span><b class="num mono" data-count="' + r.wins.length + '">' + r.wins.length + '</b><small>logged this week</small></div>' +
        '<div class="stat panel"><span class="label mono">Promises kept</span><b class="num mono" data-count="' + r.kept.length + '">' + r.kept.length + '</b><small>completed this week</small></div>' +
        '<div class="stat panel' + (r.slipped.length ? ' red' : '') + '"><span class="label mono">Slipped</span><b class="num mono" data-count="' + r.slipped.length + '">' + r.slipped.length + '</b><small>past their date</small></div>' +
      '</div>' +
      '<div class="grid-3">' +
        '<article class="panel"><h2 class="label mono">Wins</h2>' + list(r.wins, function (w) { return '<li>' + esc(w.text) + ' <span class="mono muted">' + esc(fmtDate(w.date)) + '</span></li>'; }, 'No wins logged yet this week.') + '</article>' +
        '<article class="panel"><h2 class="label mono">Promises kept</h2>' + list(r.kept, function (c) { return '<li>' + esc(c.what) + (c.who ? ' <span class="muted">to ' + esc(c.who) + '</span>' : '') + '</li>'; }, 'Nothing completed yet this week.') + '</article>' +
        '<article class="panel"><h2 class="label mono">What slipped</h2>' + list(r.slipped, function (c) { return '<li class="red-text">' + esc(c.what) + ' <span class="mono">' + esc(dueLabel(c.due)) + '</span></li>'; }, 'Nothing slipped. Well done.') + '</article>' +
      '</div>' +
      '<article class="panel next' + (r.next.tone === 'red' ? ' red' : '') + '"><h2 class="label mono">One next step</h2><p class="next-text">' + esc(r.next.text) + '</p><a class="btn small" href="#' + r.next.view + '">' + esc(r.next.label) + '</a></article>';
  };

  screens.approvals = function () {
    var pending = pendingDrafts();
    var done = state.drafts.filter(function (d) { return d.status !== 'pending'; });
    function card(d) {
      return '<article class="panel draft ' + d.status + '">' +
        '<div class="draft-top"><p class="mono"><span class="muted">To</span> ' + esc(d.to || '—') + '</p>' + sampleTag(d) + (d.status !== 'pending' ? tag(d.status === 'approved' ? 'Approved' : 'Rejected', d.status) : '') + '</div>' +
        '<h3>' + esc(d.subject || 'No subject') + '</h3><p class="draft-body">' + esc(d.body) + '</p>' +
        '<div class="draft-actions">' + (d.status === 'pending' ?
          '<button type="button" class="btn primary small" data-act="approve" data-id="' + d.id + '">Approve</button>' +
          '<button type="button" class="btn small" data-act="editDraft" data-id="' + d.id + '">Edit</button>' +
          '<button type="button" class="btn ghost small" data-act="reject" data-id="' + d.id + '">Reject</button>' :
          (d.status === 'approved' ? '<button type="button" class="btn small" data-act="copyDraft" data-id="' + d.id + '">Copy text</button>' : '') +
          '<button type="button" class="btn ghost small" data-act="reopenDraft" data-id="' + d.id + '">Move back to pending</button>' +
          '<button type="button" class="btn ghost small" data-act="delDraft" data-id="' + d.id + '">Delete</button>') +
        '</div></article>';
    }
    return head('Nothing goes out without you', 'Approvals', 'Draft messages to approve, edit or reject. Approving copies the text so you can send it yourself.', '<button type="button" class="btn" data-act="addDraft">New draft</button>') +
      (pending.length ? '<div class="drafts">' + pending.map(card).join('') + '</div>' : empty('No drafts waiting. You are all caught up.')) +
      (done.length ? '<details class="history"><summary>History (' + done.length + ')</summary><div class="drafts">' + done.map(card).join('') + '</div></details>' : '');
  };

  screens.profile = function () {
    var p = state.profile, s = state.settings;
    return head('About you', 'My profile', 'Jarvis uses this to brief you and to score opportunities.', '') +
      '<div class="grid-2">' +
        '<article class="panel"><h2 class="label mono">Me</h2>' +
          '<p class="profile-name">' + esc(p.name) + '</p>' +
          '<p><span class="muted">Goal:</span> ' + (p.goal ? esc(p.goal) : '<span class="muted">Not set</span>') + ' ' + (p.goalSample ? tag('Sample', 'sample') : '') + '</p>' +
          '<button type="button" class="btn small ghost" data-act="editMe">Edit name and goal</button></article>' +
        '<article class="panel"><h2 class="label mono">Strengths</h2>' +
          '<ul class="chips">' + (p.strengths.length ? p.strengths.map(function (x) {
            return '<li class="chip' + (x.sample ? ' is-sample' : '') + '">' + esc(x.name) + (x.sample ? ' <small>Sample</small>' : '') + '<button type="button" data-act="delStrength" data-id="' + x.id + '" aria-label="Remove ' + esc(x.name) + '">×</button></li>';
          }).join('') : '<li class="muted">None yet</li>') + '</ul>' +
          '<form class="inline-form" data-form="strength" autocomplete="off"><label class="sr-only" for="strengthIn">New strength</label><input id="strengthIn" type="text" placeholder="Add a strength"><button type="submit" class="btn small">Add</button></form>' +
        '</article>' +
      '</div>' +
      '<article class="panel"><div class="panel-head"><h2 class="label mono">Important people</h2><button type="button" class="btn small" data-act="addPerson">Add person</button></div>' +
        (p.people.length ? '<ul class="items people">' + p.people.map(function (x) {
          return '<li class="item"><span class="avatar mono" aria-hidden="true">' + esc((x.name || '?').charAt(0).toUpperCase()) + '</span><div class="item-main"><p class="item-title">' + esc(x.name) + ' <span class="muted">' + esc(x.role || '') + '</span></p>' +
            (x.note || x.sample ? '<p class="item-meta">' + esc(x.note || '') + ' ' + sampleTag(x) + '</p>' : '') + '</div>' +
            '<div class="item-actions">' + iconBtn('editPerson', x.id, 'Edit ' + x.name, ICON.edit) + iconBtn('delPerson', x.id, 'Delete ' + x.name, ICON.del) + '</div></li>';
        }).join('') + '</ul>' : empty('Add your manager, mentors, sponsors and key peers. Jarvis recognises their names in quick capture.')) +
      '</article>' +
      '<div class="grid-2">' +
        '<article class="panel"><h2 class="label mono">Voice</h2>' +
          '<div class="field"><label for="voiceSelect">Jarvis voice</label><select id="voiceSelect" data-setting="voice"><option value="">Automatic (British English male if available)</option></select></div>' +
          '<div class="field"><label for="rateSelect">Speaking speed</label><select id="rateSelect" data-setting="rate">' +
            [['0.9', 'Slower'], ['1', 'Normal'], ['1.1', 'Faster']].map(function (o) { return '<option value="' + o[0] + '"' + (String(s.rate) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
          '<label class="switch block"><input type="checkbox" data-hey' + (s.hey ? ' checked' : '') + '><span aria-hidden="true"></span>"Hey Jarvis" mode: keep listening while this page is open</label>' +
          '<label class="switch block"><input type="checkbox" data-speak' + (s.speak ? ' checked' : '') + '><span aria-hidden="true"></span>Speak replies out loud</label>' +
          '<p class="muted small-text" id="voiceSupport"></p>' +
        '</article>' +
        '<article class="panel"><h2 class="label mono">Your data</h2>' +
          '<p>Everything is saved only in this browser on this device. Export a backup regularly.</p>' +
          '<div class="btn-row"><button type="button" class="btn" data-act="export">Export backup</button><button type="button" class="btn" data-act="import">Import backup</button></div>' +
          '<div class="btn-row">' + (hasSample() ? '<button type="button" class="btn ghost" data-act="clearSample">Clear sample data</button>' : '') +
          '<button type="button" class="btn ghost danger" data-act="resetAll">Delete all data</button></div>' +
        '</article>' +
      '</div>';
  };

  /* ---------- render ---------- */
  var main, current = 'today';
  function render(animate) {
    if (!main) return;
    main.innerHTML = screens[current]();
    main.classList.remove('enter');
    if (animate && !calm()) { void main.offsetWidth; main.classList.add('enter'); }
    $$('[data-view]').forEach(function (a) {
      if (a.getAttribute('data-view') === current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('#crumbView').textContent = VIEWS[current];
    document.title = (current === 'today' ? 'Jarvis' : VIEWS[current] + ' · Jarvis');
    countUps(animate);
    badges();
    $('#sampleBanner').hidden = !hasSample();
    document.dispatchEvent(new CustomEvent('jarvis:rendered', { detail: { view: current } }));
  }
  function badges() {
    var counts = { overdue: overdue().length, drafts: pendingDrafts().length };
    $$('[data-badge]').forEach(function (el) {
      var n = counts[el.getAttribute('data-badge')];
      el.hidden = !n; el.textContent = n || '';
      el.setAttribute('aria-label', n ? n + (el.getAttribute('data-badge') === 'overdue' ? ' overdue' : ' waiting') : '');
    });
  }
  function countUps(animate) {
    $$('[data-count]', main).forEach(function (el) {
      var to = +el.getAttribute('data-count') || 0;
      if (!animate || calm() || !to) { el.textContent = to; return; }
      el.textContent = '0';
      var t0 = null, dur = 900;
      function step(ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }
  function go(view) {
    if (!VIEWS[view]) return;
    if (location.hash === '#' + view) { current = view; render(true); }
    else location.hash = view;
  }
  function route(initial) {
    var h = location.hash.slice(1);
    if (!VIEWS[h]) { if (h && h !== 'main') return; if (!initial) return; h = 'today'; }
    current = h;
    render(true);
    if (!initial) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
    closeMore();
  }

  /* ---------- import / export ---------- */
  function exportData() {
    var blob = new Blob([JSON.stringify({ app: 'jarvis', exported: today(), data: state }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'jarvis-backup-' + today() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('Backup downloaded.');
  }
  function importData(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var parsed = JSON.parse(r.result);
        var d = parsed && parsed.data ? parsed.data : parsed;
        if (!d || !Array.isArray(d.commitments)) throw new Error('bad');
        if (!confirm('Replace all data in this browser with this backup?')) return;
        snapshot();
        state = normalize(d);
        save();
        toast('Backup imported.', true);
      } catch (e) { toast('That file is not a Jarvis backup.'); }
    };
    r.readAsText(file);
  }

  /* ---------- More sheet (phones) ---------- */
  function closeMore() {
    var s = $('#moreSheet'), b = $('#moreBtn');
    if (s && !s.hidden) { s.hidden = true; b.setAttribute('aria-expanded', 'false'); }
  }

  /* ---------- events ---------- */
  function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }
  function removeById(key, id, label) {
    snapshot();
    state[key] = state[key].filter(function (x) { return x.id !== id; });
    save();
    toast(label + ' deleted.', true);
  }
  function commitmentForm(c) {
    var people = knownPeople();
    openForm({
      title: c ? 'Edit commitment' : 'Add commitment',
      fields: [
        { name: 'what', label: 'What', value: c && c.what, required: true, placeholder: 'Send the report' },
        { name: 'who', label: 'To whom', value: c && c.who, placeholder: people[0] || 'Omar', half: true },
        { name: 'due', label: 'When', type: 'date', value: c && c.due, half: true }
      ],
      onSave: function (v) {
        if (c) { Object.assign(c, { what: cap(v.what), who: v.who, due: v.due }); save(); toast('Commitment updated.'); }
        else { addCommitment(v); toast('Commitment added.'); }
      }
    });
  }
  function oppForm(o) {
    openForm({
      title: o ? 'Edit opportunity' : 'Add opportunity',
      fields: [
        { name: 'name', label: 'Name', value: o && o.name, required: true, placeholder: 'Head of Engineering' },
        { name: 'kind', label: 'Type', type: 'select', options: KINDS, value: o ? o.kind : 'job', half: true },
        { name: 'stage', label: 'Stage', type: 'select', options: STAGES, value: o ? o.stage : 'interested', half: true },
        { name: 'org', label: 'Organisation', value: o && o.org, placeholder: 'Company or provider' },
        { name: 'tags', label: 'Skills it needs', value: o && o.tags, placeholder: 'leadership, cloud, finance', hint: 'Comma separated. Used for the match score.' },
        { name: 'score', label: 'Match score override (0–100)', type: 'number', min: 0, max: 100, value: o && o.score, hint: 'Leave empty to let Jarvis score it.', half: true },
        { name: 'value', label: 'Value in AED', type: 'number', min: 0, value: o && o.value, hint: 'Salary, fee or saving.', half: true },
        { name: 'note', label: 'Notes', type: 'textarea', rows: 3, value: o && o.note }
      ],
      onSave: function (v) {
        v.score = v.score === '' ? '' : clamp(+v.score, 0, 100);
        v.value = v.value === '' ? '' : Math.max(0, +v.value);
        if (o) { Object.assign(o, v, { name: cap(v.name) }); save(); toast('Opportunity updated.'); }
        else { var n = addOpp(v); n.score = v.score; save(); toast('Opportunity added.'); }
      }
    });
  }

  var actions = {
    talk: function () { if (window.JarvisVoice) JarvisVoice.listen(); },
    orb: function () { if (window.JarvisVoice) JarvisVoice.orbTap(); },
    say: function (id, el) { if (window.JarvisVoice) JarvisVoice.run(el.getAttribute('data-say')); },
    undo: function () { undo(); },
    export: exportData,
    import: function () { closeMore(); $('#importFile').click(); },
    clearSample: function () { if (confirm('Remove all sample items? Your own items stay.')) clearSample(); },
    resetAll: function () {
      if (!confirm('Delete ALL Jarvis data in this browser? Export a backup first if you need it.')) return;
      snapshot();
      var settings = state.settings;
      state = blank(); state.settings = settings;
      save();
      toast('All data deleted.', true);
    },
    filter: function (id) { commitFilter = id; render(false); },
    toggle: function (id) {
      var c = byId(state.commitments, id); if (!c) return;
      setDone(id, !c.done);
      toast(c.done ? 'Done: ' + c.what : 'Reopened: ' + c.what);
    },
    addC: function () { commitmentForm(null); },
    editC: function (id) { commitmentForm(byId(state.commitments, id)); },
    delC: function (id) { removeById('commitments', id, 'Commitment'); },
    editGoal: function () { actions.editMe(); },
    editMe: function () {
      var p = state.profile;
      openForm({
        title: 'Name and goal',
        fields: [{ name: 'name', label: 'Name', value: p.name, required: true }, { name: 'goal', label: 'My goal', type: 'textarea', rows: 3, value: p.goal, placeholder: 'Where do you want to be in two years?' }],
        onSave: function (v) {
          if (v.goal !== p.goal) p.goalSample = false;
          p.name = v.name; p.goal = v.goal; save(); toast('Profile saved.');
        }
      });
    },
    addSkill: function () {
      openForm({ title: 'Add skill', fields: [{ name: 'name', label: 'Skill', required: true, placeholder: 'Negotiation' }], onSave: function (v) {
        state.skills.push({ id: uid(), name: cap(v.name), created: today() }); save(); toast('Skill added.');
      } });
    },
    editSkill: function (id) {
      var s = byId(state.skills, id); if (!s) return;
      openForm({ title: 'Rename skill', fields: [{ name: 'name', label: 'Skill', value: s.name, required: true }], onSave: function (v) { s.name = cap(v.name); save(); } });
    },
    delSkill: function (id) {
      var s = byId(state.skills, id); if (!s) return;
      if (skillWins(id).length && !confirm('Delete "' + s.name + '"? Its wins stay in the log without a skill.')) return;
      snapshot();
      state.skills = state.skills.filter(function (x) { return x.id !== id; });
      state.wins.forEach(function (w) { if (w.skillId === id) w.skillId = ''; });
      save(); toast('Skill deleted.', true);
    },
    editWin: function (id) {
      var w = byId(state.wins, id); if (!w) return;
      openForm({
        title: 'Edit win',
        fields: [{ name: 'text', label: 'Achievement', value: w.text, required: true },
          { name: 'skillId', label: 'Skill', type: 'select', value: w.skillId, options: [['', 'No skill']].concat(state.skills.map(function (s) { return [s.id, s.name]; })), half: true },
          { name: 'date', label: 'Date', type: 'date', value: w.date, required: true, half: true }],
        onSave: function (v) { Object.assign(w, v, { text: cap(v.text) }); save(); }
      });
    },
    delWin: function (id) { removeById('wins', id, 'Win'); },
    addOpp: function () { oppForm(null); },
    editOpp: function (id) { oppForm(byId(state.opps, id)); },
    delOpp: function (id) { removeById('opps', id, 'Opportunity'); },
    stageFwd: function (id) { moveStage(id, 1); },
    stageBack: function (id) { moveStage(id, -1); },
    addDraft: function () { draftForm(null); },
    editDraft: function (id) { draftForm(byId(state.drafts, id)); },
    approve: function (id) {
      var d = byId(state.drafts, id); if (!d) return;
      d.status = 'approved'; d.decided = today(); save();
      copyText(draftText(d), 'Approved and copied. Paste it into your email or chat.');
    },
    reject: function (id) { var d = byId(state.drafts, id); if (!d) return; snapshot(); d.status = 'rejected'; d.decided = today(); save(); toast('Draft rejected.', true); },
    reopenDraft: function (id) { var d = byId(state.drafts, id); if (!d) return; d.status = 'pending'; save(); },
    copyDraft: function (id) { var d = byId(state.drafts, id); if (d) copyText(draftText(d), 'Copied.'); },
    delDraft: function (id) { removeById('drafts', id, 'Draft'); },
    delStrength: function (id) {
      snapshot();
      state.profile.strengths = state.profile.strengths.filter(function (x) { return x.id !== id; });
      save(); toast('Strength removed.', true);
    },
    addPerson: function () { personForm(null); },
    editPerson: function (id) { personForm(byId(state.profile.people, id)); },
    delPerson: function (id) {
      snapshot();
      state.profile.people = state.profile.people.filter(function (x) { return x.id !== id; });
      save(); toast('Person removed.', true);
    }
  };
  function moveStage(id, dir) {
    var o = byId(state.opps, id); if (!o) return;
    var i = STAGES.map(function (s) { return s[0]; }).indexOf(o.stage || 'interested');
    var n = clamp(i + dir, 0, STAGES.length - 1);
    o.stage = STAGES[n][0]; save();
    toast(o.name + ' moved to ' + STAGES[n][1] + '.');
    var btn = $('[data-act="' + (dir > 0 ? 'stageFwd' : 'stageBack') + '"][data-id="' + id + '"]') || $('[data-act="editOpp"][data-id="' + id + '"]');
    if (btn) btn.focus();
  }
  function draftText(d) { return (d.subject ? 'Subject: ' + d.subject + '\n\n' : '') + d.body; }
  function copyText(text, msg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      toast(ok ? msg : 'Approved. Copy the text from the card.');
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast(msg); }, fallback);
    else fallback();
  }
  function draftForm(d) {
    openForm({
      title: d ? 'Edit draft' : 'New draft',
      fields: [{ name: 'to', label: 'To', value: d && d.to, required: true, half: true }, { name: 'subject', label: 'Subject', value: d && d.subject, half: true },
        { name: 'body', label: 'Message', type: 'textarea', rows: 8, value: d && d.body, required: true }],
      onSave: function (v) {
        if (d) { Object.assign(d, v); save(); toast('Draft saved.'); }
        else { state.drafts.push({ id: uid(), to: v.to, subject: v.subject, body: v.body, status: 'pending' }); save(); toast('Draft added to Approvals.'); }
      }
    });
  }
  function personForm(x) {
    openForm({
      title: x ? 'Edit person' : 'Add person',
      fields: [{ name: 'name', label: 'Name', value: x && x.name, required: true, half: true }, { name: 'role', label: 'Role', value: x && x.role, placeholder: 'Manager, mentor, sponsor…', half: true },
        { name: 'note', label: 'Note', type: 'textarea', rows: 3, value: x && x.note }],
      onSave: function (v) {
        if (x) Object.assign(x, v); else state.profile.people.push({ id: uid(), name: titleCase(v.name), role: v.role, note: v.note });
        save();
      }
    });
  }

  function updatePreview() {
    var inp = $('#capIn'), out = $('#capPreview');
    if (!inp || !out) return;
    var v = inp.value.trim();
    if (!v) { out.textContent = 'Type a promise in plain English. Jarvis finds the person and the date.'; return; }
    var p = parseCapture(v);
    out.innerHTML = '<span>What: <b>' + esc(p.what || '—') + '</b></span><span>Who: <b>' + esc(p.who || '—') + '</b></span><span>When: <b>' + esc(p.due ? fmtDate(p.due) : 'No date') + '</b></span>';
  }

  function bind() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el || el.tagName === 'INPUT') return;
      var fn = actions[el.getAttribute('data-act')];
      if (!fn) return;
      e.preventDefault();
      fn(el.getAttribute('data-id'), el);
    });
    document.addEventListener('submit', function (e) {
      var f = e.target.closest('[data-form]');
      if (!f) return;
      e.preventDefault();
      var kind = f.getAttribute('data-form');
      if (kind === 'capture') {
        var v = $('#capIn').value.trim();
        if (!v) { $('#capIn').focus(); return; }
        var p = parseCapture(v);
        if (!p.what) { toast('Add what you promised.'); return; }
        addCommitment(p);
        toast('Captured: ' + p.what + (p.who ? ' to ' + p.who : '') + (p.due ? ', ' + dueLabel(p.due).toLowerCase() : '') + '.');
        var again = $('#capIn'); if (again) again.focus();
      } else if (kind === 'win') {
        var text = $('#winText').value.trim();
        if (!text) { $('#winText').focus(); return; }
        addWin(text, $('#winSkill').value, $('#winDate').value || today());
        toast('Win logged.');
        var w = $('#winText'); if (w) w.focus();
      } else if (kind === 'strength') {
        var s = $('#strengthIn').value.trim();
        if (!s) return;
        state.profile.strengths.push({ id: uid(), name: cap(s) });
        save();
        var si = $('#strengthIn'); if (si) si.focus();
      }
    });
    document.addEventListener('input', function (e) { if (e.target.id === 'capIn') updatePreview(); });
    document.addEventListener('change', function (e) {
      var k = e.target.getAttribute('data-setting');
      if (k) {
        state.settings[k] = k === 'rate' ? +e.target.value : e.target.value;
        persist();
        if (window.JarvisVoice) JarvisVoice.settingsChanged();
      }
    });
    $('#importFile').addEventListener('change', function () {
      if (this.files && this.files[0]) importData(this.files[0]);
      this.value = '';
    });
    $('#skipLink').addEventListener('click', function (e) { e.preventDefault(); main.focus(); });
    var more = $('#moreBtn'), sheet = $('#moreSheet');
    more.addEventListener('click', function (e) {
      e.stopPropagation();
      sheet.hidden = !sheet.hidden;
      more.setAttribute('aria-expanded', String(!sheet.hidden));
      if (!sheet.hidden) { var f = sheet.querySelector('a,button'); if (f) f.focus(); }
    });
    document.addEventListener('click', function (e) { if (!sheet.hidden && !sheet.contains(e.target) && e.target !== more) closeMore(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) { closeMore(); more.focus(); } });
    sheet.addEventListener('click', function (e) { if (e.target.closest('a')) closeMore(); });
    window.addEventListener('hashchange', function () { route(false); });
    window.addEventListener('storage', function (e) { if (e.key === KEY) { state = load(); render(false); } });
    bindDialog();
  }

  /* ---------- clock ---------- */
  var clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  var lastDay = '';
  function tick() {
    var el = $('#clock');
    if (el) {
      var p = {};
      clockFmt.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      el.textContent = p.weekday + ' ' + p.day + ' ' + p.month + '  ' + p.hour + ':' + p.minute + ':' + p.second + ' GST';
      el.setAttribute('datetime', new Date().toISOString());
    }
    var d = today();
    if (lastDay && d !== lastDay && !document.querySelector('dialog[open]')) render(false);
    lastDay = d;
  }

  /* ---------- start ---------- */
  state = load();
  main = $('#main');
  bind();
  persist();
  route(true);
  tick();
  setInterval(tick, 1000);

  window.Jarvis = {
    get state() { return state; },
    persist: persist, save: save, go: go, current: function () { return current; },
    views: VIEWS, calm: calm, toast: toast,
    today: today, hourNow: hourNow, timeNow: timeNow, longDate: longDate, spokenDate: spokenDate, fmtDate: fmtDate,
    dueLabel: dueLabel, weekEnd: weekEnd, diff: diff, plural: plural, joinList: joinList, aed: aed, greeting: greeting,
    parseDue: parseDue, parseCapture: parseCapture,
    overdue: overdue, dueToday: dueToday, dueWeek: dueWeek, pendingDrafts: pendingDrafts, staleSkills: staleSkills,
    nextStep: nextStep, weekReview: weekReview, matchScore: matchScore, stageName: stageName,
    addCommitment: addCommitment, setDone: setDone, findCommitment: findCommitment,
    addWin: addWin, addOpp: addOpp, itemPhrase: itemPhrase, spokenDue: spokenDue
  };
})();

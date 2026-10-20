/* NOVA core: storage, Asia/Dubai dates, plain-English parsing, sample data and queries.
   Plain JavaScript, no build step. Everything is kept in this browser (localStorage). */
(function () {
  'use strict';

  var J = window.J = window.J || {};
  var TZ = 'Asia/Dubai';
  var DUBAI_OFFSET = 4 * 3600e3; // Dubai has no daylight saving: always UTC+4
  var KEY = 'jarvis.v3';

  /* ---------------- helpers ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function cap(s) { s = String(s || '').trim(); return s.charAt(0).toUpperCase() + s.slice(1); }
  function titleCase(s) { return String(s || '').trim().replace(/(^|[\s(-])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function joinList(items) { return items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]; }
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function list(v) { return (Array.isArray(v) ? v : String(v || '').split(/[,;\n]+/)).map(function (x) { return String(x).trim(); }).filter(Boolean); }
  var motion = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  function calm() { return !!(motion && motion.matches); }

  /* ---------------- dates and times (Asia/Dubai) ---------------- */
  var partFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  function parts(d) {
    var o = {};
    partFmt.formatToParts(d || new Date()).forEach(function (p) { o[p.type] = p.value; });
    if (o.hour === '24') o.hour = '00';
    return o;
  }
  function today() { var p = parts(); return p.year + '-' + p.month + '-' + p.day; }
  function nowHM() { var p = parts(); return p.hour + ':' + p.minute; }
  function hourNow() { return +parts().hour; }
  function toDate(iso) { return new Date(iso + 'T12:00:00Z'); }
  function addDays(iso, n) { var d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dow(iso) { return toDate(iso).getUTCDay(); } // 0 Sun .. 6 Sat
  function diff(a, b) { return Math.round((toDate(b) - toDate(a)) / 864e5); }
  // UAE work week: Monday to Friday. Weekend: Saturday and Sunday.
  function weekStart(t) { t = t || today(); return addDays(t, -((dow(t) + 6) % 7)); }
  function weekEnd(t) { t = t || today(); return addDays(t, (5 - dow(t) + 7) % 7); }
  function isWeekend(iso) { var d = dow(iso); return d === 0 || d === 6; }
  // A Dubai wall-clock date + time as a real timestamp.
  function stamp(iso, hm) {
    var p = iso.split('-'), t = (hm || '00:00').split(':');
    return Date.UTC(+p[0], +p[1] - 1, +p[2], +t[0], +t[1]) - DUBAI_OFFSET;
  }
  function fmt(iso, o) { return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }, o || {})).format(toDate(iso)); }
  function longDate(iso) { return fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
  function spokenDate(iso) { return fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' }); }
  function fmtTime(hm) {
    if (!hm) return '';
    var t = hm.split(':'), h = +t[0], m = t[1];
    return (h % 12 || 12) + (m === '00' ? '' : ':' + m) + (h < 12 ? ' am' : ' pm');
  }
  function timeNow() { return fmtTime(nowHM()); }
  function dueLabel(iso, hm) {
    if (!iso) return 'No date';
    var n = diff(today(), iso), at = hm ? ' at ' + fmtTime(hm) : '';
    if (n === 0) return 'Today' + at;
    if (n === 1) return 'Tomorrow' + at;
    if (n === -1) return 'Yesterday' + at;
    if (n < 0) return plural(-n, 'day') + ' overdue';
    if (n < 7) return fmt(iso, { weekday: 'long', day: undefined, month: undefined }) + at;
    return fmt(iso) + at;
  }
  // dueLabel for use inside a sentence: "today at 6 pm", "Sunday", "3 days overdue".
  function when(iso, hm) { return dueLabel(iso, hm).replace(/^(Today|Tomorrow|Yesterday|No date)/, function (w) { return w.toLowerCase(); }); }
  function ago(ts) {
    if (!ts) return '';
    var s = (Date.now() - (typeof ts === 'number' ? ts : Date.parse(ts))) / 1000;
    if (isNaN(s)) return '';
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    var d = Math.floor(s / 86400);
    return d === 1 ? 'yesterday' : d < 30 ? d + ' days ago' : Math.floor(d / 30) + ' mo ago';
  }
  function isoFromTs(ts) { var p = parts(new Date(ts)); return p.year + '-' + p.month + '-' + p.day; }

  /* ---------------- understanding dates ---------------- */
  var NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };
  var MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var DAYS3 = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var DAY_RX = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday|mon|tues|tue|wed|thurs|thur|thu|fri)';
  var MON_RX = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  function makeDate(y, m, d) {
    var dt = new Date(Date.UTC(y, m, d, 12));
    return dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
  }
  function nextDay(base, idx, mod) {
    var n = (idx - dow(base) + 7) % 7;
    if (mod === 'next') {
      if (n === 0) n = 7;
      else if (!isWeekend(base) && addDays(base, n) <= weekEnd(base)) n += 7;
    }
    return addDays(base, n);
  }
  function dayMonth(day, mon, year, b) {
    var mi = MON.indexOf(mon.slice(0, 3)), y = year ? +year : +b.slice(0, 4);
    var iso = makeDate(y, mi, day);
    if (iso && !year && iso < b) iso = makeDate(y + 1, mi, day);
    return iso;
  }
  var DATE_RULES = [
    [/\bday after tomorrow\b/, function (m, b) { return addDays(b, 2); }],
    [/\b(?:today|tonight|this (?:morning|afternoon|evening)|end of (?:the )?day|eod)\b/, function (m, b) { return b; }],
    [/\btomorrow(?: (?:morning|afternoon|evening|night))?\b/, function (m, b) { return addDays(b, 1); }],
    [/\b(?:(?:the )?end of (?:the |this )?(?:work ?)?week|eow|this week)\b/, function (m, b) { return weekEnd(b); }],
    [/\bnext week\b/, function (m, b) { return addDays(weekStart(b), 7); }],
    [/\b(?:(?:the )?end of (?:the |this )?month|eom)\b/, function (m, b) { var d = toDate(b); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10); }],
    [/\bin (\d+|a couple of|a few|a|an|one|two|three|four|five|six|seven|eight|nine|ten) (day|week|month)s?\b/, function (m, b) {
      var n = /^\d+$/.test(m[1]) ? +m[1] : NUMW[m[1].replace(/^a (couple of|few)$/, '$1')] || 1;
      return addDays(b, n * (m[2] === 'week' ? 7 : m[2] === 'month' ? 30 : 1));
    }],
    [new RegExp('\\b(?:(next|this|coming) )?' + DAY_RX + '\\b'), function (m, b) { return nextDay(b, DAYS3.indexOf(m[2].slice(0, 3)), m[1]); }],
    [/\b(\d{4})-(\d{2})-(\d{2})\b/, function (m) { return makeDate(+m[1], +m[2] - 1, +m[3]); }],
    [new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?(?: of)? ' + MON_RX + '(?:,? (\\d{4}))?(?![a-z])'), function (m, b) { return dayMonth(+m[1], m[2], m[3], b); }],
    [new RegExp('\\b' + MON_RX + ' (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b'), function (m, b) { return dayMonth(+m[2], m[1], m[3], b); }],
    [/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, function (m, b) {
      var y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : +b.slice(0, 4);
      var iso = makeDate(y, +m[2] - 1, +m[1]);
      if (iso && !m[3] && iso < b) iso = makeDate(y + 1, +m[2] - 1, +m[1]);
      return iso;
    }],
    [/\bthe (\d{1,2})(?:st|nd|rd|th)\b/, function (m, b) {
      var d = toDate(b), y = d.getUTCFullYear(), mo = d.getUTCMonth(), iso = makeDate(y, mo, +m[1]);
      if (!iso || iso < b) iso = makeDate(mo === 11 ? y + 1 : y, (mo + 1) % 12, +m[1]);
      return iso;
    }]
  ];
  // Returns { date, start, end } (start/end cover the phrase, including "by", "on" ...).
  function parseDate(text, base) {
    base = base || today();
    var t = String(text || '').toLowerCase();
    for (var i = 0; i < DATE_RULES.length; i++) {
      var m = t.match(DATE_RULES[i][0]);
      if (!m) continue;
      var date = DATE_RULES[i][1](m, base);
      if (!date) continue;
      var start = m.index, end = start + m[0].length;
      var pre = t.slice(0, start).match(/(?:\b(?:by|on|before|due|until|till|for|no later than)\s+)+$/);
      if (pre) start -= pre[0].length;
      return { date: date, start: start, end: end, word: m[0] };
    }
    return null;
  }
  // Times: "at 10am", "at 3:30 pm", "at 15:00", "noon", "in 2 hours", "tonight".
  function parseTime(text) {
    var t = String(text || '').toLowerCase(), m;
    if ((m = t.match(/\b(?:at|by|@)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/))) {
      var h = +m[1] % 12 + (/p/.test(m[3]) ? 12 : 0);
      return mk(h, +(m[2] || 0), m);
    }
    if ((m = t.match(/\b(?:at|@)\s*(\d{1,2})[:.](\d{2})\b/)) || (m = t.match(/\b(\d{1,2}):(\d{2})\b/))) return mk(+m[1], +m[2], m);
    if ((m = t.match(/\bat (\d{1,2})(?! ?(?:days?|weeks?|hours?|minutes?|mins?|percent|%))\b/))) {
      var hh = +m[1];
      if (hh >= 1 && hh <= 7) hh += 12; // "at 3" during a work day means 3 pm
      return mk(hh, 0, m);
    }
    if ((m = t.match(/\b(?:at )?(noon|midday)\b/))) return mk(12, 0, m);
    if ((m = t.match(/\b(?:at )?midnight\b/))) return mk(23, 59, m);
    if ((m = t.match(/\bin (\d+|an?|one|two|three|half an) (hour|hr|minute|min)s?\b/))) {
      var n = /^\d+$/.test(m[1]) ? +m[1] : m[1] === 'half an' ? 0.5 : NUMW[m[1]] || 1;
      var mins = /^h/.test(m[2]) ? n * 60 : n;
      var at = new Date(Date.now() + mins * 60e3);
      var p = parts(at);
      return { time: p.hour + ':' + p.minute, date: p.year + '-' + p.month + '-' + p.day, start: m.index, end: m.index + m[0].length };
    }
    if ((m = t.match(/\b(?:this |tomorrow )?(morning)\b/))) return soft(9, m);
    if ((m = t.match(/\b(?:this |tomorrow )?(afternoon)\b/))) return soft(14, m);
    if ((m = t.match(/\b(?:this |tomorrow )?(evening)\b/))) return soft(18, m);
    if ((m = t.match(/\btonight\b/))) return soft(20, m);
    return null;
    function mk(h, mi, mm) {
      if (h > 23 || mi > 59) return null;
      return { time: pad(h) + ':' + pad(mi), start: mm.index, end: mm.index + mm[0].length };
    }
    function soft(h, mm) { return { time: pad(h) + ':00', start: mm.index, end: mm.index + mm[0].length, soft: true }; }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------------- quick capture ---------------- */
  var NOT_PEOPLE = /^(me|myself|you|it|them|him|her|us|this|that|do|be|go|work|home|office|the office|bed|lunch|dinner|everyone|all|time|the gym|gym|school|university|uni|class)$/i;
  var TITLE_RX = '(?:dr|mr|mrs|ms|miss|prof|eng|sheikh)\\.?';
  function strip(s, a, b) { return (s.slice(0, a) + ' ' + s.slice(b)).replace(/\s+/g, ' ').trim(); }
  // "Submit report to Dr. Ahmed by Sunday" / "Call HR tomorrow at 10am"
  function parseTask(text) {
    var s = String(text || '').trim().replace(/[.!?]+$/, '');
    s = s.replace(/^(?:hey |ok |okay )?(?:jarvis|jervis|javis)[,:]?\s*/i, '');
    s = s.replace(/^(?:please\s+)?(?:remind me (?:to|that i (?:need|have) to|about)|i'?ll|i will|i'?m going to|i am going to|i need to|i have to|i must|i promised to|add (?:a |another |new )?(?:task|todo|to-do|reminder)(?: to)?:?|new task:?|create (?:a )?task:?|task:?)\s+/i, '');
    var priority = 'medium', pm;
    if ((pm = s.match(/\b(?:it'?s |this is )?(?:urgent|high priority|top priority|important|asap)\b[,]?/i))) { priority = 'high'; s = strip(s, pm.index, pm.index + pm[0].length); }
    else if ((pm = s.match(/\b(?:low priority|no rush|whenever)\b/i))) { priority = 'low'; s = strip(s, pm.index, pm.index + pm[0].length); }
    var time = parseTime(s), due = null;
    if (time) s = strip(s, time.start, time.end);
    due = parseDate(s);
    if (due) s = strip(s, due.start, due.end);
    if (time && time.date && !due) due = { date: time.date };
    if (time && !due) {
      // A time with no date: today if still ahead, otherwise tomorrow.
      due = { date: time.time > nowHM() ? today() : addDays(today(), 1) };
    }
    s = s.replace(/\s+(?:at|on|by)$/i, '').replace(/[,;:]+$/, '').replace(/^[\s,;:\-]+/, '').trim();

    var person = '', title = s;
    var people = knownPeople();
    var m = s.match(new RegExp('\\s+(to|for|with)\\s+((?:the\\s+)?(?:' + TITLE_RX + '\\s+)?[A-Za-z][\\w\'.-]*(?:\\s+[A-Za-z][\\w\'.-]*)?)$', 'i'));
    if (m) {
      var cand = m[2].trim(), prep = m[1].toLowerCase(), first = cand.split(/\s+/)[0];
      var known = people.filter(function (p) { return p.toLowerCase().split(/\s+/)[0] === first.toLowerCase(); })[0];
      var titled = new RegExp('^' + TITLE_RX + '\\s', 'i').test(cand);
      var ok = known || titled || /^[A-Z]{2,}$/.test(first) ||
        (prep === 'to' && !NOT_PEOPLE.test(cand) && !NOT_PEOPLE.test(first)) ||
        (prep !== 'to' && /^[A-Z]/.test(first) && cand.split(/\s+/).length <= 2);
      if (ok) {
        person = known && cand.split(/\s+/).length === 1 ? known : niceName(cand);
        var rest = s.slice(0, m.index).trim();
        title = rest.split(/\s+/).length >= 2 ? rest : s;
      }
    }
    if (!person && (m = s.match(new RegExp('^(?:call|phone|email|e-mail|message|text|ping|meet|see|ask|tell|remind|thank|visit|follow up with)\\s+((?:' + TITLE_RX + '\\s+)?[A-Za-z][\\w\'.-]*)', 'i')))) {
      if (!NOT_PEOPLE.test(m[1])) person = niceName(m[1]);
    }
    if (!person) {
      people.some(function (p) {
        var f = p.split(/\s+/)[0];
        if (f && new RegExp('\\b' + reEsc(f) + '\\b', 'i').test(s)) { person = p; return true; }
        return false;
      });
    }
    people.forEach(function (p) {
      var f = p.split(/\s+/)[0];
      if (f) title = title.replace(new RegExp('\\b' + reEsc(f) + '\\b', 'gi'), f);
    });
    if (person) title = title.replace(new RegExp('\\b' + reEsc(person) + '\\b', 'gi'), person);
    return { title: cap(title), person: person, due: due ? due.date : '', time: time ? time.time : '', priority: priority };
  }
  function niceName(s) {
    s = s.replace(/^the\s+/i, 'the ');
    if (/^[A-Z]{2,}$/.test(s)) return s;
    return s.split(/\s+/).map(function (w) {
      if (/^[A-Z]{2,}$/.test(w)) return w;
      var t = w.toLowerCase();
      if (new RegExp('^' + TITLE_RX + '$').test(t)) return cap(t.replace(/\.?$/, '.'));
      if (t === 'the') return t;
      return cap(t);
    }).join(' ').replace(/^(hr|it|ceo|cto|cfo)$/i, function (x) { return x.toUpperCase(); });
  }

  /* ---------------- fuzzy matching ---------------- */
  var STOP = {};
  'the a an to for of and with my me i on by as is be at in it this that please mark done complete completed finished finish task item off check tick delete remove note job'.split(' ').forEach(function (w) { STOP[w] = 1; });
  function tokens(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1 && !STOP[w]; }); }
  function overlap(q, target) {
    var qt = tokens(q), tt = tokens(target);
    if (!qt.length) return 0;
    var hits = qt.filter(function (w) { return tt.some(function (x) { return x === w || (w.length > 3 && x.length > 3 && x.slice(0, 4) === w.slice(0, 4)); }); }).length;
    return hits / qt.length + hits * 0.01;
  }
  function best(items, q, textOf, min) {
    var top = null, score = 0;
    items.forEach(function (it) {
      var text = textOf(it), s = overlap(q, text);
      if (s > 0) s -= tokens(text).length * 0.002; // prefer the closest, shortest match
      if (s > score) { top = it; score = s; }
    });
    return score >= (min || 0.5) - 0.05 ? top : null;
  }

  /* ---------------- data ---------------- */
  var STAGES = [['saved', 'Saved'], ['applied', 'Applied'], ['interview', 'Interview'], ['offer', 'Offer'], ['rejected', 'Rejected']];
  var CHECKLIST = [
    ['cv', 'Tailor my CV to this job'],
    ['cover', 'Write the cover letter'],
    ['real', 'Check the company and job are real'],
    ['submit', 'Submit the application'],
    ['confirm', 'Save the confirmation email'],
    ['follow', 'Follow up after 7 days']
  ];
  function blank() {
    return {
      v: 3,
      profile: { name: 'Roshan', field: '', degree: '', university: '', skills: [], languages: [], cities: [], titles: [], jobTypes: [], goal: '', goalSample: false, sampleFields: [],
        // used to match jobs ("which jobs can hire me")
        gradDate: '', gpa: '', tools: [], skillLevels: {}, yearsExp: '0', experience: '', nationality: '', visa: 'resident', remote: 'open', salaryFloor: '', notice: '', avoidIndustries: [] },
      people: [], tasks: [], notes: [], skills: [], wins: [], apps: [],
      sources: null, // null means "use the starter list"
      seenJobs: [], cal: null, extEvents: [],
      rules: [], alertsSeen: [], alertsReady: false, reports: { week: '', latest: null }, digestOn: '',
      settings: { voice: true, voiceURI: '', rate: 1, wake: false, sounds: false, notify: false, weeklyGoal: 5, jobAlerts: true, alertMin: 75, smart: false }
    };
  }
  function sample() {
    var t = today(), d = blank(), S = true;
    var p = d.profile;
    p.field = 'Computer Science'; p.degree = 'BSc Computer Science'; p.university = 'University in Dubai';
    p.skills = ['Python', 'SQL', 'JavaScript', 'Data analysis', 'Communication'];
    p.languages = ['English', 'Hindi', 'Arabic (basic)'];
    p.cities = ['Dubai', 'Abu Dhabi'];
    p.titles = ['Software Engineer', 'Data Analyst'];
    p.jobTypes = ['Internship', 'Graduate programme', 'Full-time'];
    p.goal = 'Land a graduate software or data role in the UAE within 6 months.';
    p.goalSample = true;
    p.skillLevels = { Python: 'strong', SQL: 'working', JavaScript: 'working', Excel: 'working', 'Data analysis': 'working', Communication: 'working' };
    p.nationality = 'Indian'; p.visa = 'resident'; p.yearsExp = '0'; p.gradDate = String(+t.slice(0, 4)); p.tools = ['Git', 'VS Code'];
    p.experience = 'Final-year data dashboard project; 3-month internship at a local company.';
    p.sampleFields = ['field', 'degree', 'university', 'skills', 'languages', 'cities', 'titles', 'jobTypes', 'skillLevels', 'nationality', 'visa', 'yearsExp', 'gradDate', 'tools', 'experience'];
    d.people = [
      { id: uid(), name: 'Dr. Ahmed', role: 'Project supervisor', sample: S },
      { id: uid(), name: 'Sara', role: 'Mentor', sample: S }
    ];
    d.tasks = [
      { id: uid(), title: 'Submit final project report', person: 'Dr. Ahmed', due: addDays(t, -1), time: '', priority: 'high', status: 'todo', created: addDays(t, -6), sample: S },
      { id: uid(), title: 'Update CV with the data project', person: '', due: t, time: '18:00', priority: 'high', status: 'doing', created: addDays(t, -2), sample: S },
      { id: uid(), title: 'Call HR about the internship', person: 'HR', due: addDays(t, 1), time: '10:00', priority: 'medium', status: 'todo', created: addDays(t, -1), sample: S },
      { id: uid(), title: 'Finish the SQL practice set', person: '', due: weekEnd(addDays(t, 2)), time: '', priority: 'low', status: 'todo', created: t, sample: S },
      { id: uid(), title: 'Ask for a reference letter', person: 'Sara', due: addDays(t, 9), time: '', priority: 'medium', status: 'todo', created: t, sample: S },
      { id: uid(), title: 'Book the career fair ticket', person: '', due: addDays(t, -2), time: '', priority: 'medium', status: 'done', doneOn: addDays(t, -2), created: addDays(t, -5), sample: S }
    ];
    var now = Date.now();
    d.notes = [
      { id: uid(), text: 'Career fair tips: bring 10 printed CVs, ask each company about graduate programmes, and collect recruiter emails.', created: now - 3 * 864e5, updated: now - 3 * 864e5, sample: S },
      { id: uid(), text: 'Interview prep: practise the "tell me about yourself" answer in under 90 seconds. Mention the data dashboard project.', created: now - 864e5, updated: now - 864e5, sample: S }
    ];
    var sk = [['Python', 72], ['SQL', 55], ['Data visualisation', 40], ['Public speaking', 30]].map(function (x) { return { id: uid(), name: x[0], progress: x[1], sample: S }; });
    d.skills = sk;
    d.wins = [
      { id: uid(), text: 'Built a sales dashboard for the final-year project', kind: 'win', skillId: sk[2].id, date: addDays(t, -3), sample: S },
      { id: uid(), text: 'Google Data Analytics certificate', kind: 'certificate', skillId: sk[1].id, date: addDays(t, -20), sample: S },
      { id: uid(), text: 'Presented my project to 30 classmates', kind: 'win', skillId: sk[3].id, date: addDays(t, -9), sample: S }
    ];
    d.apps = [
      { id: uid(), title: 'Graduate Software Engineer', company: 'Example Tech (sample)', city: 'Dubai', url: '', stage: 'applied', appliedOn: addDays(t, -2), deadline: '', interview: '', notes: 'Applied through the company careers page.', checklist: { cv: true, cover: true, real: true, submit: true }, created: addDays(t, -4), sample: S },
      { id: uid(), title: 'Data Analyst Intern', company: 'Sample Analytics LLC', city: 'Abu Dhabi', url: '', stage: 'saved', appliedOn: '', deadline: addDays(t, 3), interview: '', notes: 'Needs a cover letter.', checklist: { cv: true }, created: addDays(t, -1), sample: S },
      { id: uid(), title: 'Junior Developer', company: 'Demo Fintech (sample)', city: 'Dubai', url: '', stage: 'interview', appliedOn: addDays(t, -10), deadline: '', interview: addDays(t, 2) + 'T11:00', notes: 'Online interview on Teams.', checklist: { cv: true, cover: true, real: true, submit: true, confirm: true }, created: addDays(t, -12), sample: S }
    ];
    d.isSample = true;
    return d;
  }
  function normalize(x) {
    var b = blank();
    x = x && typeof x === 'object' ? x : {};
    var out = {
      v: 3,
      profile: Object.assign(b.profile, x.profile || {}),
      settings: Object.assign(b.settings, x.settings || {}),
      sources: Array.isArray(x.sources) ? x.sources : null,
      seenJobs: Array.isArray(x.seenJobs) ? x.seenJobs.slice(-800) : [],
      // Calendar connections (settings only, never tokens) and events synced from Google, Outlook or .ics files.
      rules: Array.isArray(x.rules) ? x.rules.filter(function (r) { return r && r.id; }) : [],
      alertsSeen: Array.isArray(x.alertsSeen) ? x.alertsSeen.slice(-600) : [], alertsReady: !!x.alertsReady,
      reports: x.reports && typeof x.reports === 'object' ? Object.assign({ week: '', latest: null }, x.reports) : { week: '', latest: null }, digestOn: x.digestOn || '',
      cal: x.cal && typeof x.cal === 'object' ? x.cal : null,
      extEvents: Array.isArray(x.extEvents) ? x.extEvents.filter(function (e) { return e && typeof e === 'object' && e.key; }) : []
    };
    ['people', 'tasks', 'notes', 'skills', 'wins', 'apps'].forEach(function (k) { out[k] = Array.isArray(x[k]) ? x[k].filter(function (i) { return i && typeof i === 'object'; }) : []; });
    ['skills', 'languages', 'cities', 'titles', 'jobTypes', 'sampleFields', 'tools', 'avoidIndustries'].forEach(function (k) { out.profile[k] = list(out.profile[k]); });
    if (!out.profile.skillLevels || typeof out.profile.skillLevels !== 'object' || Array.isArray(out.profile.skillLevels)) out.profile.skillLevels = {};
    out.profile.yearsExp = String(out.profile.yearsExp == null ? '0' : out.profile.yearsExp);
    if (!out.profile.name) out.profile.name = 'Roshan';
    out.tasks.forEach(function (t) { t.status = t.status || 'todo'; t.priority = t.priority || 'medium'; t.title = t.title || 'Untitled task'; });
    out.apps.forEach(function (a) { a.stage = a.stage || 'saved'; a.checklist = a.checklist || {}; });
    out.skills.forEach(function (s) { s.progress = clamp(+s.progress || 0, 0, 100); });
    return out;
  }

  var listeners = [];
  var storageOk = true;
  J.onChange = function (fn) { listeners.push(fn); };
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(J.data)); storageOk = true; return true; }
    catch (e) {
      if (storageOk && J.toast) J.toast('Could not save. Browser storage is full or blocked.');
      storageOk = false;
      return false;
    }
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* fall back to sample data */ }
    return normalize(sample());
  }
  // Save and redraw everything that listens.
  function commit() { persist(); listeners.forEach(function (fn) { try { fn(); } catch (e) { setTimeout(function () { throw e; }); } }); }

  var undoSnap = null;
  function snapshot() { undoSnap = JSON.stringify(J.data); }
  function undo() { if (!undoSnap) return false; J.data = normalize(JSON.parse(undoSnap)); undoSnap = null; commit(); return true; }
  function canUndo() { return !!undoSnap; }

  function isSample(x) { return x && x.sample; }
  function hasSample() {
    var d = J.data;
    return d.profile.goalSample || d.profile.sampleFields.length > 0 ||
      ['people', 'tasks', 'notes', 'skills', 'wins', 'apps'].some(function (k) { return d[k].some(isSample); });
  }
  function clearSample() {
    snapshot();
    var d = J.data, p = d.profile;
    if (p.goalSample) { p.goal = ''; p.goalSample = false; }
    p.sampleFields.forEach(function (f) { p[f] = Array.isArray(p[f]) ? [] : (p[f] && typeof p[f] === 'object' ? {} : (f === 'yearsExp' ? '0' : f === 'visa' ? 'resident' : '')); });
    p.sampleFields = [];
    ['people', 'tasks', 'notes', 'skills', 'wins', 'apps'].forEach(function (k) { d[k] = d[k].filter(function (x) { return !isSample(x); }); });
    d.tasks = d.tasks.filter(function (t) { return !t.appId || byId(d.apps, t.appId); });
    commit();
  }
  function resetAll() {
    snapshot();
    var keep = J.data.settings;
    J.data = blank();
    J.data.settings = keep;
    J.data.profile.name = 'Roshan';
    commit();
  }

  /* ---------------- queries ---------------- */
  function byDue(a, b) { return ((a.due || '9999') + (a.time || '99')).localeCompare((b.due || '9999') + (b.time || '99')); }
  function open() { return J.data.tasks.filter(function (t) { return t.status !== 'done'; }); }
  function overdue() {
    var t = today();
    return open().filter(function (x) { return x.due && x.due < t; }).sort(byDue);
  }
  function dueToday() { var t = today(); return open().filter(function (x) { return x.due === t; }).sort(byDue); }
  function dueWeek() { var t = today(), we = weekEnd(t); return open().filter(function (x) { return x.due && x.due > t && x.due <= we; }).sort(byDue); }
  function upcoming(days) { var t = today(), end = addDays(t, days || 7); return open().filter(function (x) { return x.due && x.due >= t && x.due <= end; }).sort(byDue); }
  function taskPhrase(x) {
    var named = x.person && x.title.toLowerCase().indexOf(x.person.toLowerCase()) >= 0;
    return x.title + (x.person && !named ? ' for ' + x.person : '');
  }
  function appsThisWeek() {
    var ws = weekStart();
    return J.data.apps.filter(function (a) { return a.appliedOn && a.appliedOn >= ws && a.appliedOn <= today(); });
  }
  function stageName(id) { var s = STAGES.filter(function (x) { return x[0] === id; })[0]; return s ? s[1] : 'Saved'; }
  function knownPeople() {
    return J.data.people.map(function (p) { return p.name; }).filter(Boolean);
  }
  function deadlines(days) {
    var t = today(), end = addDays(t, days || 14), out = [];
    J.data.apps.forEach(function (a) {
      if (a.stage === 'rejected' || a.stage === 'offer') return;
      if (a.deadline && a.deadline >= t && a.deadline <= end) out.push({ date: a.deadline, time: '', text: 'Application deadline: ' + a.title + ' at ' + a.company, kind: 'deadline', app: a });
      if (a.interview) { var d = a.interview.slice(0, 10); if (d >= t && d <= end) out.push({ date: d, time: a.interview.slice(11, 16), text: 'Interview: ' + a.title + ' at ' + a.company, kind: 'interview', app: a }); }
    });
    open().forEach(function (x) { if (x.due && x.due >= t && x.due <= end && x.priority === 'high' && !x.appId) out.push({ date: x.due, time: x.time, text: taskPhrase(x), kind: 'task', task: x }); });
    return out.sort(function (a, b) { return (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')); });
  }
  function nextStep() {
    var o = overdue();
    if (o.length) { var n = diff(o[0].due, today()); return { text: 'Finish "' + taskPhrase(o[0]) + '". It was due ' + (n === 1 ? 'yesterday' : n + ' days ago') + '.', view: 'tasks', label: 'Open tasks', tone: 'red' }; }
    var dl = deadlines(3).filter(function (x) { return x.kind !== 'task'; })[0];
    if (dl) return { text: (dl.kind === 'interview' ? 'Prepare for your interview: ' + dl.app.title + ' at ' + dl.app.company : 'Apply before the deadline: ' + dl.app.title + ' at ' + dl.app.company) + ', ' + when(dl.date, dl.time) + '.', view: 'applications', label: 'Open applications' };
    var d = dueToday();
    if (d.length) return { text: 'Complete "' + taskPhrase(d[0]) + '". It is due today' + (d[0].time ? ' at ' + fmtTime(d[0].time) : '') + '.', view: 'tasks', label: 'Open tasks' };
    var goal = +J.data.settings.weeklyGoal || 0, done = appsThisWeek().length;
    if (goal && done < goal && !isWeekend(today())) return { text: 'Send ' + plural(goal - done, 'more application') + ' to reach your weekly goal of ' + goal + '.', view: 'jobs', label: 'Find jobs' };
    var w = dueWeek();
    if (w.length) return { text: 'Get ahead on "' + taskPhrase(w[0]) + '", due ' + when(w[0].due) + '.', view: 'tasks', label: 'Open tasks' };
    var low = J.data.skills.slice().sort(function (a, b) { return a.progress - b.progress; })[0];
    if (low && low.progress < 100) return { text: 'Spend 30 minutes on ' + low.name + '. It is at ' + low.progress + '%.', view: 'growth', label: 'Open growth' };
    return { text: 'You are clear. Search for new internships and graduate roles.', view: 'jobs', label: 'Find jobs' };
  }
  function weekReview() {
    var t = today(), ws = weekStart(t);
    return {
      start: ws, end: addDays(ws, 4),
      finished: J.data.tasks.filter(function (x) { return x.status === 'done' && x.doneOn && x.doneOn >= ws; }),
      slipped: overdue(),
      wins: J.data.wins.filter(function (w) { return w.date >= ws && w.date <= t; }),
      applied: appsThisWeek(),
      moved: J.data.apps.filter(function (a) { return a.updated && a.updated >= ws && a.stage !== 'saved'; }),
      next: nextStep()
    };
  }

  /* ---------------- actions ---------------- */
  function addTask(x) {
    var task = { id: uid(), title: cap(x.title || 'Untitled task'), person: (x.person || '').trim(), due: x.due || '', time: x.time || '', priority: x.priority || 'medium', status: x.status || 'todo', created: today(), kind: x.kind || 'task', appId: x.appId || '' };
    J.data.tasks.push(task);
    commit();
    return task;
  }
  function setTaskDone(id, done) {
    var t = byId(J.data.tasks, id);
    if (!t) return null;
    t.status = done ? 'done' : 'todo';
    t.doneOn = done ? today() : '';
    if (t.kind === 'followup' && t.appId) { var fa = byId(J.data.apps, t.appId); if (fa) fa.followedUp = !!done; }
    commit();
    return t;
  }
  function findTask(q, includeDone) {
    return best(J.data.tasks.filter(function (t) { return includeDone || t.status !== 'done'; }), q, function (t) { return t.title + ' ' + t.person; });
  }
  function removeTask(id) { snapshot(); J.data.tasks = J.data.tasks.filter(function (t) { return t.id !== id; }); commit(); }
  function addNote(text) {
    var n = { id: uid(), text: cap(text), created: Date.now(), updated: Date.now() };
    J.data.notes.push(n); commit(); return n;
  }
  function addWin(text, kind, skillId, date) {
    var sk = skillId ? byId(J.data.skills, skillId) : best(J.data.skills, text, function (s) { return s.name; }, 0.3);
    var w = { id: uid(), text: cap(text), kind: kind || (/\b(certificate|certification|certified|course completion)\b/i.test(text) ? 'certificate' : 'win'), skillId: sk ? sk.id : '', date: date || today() };
    J.data.wins.push(w); commit();
    return { win: w, skill: sk };
  }
  function byId(arr, id) { return arr.filter(function (x) { return x.id === id; })[0] || null; }
  // Application deadlines and interviews become reminders (linked tasks).
  function syncAppTasks(a) {
    var d = J.data;
    d.tasks = d.tasks.filter(function (t) { return !(t.appId === a.id && t.status !== 'done' && (t.kind === 'deadline' || t.kind === 'interview' || t.kind === 'followup')); });
    if (a.stage === 'rejected' || a.stage === 'offer') return;
    // Follow-up reminder 7 days after saving (or after applying).
    var base = a.stage === 'applied' ? a.appliedOn : a.stage === 'saved' ? a.created : '';
    if (base && !(a.followedUp)) d.tasks.push({ id: uid(), title: 'Follow up: ' + a.title + ' at ' + a.company, person: a.company, due: addDays(base, 7), time: '09:00', priority: 'medium', status: 'todo', created: today(), kind: 'followup', appId: a.id, sample: a.sample });
    if (a.deadline && a.stage === 'saved') d.tasks.push({ id: uid(), title: 'Apply: ' + a.title + ' at ' + a.company, person: '', due: a.deadline, time: '09:00', priority: 'high', status: 'todo', created: today(), kind: 'deadline', appId: a.id, sample: a.sample });
    if (a.interview) d.tasks.push({ id: uid(), title: 'Interview: ' + a.title + ' at ' + a.company, person: a.company, due: a.interview.slice(0, 10), time: a.interview.slice(11, 16) || '09:00', priority: 'high', status: 'todo', created: today(), kind: 'interview', appId: a.id, sample: a.sample });
  }

  /* ---------------- start ---------------- */
  J.data = load();
  var first = false;
  try { first = !localStorage.getItem(KEY); } catch (e) { first = false; }
  if (first) J.data.apps.forEach(syncAppTasks);
  persist();
  window.addEventListener('storage', function (e) { if (e.key === KEY) { J.data = load(); listeners.forEach(function (fn) { fn(); }); } });

  Object.assign(J, {
    TZ: TZ, KEY: KEY, STAGES: STAGES, CHECKLIST: CHECKLIST,
    esc: esc, uid: uid, cap: cap, titleCase: titleCase, plural: plural, clamp: clamp, joinList: joinList, list: list, calm: calm, reEsc: reEsc,
    parts: parts, today: today, nowHM: nowHM, hourNow: hourNow, addDays: addDays, dow: dow, diff: diff, weekStart: weekStart, weekEnd: weekEnd,
    isWeekend: isWeekend, stamp: stamp, fmt: fmt, longDate: longDate, spokenDate: spokenDate, fmtTime: fmtTime, timeNow: timeNow,
    dueLabel: dueLabel, when: when, ago: ago, isoFromTs: isoFromTs,
    parseDate: parseDate, parseTime: parseTime, parseTask: parseTask, tokens: tokens, overlap: overlap, best: best,
    persist: persist, commit: commit, snapshot: snapshot, undo: undo, canUndo: canUndo, hasSample: hasSample, clearSample: clearSample,
    resetAll: resetAll, normalize: normalize, blank: blank,
    open: open, overdue: overdue, dueToday: dueToday, dueWeek: dueWeek, upcoming: upcoming, taskPhrase: taskPhrase, byDue: byDue,
    appsThisWeek: appsThisWeek, stageName: stageName, knownPeople: knownPeople, deadlines: deadlines, nextStep: nextStep, weekReview: weekReview,
    addTask: addTask, setTaskDone: setTaskDone, findTask: findTask, removeTask: removeTask, addNote: addNote, addWin: addWin, byId: byId,
    syncAppTasks: syncAppTasks
  });
})();

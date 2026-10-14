/* Jarvis v1: personal chief of staff that runs entirely in the browser.
   All data lives in localStorage on this device. No server, no API keys. */
(function () {
  'use strict';

  var KEY = 'jarvis.v1';
  var THEME_KEY = 'jarvis.theme';
  var STALE_DAYS = 42;
  var DEFAULT_TARGET = 3;

  // ---------- helpers ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function today0() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addDays(n) { var d = today0(); d.setDate(d.getDate() + n); return iso(d); }
  function parseISO(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]);
  }
  function daysFrom(s) { var d = parseISO(s); if (!d) return null; return Math.round((d - today0()) / 864e5); }
  function fmtDate(s) {
    var n = daysFrom(s);
    if (n === null) return 'No date';
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    return parseISO(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function cap(s) { s = String(s || '').trim(); return s.charAt(0).toUpperCase() + s.slice(1); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  // ---------- data ----------
  function emptyState() {
    return {
      sample: false,
      profile: { name: '', role: '', goal: 'CTO', timeframe: '', thesis: '', nonneg: '', strengths: '', gaps: '' },
      people: [],
      commitments: [],
      levels: { current: '', next: '', criteria: [] },
      evidence: [],
      rules: { remit: 5, scale: 4, location: 3, reporting: 4, pay: 3 },
      roles: [],
      drafts: []
    };
  }

  function sampleState() {
    var s = emptyState();
    s.sample = true;
    s.profile = {
      name: 'Alex', role: 'Director of Engineering', goal: 'CTO', timeframe: 'Within 3 years',
      thesis: 'Become CTO of a growth-stage technology or fintech company in the Gulf, owning technology strategy, engineering and data.',
      nonneg: 'Based in Dubai. Reports to the CEO. Real budget ownership.',
      strengths: 'Delivery at scale, cloud platforms, building teams.',
      gaps: 'P&L ownership, board exposure, external profile.'
    };
    s.people = [
      { id: uid(), name: 'Omar', relation: 'Manager', note: 'VP Engineering. Weekly 1:1 on Mondays.' },
      { id: uid(), name: 'Layla', relation: 'Sponsor', note: 'COO. Wants faster product releases.' },
      { id: uid(), name: 'Sara', relation: 'Key peer', note: 'Head of Procurement.' },
      { id: uid(), name: 'David', relation: 'Mentor', note: 'Former CTO. Monthly coffee.' }
    ];
    s.commitments = [
      { id: uid(), what: 'Send the vendor comparison', who: 'Sara', due: addDays(-2), source: 'Chat', status: 'open', created: addDays(-6) },
      { id: uid(), what: 'Share Q4 hiring plan', who: 'Omar', due: addDays(0), source: 'Meeting', status: 'open', created: addDays(-4) },
      { id: uid(), what: 'Review the cloud cost report', who: 'Finance team', due: addDays(1), source: 'Email', status: 'open', created: addDays(-3) },
      { id: uid(), what: 'Draft the platform roadmap one-pager', who: 'Layla', due: addDays(3), source: 'Meeting', status: 'open', created: addDays(-2) },
      { id: uid(), what: 'Give feedback on the API design doc', who: 'Platform team', due: addDays(5), source: 'Chat', status: 'open', created: addDays(-1) },
      { id: uid(), what: 'Send interview feedback for the staff engineer candidate', who: 'Recruiting', due: addDays(-3), source: 'Email', status: 'done', created: addDays(-8), doneOn: addDays(-3) }
    ];
    var c = ['Technology strategy', 'P&L and budget ownership', 'Building leaders', 'Executive and board presence', 'External profile', 'Delivery at scale']
      .map(function (n) { return { id: uid(), name: n, target: DEFAULT_TARGET }; });
    s.levels = { current: 'Director of Engineering', next: 'VP Engineering', criteria: c };
    s.evidence = [
      { id: uid(), date: addDays(-4), title: 'Cut cloud spend 18% with reserved instances', detail: 'Saved about AED 1.2M a year.', criterionId: c[5].id },
      { id: uid(), date: addDays(-12), title: 'Wrote the 2027 platform strategy', detail: 'Approved by the leadership team.', criterionId: c[0].id },
      { id: uid(), date: addDays(-20), title: 'Promoted two engineering managers', detail: '', criterionId: c[2].id },
      { id: uid(), date: addDays(-33), title: 'Presented the AI roadmap to the executive committee', detail: '', criterionId: c[3].id },
      { id: uid(), date: addDays(-61), title: 'Built the department budget forecast', detail: 'First time owning the forecast.', criterionId: c[1].id },
      { id: uid(), date: addDays(-2), title: 'Shipped payments platform migration on time', detail: 'Zero downtime.', criterionId: c[5].id }
    ];
    s.roles = [
      { id: uid(), company: 'Fintech scale-up', title: 'Chief Technology Officer', location: 'Dubai', status: 'interested', link: '', notes: 'Series C, 300 people.', r: { remit: 5, scale: 4, location: 5, reporting: 5, pay: 4 }, added: addDays(-2) },
      { id: uid(), company: 'Regional retailer', title: 'VP Engineering', location: 'Dubai', status: 'applied', link: '', notes: 'Reports to CTO.', r: { remit: 3, scale: 5, location: 5, reporting: 2, pay: 4 }, added: addDays(-10) },
      { id: uid(), company: 'Logistics platform', title: 'CTO', location: 'Abu Dhabi', status: 'interviewing', link: '', notes: 'Second round with the CEO next week.', r: { remit: 5, scale: 3, location: 4, reporting: 5, pay: 3 }, added: addDays(-18) },
      { id: uid(), company: 'Global SaaS company', title: 'Head of Engineering, MEA', location: 'Riyadh', status: 'interested', link: '', notes: '', r: { remit: 2, scale: 4, location: 2, reporting: 2, pay: 4 }, added: addDays(-1) }
    ];
    s.drafts = [
      { id: uid(), to: 'Sara', subject: 'Vendor comparison', body: 'Hi Sara,\n\nApologies for the delay. The vendor comparison is attached. My recommendation is option B, mainly for support terms. Happy to go through it tomorrow.\n\nThanks,\nAlex', status: 'pending', created: addDays(0) },
      { id: uid(), to: 'Omar', subject: 'Q4 hiring plan', body: 'Hi Omar,\n\nHere is the Q4 hiring plan: 6 roles, with platform and data as the priority. Two need budget approval. Can we cover it in Monday\'s 1:1?\n\nAlex', status: 'pending', created: addDays(0) },
      { id: uid(), to: 'David', subject: 'Coffee this month?', body: 'Hi David,\n\nWould you have time for coffee this month? I\'d value your view on getting more board exposure.\n\nAlex', status: 'approved', created: addDays(-3) }
    ];
    return s;
  }

  var state;
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var obj = JSON.parse(raw); if (obj && obj.levels) return normalize(obj); }
    } catch (e) { /* storage unavailable or corrupt */ }
    return sampleState();
  }
  function normalize(o) {
    var base = emptyState();
    Object.keys(base).forEach(function (k) { if (o[k] === undefined) o[k] = base[k]; });
    o.rules = Object.assign({}, base.rules, o.rules || {});
    o.profile = Object.assign({}, base.profile, o.profile || {});
    o.levels.criteria = o.levels.criteria || [];
    return o;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast('Could not save on this device. Export a backup to keep your data.'); }
    updateBadge();
  }

  // ---------- commitment logic ----------
  function cState(c) {
    if (c.status === 'done') return 'done';
    if (c.status === 'slipped') return 'slipped';
    var n = daysFrom(c.due);
    if (n !== null && n < 0) return 'overdue';
    return 'open';
  }
  function openItems() { return state.commitments.filter(function (c) { return c.status !== 'done'; }); }
  function byDue(a, b) { return (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0; }

  // Quick capture: "I'll send the vendor comparison to Sara by Thursday"
  var WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  var WD_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)';
  var MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function weekdayIndex(w) {
    w = w.toLowerCase().slice(0, 3);
    for (var i = 0; i < 7; i++) if (WD[i].slice(0, 3) === w) return i;
    return -1;
  }
  function nextWeekday(i, forceNext) {
    var t = today0(); var diff = (i - t.getDay() + 7) % 7;
    if (forceNext && diff < 7) diff += (diff === 0 ? 7 : 0);
    return addDays(diff);
  }
  function futureDate(y, m, d) {
    var dt = new Date(y, m, d);
    if (dt.getMonth() !== m) return null;
    if (dt < today0() && y === today0().getFullYear()) dt.setFullYear(y + 1);
    return iso(dt);
  }

  function parseCapture(text) {
    var t = ' ' + String(text || '').trim() + ' ';
    var due = '', who = '', source = 'Other', m;
    var pre = '(?:\\s(?:by|on|before|until|due|this))?';

    var rules = [
      [new RegExp(pre + '\\s(today|tonight|eod|end of (?:the )?day)\\b', 'i'), function () { return addDays(0); }],
      [new RegExp(pre + '\\s(tomorrow|tmrw|tmr)\\b', 'i'), function () { return addDays(1); }],
      [new RegExp(pre + '\\s(?:the )?(end of (?:the )?week|eow)\\b', 'i'), function () { return nextWeekday(5); }],
      [new RegExp(pre + '\\s(next week)\\b', 'i'), function () { return addDays(7); }],
      [new RegExp(pre + '\\s(end of (?:the )?month|eom)\\b', 'i'), function () { var d = today0(); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }],
      [/\sin (\d{1,3}) days?\b/i, function (mm) { return addDays(parseInt(mm[1], 10)); }],
      [/(?:\s(?:by|on|before))?\s(\d{4})-(\d{2})-(\d{2})\b/i, function (mm) { return futureDate(+mm[1], +mm[2] - 1, +mm[3]); }],
      [new RegExp(pre + '\\s(\\d{1,2})(?:st|nd|rd|th)?\\s(' + MON.join('|') + ')[a-z]*\\.?(?=\\s|$|[,.;])', 'i'), function (mm) { return futureDate(today0().getFullYear(), MON.indexOf(mm[2].toLowerCase()), +mm[1]); }],
      [new RegExp(pre + '\\s(' + MON.join('|') + ')[a-z]*\\.?\\s(\\d{1,2})(?:st|nd|rd|th)?\\b', 'i'), function (mm) { return futureDate(today0().getFullYear(), MON.indexOf(mm[1].toLowerCase()), +mm[2]); }],
      [/(?:\s(?:by|on|before))?\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, function (mm) {
        var y = mm[3] ? (+mm[3] < 100 ? 2000 + +mm[3] : +mm[3]) : today0().getFullYear();
        return futureDate(y, +mm[2] - 1, +mm[1]);
      }],
      [new RegExp('(?:\\s(?:by|on|before|until|this))?\\s(next\\s)?' + WD_RE + '\\b', 'i'), function (mm) {
        var i = weekdayIndex(mm[2]); return i < 0 ? '' : nextWeekday(i, !!mm[1]);
      }]
    ];
    for (var i = 0; i < rules.length; i++) {
      m = t.match(rules[i][0]);
      if (m) { var d = rules[i][1](m); if (d) { due = d; t = t.replace(m[0], ' '); break; } }
    }

    var src = t.match(/\b(email|e-mail|mail|meeting|call|teams|slack|chat|whatsapp|1:1)\b/i);
    if (src) {
      var k = src[1].toLowerCase();
      source = /mail/.test(k) ? 'Email' : /meeting|1:1/.test(k) ? 'Meeting' : k === 'call' ? 'Call' : 'Chat';
    }

    m = t.match(/\s(?:to|for|with)\s((?:the\s)?[A-Z][\w'’-]*(?:\s(?:team|[A-Z][\w'’-]*))?)/);
    if (m) { who = m[1].replace(/^the\s/i, '').trim(); t = t.replace(m[0], ' '); }

    var what = t.replace(/\s+/g, ' ').trim()
      .replace(/^(i'll|i will|i’ll|i'm going to|i am going to|i need to|i have to|i must|i promised to|i promise to|will|need to|must|remember to|todo:?)\s+/i, '')
      .replace(/\s+(in|on|via|over)\s+(email|e-mail|mail|teams|slack|chat|whatsapp)\b/i, '')
      .replace(/[\s,.;:!-]+$/, '');
    return { what: cap(what), who: who, due: due, source: source };
  }

  // ---------- promotion logic ----------
  function critStats(cr) {
    var ev = state.evidence.filter(function (e) { return e.criterionId === cr.id; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var last = ev.length ? ev[0].date : null;
    var age = last ? -daysFrom(last) : null;
    return { count: ev.length, last: last, age: age, stale: !last || age > STALE_DAYS, items: ev };
  }
  function tipFor(name) {
    var n = name.toLowerCase();
    if (/p&l|budget|commercial|financ/.test(n)) return 'Ask to own a budget line or lead one cost-saving initiative, then log the result.';
    if (/board|executive|investor/.test(n)) return 'Offer to present your area at the next executive or steering committee meeting.';
    if (/external|profile|brand|industry/.test(n)) return 'Publish one post or give one talk this month on a problem you solved.';
    if (/leader|people|team|talent/.test(n)) return 'Pick a successor and give them a stretch project you would normally own.';
    if (/strategy|vision/.test(n)) return 'Write a one-page technology strategy tied to one business goal and share it with your manager.';
    if (/delivery|execution|scale/.test(n)) return 'Pick the project with the most visible business impact and log its result when it lands.';
    if (/risk|security|governance/.test(n)) return 'Lead one risk review or policy update and share the outcome with leadership.';
    return 'Pick one piece of work that shows this and log the result when it is done.';
  }
  function careerAction() {
    var crits = state.levels.criteria.map(function (c) { return { c: c, s: critStats(c) }; });
    var none = crits.filter(function (x) { return x.s.count === 0; })[0];
    if (none) return { title: 'No evidence yet for "' + none.c.name + '"', text: tipFor(none.c.name), link: '#promotion' };
    var stale = crits.filter(function (x) { return x.s.stale; }).sort(function (a, b) { return b.s.age - a.s.age; })[0];
    if (stale) return { title: '"' + stale.c.name + '" has not moved in ' + Math.floor(stale.s.age / 7) + ' weeks', text: tipFor(stale.c.name), link: '#promotion' };
    var iv = state.roles.filter(function (r) { return r.status === 'interviewing'; })[0];
    if (iv) return { title: 'Prepare for ' + iv.title + ' at ' + iv.company, text: 'Pick three leadership stories that match this role and rehearse them out loud.', link: '#radar' };
    if (!state.levels.criteria.length) return { title: 'Set up your promotion criteria', text: 'Add the criteria for your next level so Jarvis can track your evidence.', link: '#promotion' };
    return { title: 'Log this week\'s wins', text: 'Add at least one piece of evidence before Friday so your promotion case keeps growing.', link: '#promotion' };
  }

  // ---------- radar logic ----------
  var FACTORS = [
    { key: 'remit', label: 'Remit and scope' },
    { key: 'scale', label: 'Company size and stage' },
    { key: 'location', label: 'Location' },
    { key: 'reporting', label: 'Reporting line' },
    { key: 'pay', label: 'Compensation' }
  ];
  var STAGES = [
    { key: 'interested', label: 'Interested' },
    { key: 'applied', label: 'Applied' },
    { key: 'interviewing', label: 'Interviewing' },
    { key: 'offer', label: 'Offer' },
    { key: 'closed', label: 'Closed' }
  ];
  function fitScore(role) {
    var num = 0, den = 0;
    FACTORS.forEach(function (f) {
      var w = +state.rules[f.key] || 0; var r = +(role.r && role.r[f.key]) || 0;
      num += w * r; den += w * 5;
    });
    return den ? Math.round(num / den * 100) : 0;
  }
  function scoreClass(s) { return s >= 80 ? 'high' : s < 60 ? 'low' : ''; }

  // ---------- UI shell ----------
  var main = $('#main');
  var VIEWS = ['today', 'commitments', 'promotion', 'radar', 'review', 'inbox', 'profile'];
  var ui = { cFilter: 'open', dFilter: 'pending' };

  function currentView() {
    var h = (location.hash || '').replace('#', '');
    return VIEWS.indexOf(h) >= 0 ? h : 'today';
  }
  function render() {
    var v = currentView();
    document.querySelectorAll('.nav a[data-view]').forEach(function (a) {
      if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var html = '';
    if (state.sample) {
      html += '<div class="sample"><span><b>You are looking at sample data.</b> Explore it, then clear it and add your own.</span>' +
        '<button class="btn sm" data-act="clear-sample" type="button">Clear sample data</button></div>';
    }
    main.innerHTML = '<div class="view">' + html + VIEW_FN[v]() + '</div>';
    updateBadge();
  }
  function updateBadge() {
    var n = state.drafts.filter(function (d) { return d.status === 'pending'; }).length;
    var b = $('#inboxBadge'); if (!b) return;
    b.textContent = n; b.hidden = n === 0;
  }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function head(eyebrow, title, sub, actions) {
    return '<div class="view-head"><div><div class="eyebrow">' + esc(eyebrow) + '</div><h1>' + esc(title) + '</h1>' +
      (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div>' + (actions ? '<div class="btn-row">' + actions + '</div>' : '') + '</div>';
  }

  function commitmentRow(c) {
    var st = cState(c);
    return '<div class="row' + (st === 'overdue' || st === 'slipped' ? ' is-overdue' : '') + (st === 'done' ? ' is-done' : '') + '">' +
      '<button type="button" class="check' + (st === 'done' ? ' on' : '') + '" data-act="toggle-c" data-id="' + c.id + '" aria-label="' + (st === 'done' ? 'Mark as not done' : 'Mark as done') + ': ' + esc(c.what) + '"></button>' +
      '<div><div class="what">' + esc(c.what) + '</div><div class="meta">' +
      (c.who ? '<span>To ' + esc(c.who) + '</span>' : '') +
      '<span class="due mono">' + esc(fmtDate(c.due)) + '</span>' +
      '<span>' + esc(c.source || '') + '</span>' +
      '<span class="pill ' + st + '">' + st + '</span></div></div>' +
      '<div class="actions"><button type="button" class="icon-btn" data-act="edit-c" data-id="' + c.id + '">Edit</button>' +
      '<button type="button" class="icon-btn" data-act="del-c" data-id="' + c.id + '">Delete</button></div></div>';
  }
  function captureBox() {
    return '<form class="card capture" data-form="capture"><label for="captureInput"><h2>Quick capture</h2></label>' +
      '<p class="muted small">Type a promise the way you would say it. Jarvis picks out what, who and when, then lets you check it.</p>' +
      '<div class="capture-row"><input type="text" id="captureInput" name="capture" autocomplete="off" placeholder="I\'ll send the vendor comparison to Sara by Thursday">' +
      '<button class="btn primary" type="submit">Capture</button></div></form>';
  }

  // ---------- views ----------
  var VIEW_FN = {};

  VIEW_FN.today = function () {
    var h = new Date().getHours();
    var greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    var name = state.profile.name ? ', ' + state.profile.name : '';
    var open = openItems();
    var overdue = open.filter(function (c) { var s = cState(c); return s === 'overdue' || s === 'slipped'; }).sort(byDue);
    var dueToday = open.filter(function (c) { return daysFrom(c.due) === 0; });
    var week = open.filter(function (c) { var n = daysFrom(c.due); return n !== null && n >= 1 && n <= 7; }).sort(byDue);
    var pending = state.drafts.filter(function (d) { return d.status === 'pending'; }).length;
    var act = careerAction();
    var topRole = state.roles.filter(function (r) { return r.status !== 'closed'; })
      .sort(function (a, b) { return fitScore(b) - fitScore(a); })[0];

    function block(title, items, emptyMsg) {
      return '<div class="card"><div class="card-head"><h2>' + esc(title) + '</h2><span class="pill">' + items.length + '</span></div>' +
        (items.length ? '<div class="list">' + items.map(commitmentRow).join('') + '</div>' : '<p class="empty">' + esc(emptyMsg) + '</p>') + '</div>';
    }
    return '<div class="hello"><span class="date">' + esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</span>' +
      '<h1>' + esc(greet + name) + '</h1><p class="muted">Here is what needs you today.</p></div>' +
      '<div class="stat-strip">' +
      '<div class="stat' + (overdue.length ? ' alert' : '') + '"><b>' + overdue.length + '</b><span>Overdue</span></div>' +
      '<div class="stat"><b>' + dueToday.length + '</b><span>Due today</span></div>' +
      '<div class="stat"><b>' + week.length + '</b><span>Due in the next 7 days</span></div>' +
      '<div class="stat"><b>' + pending + '</b><span>Drafts to approve</span></div></div>' +
      '<div class="next-action"><span class="eyebrow">Next career action</span><h2>' + esc(act.title) + '</h2><p>' + esc(act.text) + '</p>' +
      '<p><a href="' + act.link + '">Open ' + (act.link === '#radar' ? 'career radar' : 'promotion tracker') + '</a></p></div>' +
      (overdue.length ? block('Overdue', overdue, '') : '') +
      '<div class="grid g2">' + block('Due today', dueToday, 'Nothing due today.') + block('This week', week, 'Nothing else due this week.') + '</div>' +
      captureBox() +
      '<div class="grid g2">' +
      '<div class="card"><h2>Approvals waiting</h2><p class="muted">' + (pending ? plural(pending, 'draft') + ' waiting for your decision.' : 'Nothing waiting for approval.') + '</p><p><a href="#inbox">Open approvals</a></p></div>' +
      '<div class="card"><h2>Best-fit role</h2>' + (topRole ?
        '<p><b>' + esc(topRole.title) + '</b> at ' + esc(topRole.company) + '</p><p><span class="score ' + scoreClass(fitScore(topRole)) + '">Fit ' + fitScore(topRole) + '%</span> <span class="pill ' + topRole.status + '">' + esc(topRole.status) + '</span></p>'
        : '<p class="muted">No roles tracked yet.</p>') + '<p><a href="#radar">Open career radar</a></p></div></div>';
  };

  VIEW_FN.commitments = function () {
    var f = ui.cFilter;
    var list = state.commitments.filter(function (c) {
      var s = cState(c);
      if (f === 'open') return s !== 'done';
      if (f === 'overdue') return s === 'overdue' || s === 'slipped';
      if (f === 'done') return s === 'done';
      return true;
    }).sort(byDue);
    if (f === 'done') list.reverse();
    var counts = {
      open: state.commitments.filter(function (c) { return cState(c) !== 'done'; }).length,
      overdue: state.commitments.filter(function (c) { var s = cState(c); return s === 'overdue' || s === 'slipped'; }).length,
      done: state.commitments.filter(function (c) { return cState(c) === 'done'; }).length,
      all: state.commitments.length
    };
    var tabs = ['open', 'overdue', 'done', 'all'].map(function (k) {
      return '<button type="button" data-act="cfilter" data-k="' + k + '" aria-pressed="' + (f === k) + '">' + cap(k) + ' · ' + counts[k] + '</button>';
    }).join('');
    return head('Execution', 'Commitments', 'Every promise you make, who it is to, and when it is due.', '<button class="btn primary" type="button" data-act="add-c">Add commitment</button>') +
      captureBox() +
      '<div class="card"><div class="tabs" role="group" aria-label="Filter commitments">' + tabs + '</div>' +
      (list.length ? '<div class="list">' + list.map(commitmentRow).join('') + '</div>' : '<p class="empty">Nothing here. Use quick capture above to add a promise.</p>') + '</div>';
  };

  VIEW_FN.promotion = function () {
    var L = state.levels;
    var crits = L.criteria.map(function (c) {
      var s = critStats(c); var target = c.target || DEFAULT_TARGET;
      var pct = Math.min(100, Math.round(s.count / target * 100));
      return '<div class="card crit' + (s.stale ? ' stale' : '') + '"><div class="card-head"><h3>' + esc(c.name) + '</h3><span class="mono small">' + s.count + ' / ' + target + '</span></div>' +
        '<div class="meter" role="img" aria-label="' + s.count + ' of ' + target + ' pieces of evidence"><i style="width:' + pct + '%"></i></div>' +
        '<div class="crit-meta"><span>' + (s.last ? 'Last evidence ' + esc(fmtDate(s.last)) : 'No evidence yet') + '</span>' +
        (s.stale ? '<span class="flag">' + (s.last ? 'No new evidence in ' + Math.floor(s.age / 7) + ' weeks' : 'Gap') + '</span>' : '<span class="pill done">on track</span>') + '</div>' +
        (s.stale ? '<p class="small muted">' + esc(tipFor(c.name)) + '</p>' : '') +
        '<div class="btn-row"><button class="btn sm" type="button" data-act="add-e" data-crit="' + c.id + '">Log evidence</button></div></div>';
    }).join('');
    var ev = state.evidence.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var critName = function (id) { var c = L.criteria.filter(function (x) { return x.id === id; })[0]; return c ? c.name : 'Not linked'; };
    var evHtml = ev.length ? '<div class="list">' + ev.map(function (e) {
      return '<div class="row"><span class="mono small muted">' + esc(fmtDate(e.date)) + '</span><div><div class="what">' + esc(e.title) + '</div><div class="meta"><span class="pill">' + esc(critName(e.criterionId)) + '</span>' + (e.detail ? '<span>' + esc(e.detail) + '</span>' : '') + '</div></div>' +
        '<div class="actions"><button type="button" class="icon-btn" data-act="edit-e" data-id="' + e.id + '">Edit</button><button type="button" class="icon-btn" data-act="del-e" data-id="' + e.id + '">Delete</button></div></div>';
    }).join('') + '</div>' : '<p class="empty">No evidence logged yet. Every win, metric or piece of praise counts.</p>';

    return head('Growth', 'Promotion tracker',
      (L.current || L.next) ? (L.current || 'Current level') + '  →  ' + (L.next || 'next level') + '. A criterion turns red when it has had no new evidence for 6 weeks.' : 'Add your current and next level and the criteria your company uses for promotion.',
      '<button class="btn" type="button" data-act="edit-levels">Edit levels and criteria</button><button class="btn primary" type="button" data-act="add-e">Log evidence</button>') +
      (L.criteria.length ? '<div class="grid g3">' + crits + '</div>' : '<p class="empty">No criteria yet. Click "Edit levels and criteria" and paste them from your company\'s level framework, one per line.</p>') +
      '<div class="card"><h2>Evidence log</h2>' + evHtml + '</div>';
  };

  VIEW_FN.radar = function () {
    var weights = FACTORS.map(function (f) {
      var w = +state.rules[f.key] || 0, dots = '';
      for (var i = 1; i <= 5; i++) dots += '<i class="' + (i <= w ? 'on' : '') + '"></i>';
      return '<div class="weight"><span>' + esc(f.label) + '</span><div class="dots" aria-label="Weight ' + w + ' of 5">' + dots + '</div></div>';
    }).join('');
    var lanes = STAGES.map(function (st) {
      var rs = state.roles.filter(function (r) { return r.status === st.key; }).sort(function (a, b) { return fitScore(b) - fitScore(a); });
      return '<div class="lane"><h3><span>' + esc(st.label) + '</span><span>' + rs.length + '</span></h3>' + rs.map(function (r) {
        var sc = fitScore(r);
        var opts = STAGES.map(function (o) { return '<option value="' + o.key + '"' + (o.key === r.status ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
        return '<div class="role"><span class="score ' + scoreClass(sc) + '">Fit ' + sc + '%</span><div class="title">' + esc(r.title) + '</div>' +
          '<div class="small muted">' + esc(r.company) + (r.location ? ' · ' + esc(r.location) : '') + '</div>' +
          (r.notes ? '<div class="small">' + esc(r.notes) + '</div>' : '') +
          (r.link ? '<a class="small" href="' + esc(r.link) + '" target="_blank" rel="noopener">Job posting</a>' : '') +
          '<label class="small muted" for="st-' + r.id + '">Stage</label><select id="st-' + r.id + '" data-act="role-stage" data-id="' + r.id + '">' + opts + '</select>' +
          '<div class="btn-row"><button type="button" class="icon-btn" data-act="edit-r" data-id="' + r.id + '">Edit</button><button type="button" class="icon-btn" data-act="del-r" data-id="' + r.id + '">Delete</button></div></div>';
      }).join('') + '</div>';
    }).join('');
    return head('Market', 'Career radar', 'CTO, VP Engineering and CEO roles you are watching, scored against your own rules.',
      '<button class="btn" type="button" data-act="edit-rules">Edit scoring rules</button><button class="btn primary" type="button" data-act="add-r">Add role</button>') +
      '<div class="card"><div class="card-head"><h2>Your scoring rules</h2><span class="small muted">How much each factor matters to you, 0 to 5</span></div><div class="weights">' + weights + '</div></div>' +
      (state.roles.length ? '<div class="pipeline">' + lanes + '</div>' : '<p class="empty">No roles yet. Add a role you have seen on a company careers page, a recruiter email or a LinkedIn alert.</p>') +
      '<p class="small muted">Tip: check target companies\' own careers pages and recruiter emails. LinkedIn does not allow bots or automation, so Jarvis never scrapes it.</p>';
  };

  VIEW_FN.review = function () {
    var wins = state.evidence.filter(function (e) { var n = daysFrom(e.date); return n !== null && n <= 0 && n >= -7; });
    var done = state.commitments.filter(function (c) { var n = daysFrom(c.doneOn); return c.status === 'done' && n !== null && n >= -7; });
    var slipped = state.commitments.filter(function (c) { var s = cState(c); return s === 'overdue' || s === 'slipped'; });
    var crits = state.levels.criteria.map(function (c) { return { c: c, s: critStats(c) }; })
      .sort(function (a, b) { return (b.s.age === null ? 9999 : b.s.age) - (a.s.age === null ? 9999 : a.s.age); });
    var stuck = crits[0];
    var act = careerAction();
    var start = addDays(-7);
    function li(arr, fn, emptyMsg) { return arr.length ? '<ul class="review-list">' + arr.map(fn).join('') + '</ul>' : '<p class="empty">' + esc(emptyMsg) + '</p>'; }
    return head('Every Friday', 'Weekly review', 'The week from ' + fmtDate(start) + ' to today.') +
      '<div class="grid g2">' +
      '<div class="card"><div class="card-head"><h2>Wins this week</h2><span class="pill done">' + wins.length + '</span></div>' +
      li(wins, function (e) { return '<li>' + esc(e.title) + '</li>'; }, 'No wins logged this week. Add at least one before you close the week.') + '</div>' +
      '<div class="card"><div class="card-head"><h2>Promises kept</h2><span class="pill done">' + done.length + '</span></div>' +
      li(done, function (c) { return '<li>' + esc(c.what) + (c.who ? ' <span class="muted">for ' + esc(c.who) + '</span>' : '') + '</li>'; }, 'No commitments completed this week.') + '</div>' +
      '<div class="card"><div class="card-head"><h2>Slipped</h2><span class="pill ' + (slipped.length ? 'overdue' : 'done') + '">' + slipped.length + '</span></div>' +
      li(slipped, function (c) { return '<li>' + esc(c.what) + ' <span class="muted">· was due ' + esc(fmtDate(c.due)) + '</span></li>'; }, 'Nothing slipped. Well done.') + '</div>' +
      '<div class="card"><h2>Promotion gap that has not moved</h2>' + (stuck ?
        '<p><b>' + esc(stuck.c.name) + '</b></p><p class="muted">' + (stuck.s.last ? 'Last evidence ' + esc(fmtDate(stuck.s.last)) + '.' : 'No evidence logged yet.') + '</p>'
        : '<p class="empty">Add promotion criteria to see this.</p>') + '</div></div>' +
      '<div class="next-action"><span class="eyebrow">Suggested next step</span><h2>' + esc(act.title) + '</h2><p>' + esc(act.text) + '</p></div>';
  };

  VIEW_FN.inbox = function () {
    var f = ui.dFilter;
    var list = state.drafts.filter(function (d) { return f === 'all' ? true : f === 'pending' ? d.status === 'pending' : d.status !== 'pending'; })
      .sort(function (a, b) { return a.created < b.created ? 1 : -1; });
    var tabs = [['pending', 'Waiting'], ['decided', 'Decided'], ['all', 'All']].map(function (t) {
      return '<button type="button" data-act="dfilter" data-k="' + t[0] + '" aria-pressed="' + (f === t[0]) + '">' + t[1] + '</button>';
    }).join('');
    return head('Approvals', 'Approval inbox', 'Nothing goes out in your name without your decision. In version 2, Jarvis writes these drafts for you with AI.',
      '<button class="btn primary" type="button" data-act="add-d">New draft</button>') +
      '<div class="card"><div class="tabs" role="group" aria-label="Filter drafts">' + tabs + '</div>' +
      (list.length ? list.map(function (d) {
        return '<div class="draft"><div class="card-head"><div><b>' + esc(d.subject || '(no subject)') + '</b><div class="small muted">To ' + esc(d.to || '?') + ' · ' + esc(fmtDate(d.created)) + '</div></div><span class="pill ' + d.status + '">' + esc(d.status) + '</span></div>' +
          '<div class="body">' + esc(d.body) + '</div>' +
          '<div class="btn-row">' +
          (d.status === 'pending' ? '<button type="button" class="btn sm primary" data-act="approve-d" data-id="' + d.id + '">Approve</button>' : '') +
          '<button type="button" class="btn sm" data-act="edit-d" data-id="' + d.id + '">Edit</button>' +
          (d.status === 'pending' ? '<button type="button" class="btn sm danger" data-act="reject-d" data-id="' + d.id + '">Reject</button>' : '') +
          '<button type="button" class="btn sm" data-act="copy-d" data-id="' + d.id + '">Copy text</button>' +
          '<button type="button" class="icon-btn" data-act="del-d" data-id="' + d.id + '">Delete</button></div></div>';
      }).join('') : '<p class="empty">Nothing here.</p>') + '</div>';
  };

  VIEW_FN.profile = function () {
    var p = state.profile;
    function row(k, v) { return '<dt>' + esc(k) + '</dt><dd>' + (v ? esc(v) : '<span class="muted">Not set</span>') + '</dd>'; }
    var people = state.people.length ? '<div class="list">' + state.people.map(function (x) {
      return '<div class="row"><span class="pill">' + esc(x.relation) + '</span><div><div class="what">' + esc(x.name) + '</div>' + (x.note ? '<div class="meta">' + esc(x.note) + '</div>' : '') + '</div>' +
        '<div class="actions"><button type="button" class="icon-btn" data-act="edit-p" data-id="' + x.id + '">Edit</button><button type="button" class="icon-btn" data-act="del-p" data-id="' + x.id + '">Delete</button></div></div>';
    }).join('') + '</div>' : '<p class="empty">Add your manager, sponsors, mentors and key peers.</p>';
    return head('Identity', 'My profile', 'What Jarvis knows about you. Keep it short and true.', '<button class="btn primary" type="button" data-act="edit-profile">Edit profile</button>') +
      '<div class="card"><dl class="kv">' + row('Name', p.name) + row('Current role', p.role) + row('Goal', p.goal) + row('Timeframe', p.timeframe) +
      row('Career thesis', p.thesis) + row('Non-negotiables', p.nonneg) + row('Strengths', p.strengths) + row('Gaps to close', p.gaps) + '</dl></div>' +
      '<div class="card"><div class="card-head"><h2>People map</h2><button class="btn sm" type="button" data-act="add-p">Add person</button></div>' + people + '</div>' +
      '<div class="card"><h2>Your data</h2><p class="muted small">Everything is stored only in this browser on this device. Export a backup regularly, and import it to move to another device.</p>' +
      '<div class="btn-row"><button class="btn" type="button" data-act="export">Export backup</button><button class="btn" type="button" data-act="import">Import backup</button><button class="btn danger" type="button" data-act="reset">Delete all data</button></div></div>';
  };

  // ---------- forms ----------
  var dlg = $('#dlg'), dlgForm = $('#dlgForm'), dlgFields = $('#dlgFields');
  var onSave = null;

  function field(f, val) {
    var id = 'f-' + f.name;
    var v = val == null ? (f.value == null ? '' : f.value) : val;
    var input;
    if (f.type === 'textarea') input = '<textarea id="' + id + '" name="' + f.name + '"' + (f.required ? ' required' : '') + '>' + esc(v) + '</textarea>';
    else if (f.type === 'select') input = '<select id="' + id + '" name="' + f.name + '">' + f.options.map(function (o) {
      var ov = typeof o === 'object' ? o.value : o, ol = typeof o === 'object' ? o.label : o;
      return '<option value="' + esc(ov) + '"' + (String(ov) === String(v) ? ' selected' : '') + '>' + esc(ol) + '</option>';
    }).join('') + '</select>';
    else input = '<input id="' + id + '" name="' + f.name + '" type="' + (f.type || 'text') + '" value="' + esc(v) + '"' + (f.required ? ' required' : '') + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + '>';
    return '<div class="field"><label for="' + id + '">' + esc(f.label) + '</label>' + input + (f.help ? '<span class="help">' + esc(f.help) + '</span>' : '') + '</div>';
  }
  function openForm(opts) {
    $('#dlgTitle').textContent = opts.title;
    var hint = $('#dlgHint'); hint.hidden = !opts.hint; hint.textContent = opts.hint || '';
    $('#dlgSave').textContent = opts.saveLabel || 'Save';
    var vals = opts.values || {};
    dlgFields.innerHTML = opts.fields.map(function (f) {
      if (Array.isArray(f)) return '<div class="field-row">' + f.map(function (g) { return field(g, vals[g.name]); }).join('') + '</div>';
      return field(f, vals[f.name]);
    }).join('');
    onSave = opts.onSave;
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    var first = dlgFields.querySelector('input,textarea,select'); if (first) first.focus();
  }
  function closeForm() { if (dlg.open) dlg.close(); onSave = null; }
  dlgForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {};
    new FormData(dlgForm).forEach(function (v, k) { data[k] = typeof v === 'string' ? v.trim() : v; });
    var fn = onSave; closeForm();
    if (fn) { fn(data); save(); render(); }
  });
  $('#dlgCancel').addEventListener('click', closeForm);

  var SOURCES = ['Email', 'Meeting', 'Chat', 'Call', 'Other'];
  function commitmentForm(c, isNew, hint) {
    openForm({
      title: isNew ? 'Add commitment' : 'Edit commitment', hint: hint, saveLabel: isNew ? 'Add' : 'Save',
      values: c,
      fields: [
        { name: 'what', label: 'What did you promise?', required: true },
        [{ name: 'who', label: 'To whom' }, { name: 'due', label: 'Due date', type: 'date' }],
        [{ name: 'source', label: 'Where you promised it', type: 'select', options: SOURCES },
         { name: 'status', label: 'Status', type: 'select', options: [{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }, { value: 'slipped', label: 'Slipped' }] }]
      ],
      onSave: function (d) {
        var wasDone = c.status === 'done';
        Object.assign(c, d);
        if (d.status === 'done' && !wasDone) c.doneOn = addDays(0);
        if (d.status !== 'done') delete c.doneOn;
        if (isNew) { c.id = uid(); c.created = addDays(0); state.commitments.push(c); toast('Commitment added'); }
        else toast('Saved');
      }
    });
  }
  function evidenceForm(e, isNew) {
    var opts = [{ value: '', label: 'Not linked' }].concat(state.levels.criteria.map(function (c) { return { value: c.id, label: c.name }; }));
    openForm({
      title: isNew ? 'Log evidence' : 'Edit evidence', saveLabel: isNew ? 'Log' : 'Save', values: e,
      hint: 'A win, a metric, praise from a senior person, or anything that proves you work at the next level.',
      fields: [
        { name: 'title', label: 'What happened', required: true, placeholder: 'Cut cloud spend 18% with reserved instances' },
        [{ name: 'date', label: 'Date', type: 'date', required: true }, { name: 'criterionId', label: 'Promotion criterion', type: 'select', options: opts }],
        { name: 'detail', label: 'Detail or metric', type: 'textarea' }
      ],
      onSave: function (d) {
        Object.assign(e, d);
        if (isNew) { e.id = uid(); state.evidence.push(e); toast('Evidence logged'); } else toast('Saved');
      }
    });
  }
  function roleForm(r, isNew) {
    var ratingOpts = [1, 2, 3, 4, 5].map(function (n) { return { value: n, label: n + ' · ' + ['Poor', 'Weak', 'OK', 'Good', 'Ideal'][n - 1] }; });
    var vals = Object.assign({}, r); FACTORS.forEach(function (f) { vals['r_' + f.key] = r.r ? r.r[f.key] : 3; });
    openForm({
      title: isNew ? 'Add role' : 'Edit role', saveLabel: isNew ? 'Add' : 'Save', values: vals,
      hint: 'Rate how well this role matches you on each factor. Jarvis combines them with your scoring rules.',
      fields: [
        [{ name: 'title', label: 'Role title', required: true, placeholder: 'Chief Technology Officer' }, { name: 'company', label: 'Company', required: true }],
        [{ name: 'location', label: 'Location' }, { name: 'status', label: 'Stage', type: 'select', options: STAGES.map(function (s) { return { value: s.key, label: s.label }; }) }],
        { name: 'link', label: 'Link to job posting', type: 'url', placeholder: 'https://' },
        FACTORS.slice(0, 3).map(function (f) { return { name: 'r_' + f.key, label: f.label, type: 'select', options: ratingOpts }; }),
        FACTORS.slice(3).map(function (f) { return { name: 'r_' + f.key, label: f.label, type: 'select', options: ratingOpts }; }),
        { name: 'notes', label: 'Notes', type: 'textarea' }
      ],
      onSave: function (d) {
        r.r = r.r || {};
        FACTORS.forEach(function (f) { r.r[f.key] = +d['r_' + f.key] || 3; delete d['r_' + f.key]; });
        Object.assign(r, d);
        if (isNew) { r.id = uid(); r.added = addDays(0); state.roles.push(r); toast('Role added · fit ' + fitScore(r) + '%'); }
        else toast('Saved · fit ' + fitScore(r) + '%');
      }
    });
  }
  function draftForm(d, isNew) {
    openForm({
      title: isNew ? 'New draft' : 'Edit draft', values: d, saveLabel: isNew ? 'Add' : 'Save',
      fields: [[{ name: 'to', label: 'To', required: true }, { name: 'subject', label: 'Subject' }], { name: 'body', label: 'Message', type: 'textarea', required: true }],
      onSave: function (x) {
        var changed = !isNew && (x.body !== d.body || x.subject !== d.subject);
        Object.assign(d, x);
        if (isNew) { d.id = uid(); d.status = 'pending'; d.created = addDays(0); state.drafts.push(d); toast('Draft added'); }
        else { if (changed && d.status === 'pending') d.status = 'edited'; toast('Saved'); }
      }
    });
  }
  function personForm(p, isNew) {
    openForm({
      title: isNew ? 'Add person' : 'Edit person', values: p, saveLabel: isNew ? 'Add' : 'Save',
      fields: [[{ name: 'name', label: 'Name', required: true }, { name: 'relation', label: 'Relationship', type: 'select', options: ['Manager', 'Skip-level', 'Sponsor', 'Mentor', 'Key peer', 'Direct report', 'Board member', 'Recruiter', 'Other'] }],
        { name: 'note', label: 'Notes', type: 'textarea', help: 'What they care about, how often you meet, what you owe them.' }],
      onSave: function (x) { Object.assign(p, x); if (isNew) { p.id = uid(); state.people.push(p); } toast('Saved'); }
    });
  }

  // ---------- actions ----------
  function find(arr, id) { return arr.filter(function (x) { return x.id === id; })[0]; }
  function remove(arr, id) { var i = arr.findIndex(function (x) { return x.id === id; }); if (i >= 0) arr.splice(i, 1); }
  function confirmThen(title, text, label, fn) {
    openForm({ title: title, hint: text, fields: [], saveLabel: label, onSave: fn });
  }

  function exportData() {
    try {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'jarvis-backup-' + addDays(0) + '.json';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('Backup downloaded');
    } catch (e) { toast('Export failed in this browser.'); }
  }
  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        if (!obj || !obj.levels || !Array.isArray(obj.commitments)) throw new Error('bad');
        state = normalize(obj); save(); render(); toast('Backup restored');
      } catch (e) { toast('That file is not a Jarvis backup. Choose a file you exported from Jarvis.'); }
    };
    reader.readAsText(file);
  }

  function handle(act, el) {
    var id = el.dataset.id, x;
    switch (act) {
      case 'clear-sample':
        confirmThen('Clear sample data?', 'This removes all the example items so you can start with your own. Your theme setting stays.', 'Clear sample data', function () { state = emptyState(); toast('Sample data cleared. Start with your profile.'); location.hash = '#profile'; });
        break;
      case 'reset':
        confirmThen('Delete all data?', 'This permanently deletes everything stored in Jarvis on this device. Export a backup first if you want to keep it.', 'Delete everything', function () { state = emptyState(); toast('All data deleted'); });
        break;
      case 'cfilter': ui.cFilter = el.dataset.k; render(); break;
      case 'dfilter': ui.dFilter = el.dataset.k; render(); break;
      case 'toggle-c':
        x = find(state.commitments, id); if (!x) return;
        if (x.status === 'done') { x.status = 'open'; delete x.doneOn; } else { x.status = 'done'; x.doneOn = addDays(0); toast('Done. Promise kept.'); }
        save(); render(); break;
      case 'add-c': commitmentForm({ what: '', who: '', due: addDays(1), source: 'Meeting', status: 'open' }, true); break;
      case 'edit-c': x = find(state.commitments, id); if (x) commitmentForm(x, false); break;
      case 'del-c': remove(state.commitments, id); save(); render(); toast('Deleted'); break;
      case 'add-e': evidenceForm({ title: '', date: addDays(0), criterionId: el.dataset.crit || '', detail: '' }, true); break;
      case 'edit-e': x = find(state.evidence, id); if (x) evidenceForm(x, false); break;
      case 'del-e': remove(state.evidence, id); save(); render(); toast('Deleted'); break;
      case 'edit-levels':
        openForm({
          title: 'Levels and criteria', saveLabel: 'Save',
          hint: 'Copy the criteria from your company\'s level or career framework. One per line. Optionally add ": 4" to set how many pieces of evidence you want for it (default 3).',
          values: { current: state.levels.current, next: state.levels.next, criteria: state.levels.criteria.map(function (c) { return c.name + ((c.target || DEFAULT_TARGET) !== DEFAULT_TARGET ? ': ' + c.target : ''); }).join('\n') },
          fields: [[{ name: 'current', label: 'Current level' }, { name: 'next', label: 'Next level' }], { name: 'criteria', label: 'Criteria for the next level', type: 'textarea' }],
          onSave: function (d) {
            var old = state.levels.criteria;
            var list = d.criteria.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
              var m = l.match(/^(.*?):\s*(\d{1,2})$/); var name = m ? m[1].trim() : l; var target = m ? Math.max(1, +m[2]) : DEFAULT_TARGET;
              var ex = old.filter(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })[0];
              return { id: ex ? ex.id : uid(), name: name, target: target };
            });
            state.levels = { current: d.current, next: d.next, criteria: list };
            var ids = list.map(function (c) { return c.id; });
            state.evidence.forEach(function (e) { if (ids.indexOf(e.criterionId) < 0) e.criterionId = ''; });
            toast('Criteria saved');
          }
        });
        break;
      case 'add-r': roleForm({ title: '', company: '', location: '', status: 'interested', link: '', notes: '' }, true); break;
      case 'edit-r': x = find(state.roles, id); if (x) roleForm(x, false); break;
      case 'del-r': remove(state.roles, id); save(); render(); toast('Deleted'); break;
      case 'edit-rules':
        var wOpts = [0, 1, 2, 3, 4, 5].map(function (n) { return { value: n, label: n === 0 ? '0 · Ignore' : n === 5 ? '5 · Essential' : String(n) }; });
        openForm({
          title: 'Scoring rules', hint: 'How much each factor matters to you. A role\'s fit score is its ratings weighted by these numbers.',
          values: state.rules,
          fields: FACTORS.map(function (f) { return { name: f.key, label: f.label, type: 'select', options: wOpts }; }),
          onSave: function (d) { FACTORS.forEach(function (f) { state.rules[f.key] = +d[f.key]; }); toast('Scoring rules saved'); }
        });
        break;
      case 'add-d': draftForm({ to: '', subject: '', body: '' }, true); break;
      case 'edit-d': x = find(state.drafts, id); if (x) draftForm(x, false); break;
      case 'approve-d': x = find(state.drafts, id); if (x) { x.status = 'approved'; save(); render(); toast('Approved. Copy it into your email or chat to send.'); } break;
      case 'reject-d': x = find(state.drafts, id); if (x) { x.status = 'rejected'; save(); render(); toast('Rejected'); } break;
      case 'del-d': remove(state.drafts, id); save(); render(); toast('Deleted'); break;
      case 'copy-d':
        x = find(state.drafts, id); if (!x) return;
        var text = (x.subject ? 'Subject: ' + x.subject + '\n\n' : '') + x.body;
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Copied'); }, function () { toast('Copy failed. Select the text and copy it.'); });
        else toast('Select the text and copy it.');
        break;
      case 'edit-profile':
        openForm({
          title: 'Edit profile', values: state.profile,
          fields: [[{ name: 'name', label: 'First name' }, { name: 'role', label: 'Current role' }],
            [{ name: 'goal', label: 'Goal', type: 'select', options: ['CTO', 'CEO', 'CTO, then CEO', 'VP Engineering', 'Other'] }, { name: 'timeframe', label: 'Timeframe', placeholder: 'Within 3 years' }],
            { name: 'thesis', label: 'Career thesis', type: 'textarea', help: 'What role, at what kind of company, where.' },
            { name: 'nonneg', label: 'Non-negotiables', type: 'textarea' },
            { name: 'strengths', label: 'Strengths', type: 'textarea' },
            { name: 'gaps', label: 'Gaps to close', type: 'textarea' }],
          onSave: function (d) { Object.assign(state.profile, d); toast('Profile saved'); }
        });
        break;
      case 'add-p': personForm({ name: '', relation: 'Manager', note: '' }, true); break;
      case 'edit-p': x = find(state.people, id); if (x) personForm(x, false); break;
      case 'del-p': remove(state.people, id); save(); render(); toast('Deleted'); break;
      case 'export': exportData(); break;
      case 'import': $('#importFile').click(); break;
    }
  }

  main.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT') return;
    handle(el.dataset.act, el);
  });
  main.addEventListener('change', function (e) {
    var el = e.target;
    if (el.dataset && el.dataset.act === 'role-stage') {
      var r = find(state.roles, el.dataset.id); if (r) { r.status = el.value; save(); render(); toast('Moved to ' + el.value); }
    }
  });
  main.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.dataset.form === 'capture') {
      e.preventDefault();
      var text = f.capture.value.trim();
      if (!text) { toast('Type a promise first, for example: I\'ll send the report to Omar by Friday'); return; }
      var p = parseCapture(text);
      commitmentForm({ what: p.what || text, who: p.who, due: p.due, source: p.source, status: 'open' }, true, 'Check what Jarvis understood, then add it.');
    }
  });

  // ---------- sidebar tools ----------
  var THEMES = ['system', 'light', 'dark'];
  function getTheme() { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; } }
  function applyTheme(t) {
    if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    $('#themeBtn').textContent = 'Theme: ' + cap(t);
  }
  $('#themeBtn').addEventListener('click', function () {
    var t = THEMES[(THEMES.indexOf(getTheme()) + 1) % 3];
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ }
    applyTheme(t);
  });
  $('#exportBtn').addEventListener('click', exportData);
  $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
  $('#importFile').addEventListener('change', function (e) { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });

  window.addEventListener('hashchange', function () { render(); main.focus({ preventScroll: true }); window.scrollTo(0, 0); });

  // expose parser for tests
  window.JarvisTest = { parseCapture: parseCapture, fitScore: function (r) { return fitScore(r); } };

  state = load();
  applyTheme(getTheme());
  save();
  render();
})();

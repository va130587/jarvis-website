/* NOVA app: router, dialogs, HUD helpers, reminders, and the screens
   Today, Tasks, Calendar, Notes, Growth, Weekly review, Profile, Settings and Voice commands. */
(function () {
  'use strict';

  var J = window.J;
  var esc = J.esc;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  J.$ = $; J.$$ = $$;

  J.screens = {};
  J.actions = {};
  J.forms = {};
  var main = $('#main');
  var current = 'today';
  var ui = { taskFilter: 'open', taskPriority: 'all', taskQuery: '', noteQuery: '', winKind: 'all', calOffset: 0 };
  J.ui = ui;

  /* ================= small UI helpers ================= */
  // Messages stack (newest last, at most three) instead of replacing each other, so a reminder cannot hide a result you need to see.
  J.toast = function (msg, withUndo) {
    var el = $('#toast'); msg = String(msg); J.lastToast = msg;
    Array.prototype.slice.call(el.children).forEach(function (c) { if (c.getAttribute('data-msg') === msg) c.remove(); });
    var row = document.createElement('div'); row.className = 't-msg'; row.setAttribute('data-msg', msg);
    row.innerHTML = '<span>' + esc(msg) + '</span>' + (withUndo && J.canUndo() ? '<button type="button" class="btn small" data-act="undo">Undo</button>' : '');
    el.appendChild(row);
    while (el.children.length > 3) el.removeChild(el.firstChild);
    el.classList.add('show');
    setTimeout(function () { row.remove(); if (!el.children.length) el.classList.remove('show'); }, withUndo ? 6500 : 3800);
  };
  J.actions.undo = function () { if (J.undo()) J.toast('Restored.'); };

  // Segmented circular progress ring.
  J.ring = function (pct, o) {
    o = o || {};
    var size = o.size || 64, segs = o.segs || 30, r = size / 2 - 4, cx = size / 2, gap = 0.035;
    pct = J.clamp(Math.round(pct || 0), 0, 100);
    var on = Math.round(pct / 100 * segs), paths = '';
    for (var i = 0; i < segs; i++) {
      var a0 = (i / segs) * Math.PI * 2 + gap, a1 = ((i + 1) / segs) * Math.PI * 2 - gap;
      var x0 = cx + r * Math.cos(a0), y0 = cx + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cx + r * Math.sin(a1);
      paths += '<path ' + (i < on ? 'class="on" style="--i:' + i + '" ' : '') + 'd="M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + 'A' + r + ' ' + r + ' 0 0 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + '"/>';
    }
    return '<span class="ring ' + (o.tone || '') + (size >= 90 ? ' lg' : '') + '" role="img" aria-label="' + esc(o.label || pct + ' percent') + '"><svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' + paths + '</svg><b aria-hidden="true">' + (o.text != null ? esc(o.text) : pct + '%') + '</b></span>';
  };
  J.bar = function (pct) { return '<span class="bar" aria-hidden="true"><i style="--w:' + J.clamp(pct, 0, 100) + '%"></i></span>'; };
  J.tag = function (text, cls) { return '<span class="tag ' + (cls || '') + '">' + esc(text) + '</span>'; };
  J.sampleTag = function (x) { return x && x.sample ? J.tag('Sample', 'sample') : ''; };
  var ICON = {
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    del: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4M12 13v5M9.5 15.5h5"/>'
  };
  J.ICON = ICON;
  J.iconBtn = function (act, id, label, icon, cls) {
    return '<button type="button" class="icon-btn ' + (cls || '') + '" data-act="' + act + '" data-id="' + esc(id) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[icon] + '</svg></button>';
  };
  J.head = function (eyebrow, title, sub, actions) {
    return '<header class="view-head"><div><p class="eyebrow">' + esc(eyebrow) + '</p><h1 data-decode>' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' + (actions ? '<div class="head-actions">' + actions + '</div>' : '') + '</header>';
  };
  J.empty = function (html) {   // "Loading…" and "Planning…" placeholders become skeleton lines; the words stay for screen readers
    if (/^(Loading|Planning)…/.test(html)) return '<p class="empty loading" role="status"><span class="sk" aria-hidden="true"></span><span class="sk" aria-hidden="true"></span><span class="sk" aria-hidden="true"></span><span>' + html + '</span></p>';
    return '<p class="empty">' + html + '</p>';
  };
  J.seg = function (group, val, cur, label) {
    return '<button type="button" class="seg" data-act="seg" data-group="' + group + '" data-id="' + esc(val) + '" aria-pressed="' + (String(cur) === String(val)) + '">' + esc(label) + '</button>';
  };
  J.actions.seg = function (id, el) { ui[el.getAttribute('data-group')] = id; render(false); };
  function greeting() { var h = J.hourNow(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
  J.greeting = greeting;
  function highlight(text, q) {
    var safe = esc(text);
    if (!q) return safe;
    return safe.replace(new RegExp('(' + J.reEsc(esc(q)) + ')', 'gi'), '<mark>$1</mark>');
  }
  J.highlight = highlight;

  /* ================= dialogs ================= */
  var dialogCfg = null;
  J.openForm = function (cfg) {
    var dlg = $('#formDialog');
    dialogCfg = cfg;
    $('#formTitle').textContent = cfg.title;
    $('#dialogSave').textContent = cfg.submit || 'Save';
    $('#dialogCancel').hidden = !!cfg.hideCancel; // information-only dialogs need just one button
    $('#formError').textContent = '';
    $('#dialogFields').innerHTML = cfg.fields.map(fieldHTML).join('');
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
    var first = $('#dialogFields input:not([type=checkbox]), #dialogFields textarea, #dialogFields select');
    if (first && !cfg.noFocus) first.focus();
    if (cfg.after) cfg.after($('#dialogFields'));
  };
  function fieldHTML(f) {
    if (f.type === 'html') return '<div class="block">' + f.html + '</div>';
    var id = 'f_' + f.name, v = f.value == null ? '' : f.value, ctl;
    var common = ' id="' + id + '" name="' + f.name + '"' + (f.required ? ' required aria-required="true"' : '') + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '');
    if (f.type === 'textarea') ctl = '<textarea' + common + ' rows="' + (f.rows || 4) + '">' + esc(v) + '</textarea>';
    else if (f.type === 'select') ctl = '<select' + common + '>' + f.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
    else ctl = '<input type="' + (f.type || 'text') + '"' + common + ' value="' + esc(v) + '"' + (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') + (f.step != null ? ' step="' + f.step + '"' : '') + '>';
    return '<div class="field' + (f.half ? ' half' : '') + '"><label for="' + id + '">' + esc(f.label) + '</label>' + ctl + (f.hint ? '<small>' + esc(f.hint) + '</small>' : '') + '</div>';
  }
  J.closeForm = function () {
    var dlg = $('#formDialog');
    if (dlg.open && typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
    dialogCfg = null;
  };
  function bindDialog() {
    $('#dialogForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!dialogCfg) return J.closeForm();
      var vals = {}, missing = null;
      dialogCfg.fields.forEach(function (f) {
        if (f.type === 'html') return;
        var el = $('#f_' + f.name);
        vals[f.name] = el ? el.value.trim() : '';
        if (f.required && !vals[f.name] && !missing) missing = f;
      });
      if (dialogCfg.collect) dialogCfg.collect(vals, $('#dialogFields'));
      if (missing) { $('#formError').textContent = missing.label + ' is required.'; $('#f_' + missing.name).focus(); return; }
      var cfg = dialogCfg;
      if (cfg.validate) { var err = cfg.validate(vals); if (err) { $('#formError').textContent = err; return; } }
      J.closeForm();
      cfg.onSave(vals);
    });
    $('#dialogCancel').addEventListener('click', J.closeForm);
    $('#formDialog').addEventListener('close', function () { if (!this.open) dialogCfg = null; }); // a dialog opened right after another one closed keeps its settings
  }
  // Promise-based confirmation dialog.
  J.confirm = function (text, okLabel, title) {
    var dlg = $('#confirmDialog');
    $('#confirmTitle').textContent = title || 'Are you sure?';
    $('#confirmText').textContent = text;
    $('#confirmYes').textContent = okLabel || 'Confirm';
    return new Promise(function (resolve) {
      if (typeof dlg.showModal !== 'function') { resolve(window.confirm(text)); return; }
      function done() { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'yes'); }
      dlg.returnValue = '';
      dlg.addEventListener('close', done);
      dlg.showModal();
      $('#confirmNo').focus();
    });
  };

  /* ================= render + router ================= */
  var TITLES = { today: 'Today', tasks: 'Tasks', calendar: 'Calendar', notes: 'Notes', matches: 'Jobs for you', jobs: 'Job finder', applications: 'Applications', growth: 'Growth', review: 'Weekly review', profile: 'Profile', settings: 'Settings', help: 'Voice commands' };
  J.titles = TITLES;
  function render(animate) {
    var scr = J.screens[current];
    if (!scr) return;
    var active = document.activeElement, activeId = active && main.contains(active) ? active.id : '', caret = null, activeSel = null, onTitle = !!(active && active.matches && active.matches('main h1'));
    if (activeId) { try { caret = active.selectionStart; } catch (e) { caret = null; } }
    else if (active && main.contains(active) && active.getAttribute('data-act')) {   // a button without an id: find it again by what it does
      activeSel = '[data-act="' + active.getAttribute('data-act') + '"]' + (active.hasAttribute('data-id') ? '[data-id="' + CSS.escape(active.getAttribute('data-id')) + '"]' : '');
      activeSel = { sel: activeSel, n: $$(activeSel, main).indexOf(active) };
    }
    main.innerHTML = scr.render();
    main.classList.remove('enter');
    if (animate && !J.calm()) { void main.offsetWidth; main.classList.add('enter'); }
    $$('[data-view]').forEach(function (a) { if (a.getAttribute('data-view') === current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('#crumbView').textContent = TITLES[current];
    document.title = current === 'today' ? 'NOVA' : TITLES[current] + ' · NOVA';
    if (scr.after) scr.after();
    countUps(animate);
    if (animate) decode();
    badges();
    $('#sampleBanner').hidden = !J.hasSample();
    if (!animate && activeSel && document.activeElement === document.body) {
      var same = $$(activeSel.sel, main)[activeSel.n];
      if (same) same.focus({ preventScroll: true });
    }
    if (!animate && onTitle && document.activeElement === document.body) {      // the page title had focus (after a page change): keep it there when the page redraws with new data
      var t = main.querySelector('h1'); if (t) { t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); }
    }
    if (!animate && activeId) {
      var again = document.getElementById(activeId);
      if (again && again !== document.activeElement) {
        again.focus({ preventScroll: true });
        if (caret != null && again.setSelectionRange) { try { again.setSelectionRange(caret, caret); } catch (e) { /* not a text field */ } }
      }
    }
    document.dispatchEvent(new CustomEvent('jarvis:rendered', { detail: { view: current } }));
  }
  J.render = render;
  J.current = function () { return current; };
  J.go = function (view) {
    if (!J.screens[view]) return false;
    if (location.hash === '#' + view) { current = view; render(true); }
    else location.hash = view;
    return true;
  };
  function route(initial) {
    var h = location.hash.slice(1);
    if (!J.screens[h]) { if (!initial) return; h = 'today'; }
    current = h;
    render(true);
    closeMore();
    if (!initial) {
      window.scrollTo(0, 0);
      var title = main.querySelector('h1');                                  // focus moves to the page title, and the new page is announced politely
      if (title) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); } else main.focus({ preventScroll: true });
      var say = $('#navAnnounce'); if (say) say.textContent = TITLES[current] + ' page';
    }
  }
  function badges() {
    var counts = { overdue: J.overdue().length, newjobs: J.jobs ? J.jobs.newJobs().length : 0, newmatches: J.matches ? J.matches.newCount() : 0 };
    $$('[data-badge]').forEach(function (el) {
      var k = el.getAttribute('data-badge'), n = counts[k];
      el.hidden = !n; el.textContent = n || '';
      el.setAttribute('aria-label', n ? n + (k === 'overdue' ? ' overdue' : ' new') : '');
    });
  }
  J.badges = badges;
  function countUps(animate) {
    $$('[data-count]', main).forEach(function (el) {
      var to = +el.getAttribute('data-count') || 0;
      if (!animate || J.calm() || !to) { el.textContent = to; return; }
      el.textContent = '0';
      var t0 = null;
      function step(ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / 400);
        el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }
  // Short "decode" effect on the screen heading.
  var GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#/<>_';
  function decode() {
    var h = $('[data-decode]', main);
    if (!h || J.calm()) return;
    var final = h.textContent, t0 = null, dur = 520;
    h.setAttribute('aria-label', final);
    function step(ts) {
      if (!h.isConnected) return;
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur), fixed = Math.floor(final.length * p), out = '';
      for (var i = 0; i < final.length; i++) out += i < fixed || final[i] === ' ' ? final[i] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      h.textContent = out;
      if (p < 1) requestAnimationFrame(step); else { h.textContent = final; h.removeAttribute('aria-label'); }
    }
    requestAnimationFrame(step);
  }

  /* ================= TODAY ================= */
  J.screens.today = {
    render: function () {
      var t = J.today(), o = J.overdue(), d = J.dueToday(), w = J.dueWeek(), ns = J.nextStep();
      var name = J.data.profile.name || 'Roshan';
      var goal = +J.data.settings.weeklyGoal || 0, sent = J.appsThisWeek().length;
      var line = o.length || d.length
        ? 'You have ' + (o.length ? J.plural(o.length, 'overdue task') : '') + (o.length && d.length ? ' and ' : '') + (d.length ? J.plural(d.length, 'task') + ' due today' : '') + '.'
        : 'Nothing is overdue or due today. ' + (w.length ? J.plural(w.length, 'task') + ' due later this week.' : 'Your week is clear.');
      var soon = J.deadlines(7);
      var timed = J.upcoming(7).filter(function (x) { return x.time && !x.appId; }).map(function (x) { return { date: x.due, time: x.time, text: J.taskPhrase(x), kind: 'reminder' }; });
      var seen = {};
      var agenda = soon.concat(timed).filter(function (x) { var k = x.date + x.text; if (seen[k]) return false; seen[k] = 1; return true; })
        .sort(function (a, b) { return (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')); }).slice(0, 6);
      if (J.cal) {
        // Calendar events (Google, Outlook, .ics) in the next 7 days join the agenda.
        var evMap = J.cal.itemsByDay(t, J.addDays(t, 7));
        Object.keys(evMap).forEach(function (dd) { evMap[dd].forEach(function (it) { if (it.kind === 'event' && !it.cont && (it.allDay || it.endTs > Date.now())) agenda.push({ date: dd, time: it.allDay ? '' : it.time, text: it.title, kind: 'event', source: it.source }); }); });
        agenda.sort(function (a, b) { return (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')); });
        agenda = agenda.slice(0, 6);
      }
      var nx = J.cal ? J.cal.next() : null;
      var nextLine = nx ? '<p class="next-event"><span class="dot" style="background:' + esc(nx.color || 'var(--gold)') + '"></span>Next: <b>' + esc(nx.title) + '</b> ' + esc(nx.date === t ? 'at ' + J.fmtTime(nx.time) : J.when(nx.date, nx.time)) + ' <span class="muted">· ' + esc(nx.source) + '</span></p>' : '';
      var newJobs = J.jobs ? J.jobs.newJobs() : [];
      var hasCache = J.jobs && J.jobs.cache();
      return '<section class="hero">' +
          '<div class="core-stage"><button type="button" class="core-btn" id="coreBtn" data-act="core" aria-label="Talk to NOVA"><canvas id="coreOrb" aria-hidden="true"></canvas></button>' +
          '<p class="core-caption" id="coreCaption" aria-hidden="true">Tap to talk</p></div>' +
          '<div>' +
            '<p class="eyebrow">' + esc(J.longDate(t)) + ' · Dubai</p>' +
            '<h1 class="greet" data-decode>' + esc(greeting()) + ', ' + esc(name) + '</h1>' +
            '<p class="lead">' + esc(line) + '</p>' + nextLine +
            '<div class="btn-row"><button type="button" class="btn primary" data-act="talk"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON.mic + '</svg>Talk to NOVA</button>' +
            '<button type="button" class="btn" data-act="say" data-say="brief me">Brief me</button></div>' +
            '<p class="hint">Tap the core, press <kbd>J</kbd>' + (J.data.settings.wake ? ' or say <q>Hey NOVA</q>' : '') + '. Try <q>what\'s due today</q>.</p>' +
            '<p class="live" id="liveLine" aria-live="polite"></p>' +
          '</div>' +
        '</section>' +
        '<div class="stats">' +
          '<a class="panel stat' + (o.length ? ' red' : ' calm') + '" href="#tasks"><span><span class="label">Overdue</span><b class="num" data-count="' + o.length + '">' + o.length + '</b><small>past their due date</small></span></a>' +
          '<a class="panel stat" href="#tasks"><span><span class="label">Due today</span><b class="num" data-count="' + d.length + '">' + d.length + '</b><small>' + esc(J.fmt(t)) + '</small></span></a>' +
          '<a class="panel stat" href="#calendar"><span><span class="label">This week</span><b class="num" data-count="' + w.length + '">' + w.length + '</b><small>after today, to Friday</small></span></a>' +
          '<a class="panel stat gold" href="#applications"><span><span class="label">Applications</span><b class="num" data-count="' + sent + '">' + sent + '</b><small>of ' + goal + ' this week</small></span>' + J.ring(goal ? sent / goal * 100 : 0, { size: 62, segs: 24, tone: 'gold', label: sent + ' of ' + goal + ' applications this week', text: goal ? Math.min(100, Math.round(sent / goal * 100)) + '%' : '–' }) + '</a>' +
        '</div>' +
        '<div class="grid-3">' +
          '<article class="panel' + (ns.tone === 'red' ? ' red' : ' gold') + '"><h2 class="label">Suggested next step</h2><p class="next-text">' + esc(ns.text) + '</p><a class="btn small" href="#' + ns.view + '">' + esc(ns.label) + '</a></article>' +
          '<article class="panel"><div class="panel-head"><h2 class="label">Agenda &amp; deadlines</h2><a class="btn small ghost" href="#calendar">Calendar</a></div>' +
            (agenda.length ? '<ul class="mini-list">' + agenda.map(function (x) {
              return '<li><span class="when">' + esc(J.dueLabel(x.date, x.time)) + '</span><span class="what">' + esc(x.text) + '<small>' + esc(x.kind === 'interview' ? 'Interview' : x.kind === 'deadline' ? 'Application deadline' : x.kind === 'reminder' ? 'Reminder' : 'High priority') + '</small></span></li>';
            }).join('') + '</ul>' : J.empty('Nothing on your calendar, and no deadlines or timed reminders, in the next 7 days.')) +
          '</article>' +
          '<article class="panel"><div class="panel-head"><h2 class="label">New jobs found</h2><a class="btn small ghost" href="#jobs">Job finder</a></div>' +
            (newJobs.length ? '<p class="small-text muted" style="margin:0 0 8px"><b class="gold-text">' + newJobs.length + '</b> new fresher-friendly ' + (newJobs.length === 1 ? 'role' : 'roles') + ' since you last looked.</p><ul class="mini-list">' + newJobs.slice(0, 3).map(function (j) {
              return '<li><span class="when">' + esc(j.score) + '% match</span><span class="what">' + esc(j.title) + '<small>' + esc(j.company + ' · ' + j.city) + '</small></span></li>';
            }).join('') + '</ul>' : J.empty(hasCache ? 'No new roles since you last checked.' : 'Open the <b>Job finder</b> to load live roles from company job boards.')) +
          '</article>' +
        '</div>' + (J.matches ? J.matches.digestHTML() : '');
    }
  };

  /* ================= TASKS ================= */
  var PRI = [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
  var STATUS = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];
  function taskRow(x) {
    var t = J.today(), late = x.status !== 'done' && x.due && x.due < t;
    var kind = x.kind === 'deadline' ? J.tag('Deadline', 'gold') : x.kind === 'interview' ? J.tag('Interview', 'gold') : x.kind === 'followup' ? J.tag('Follow-up', 'dim') : '';
    return '<li class="item' + (late ? ' late' : '') + (x.status === 'done' ? ' done' : '') + (x.priority === 'high' ? ' p-high' : '') + '">' +
      '<button type="button" class="check" role="checkbox" aria-checked="' + (x.status === 'done') + '" data-act="toggleTask" data-id="' + x.id + '" aria-label="' + esc((x.status === 'done' ? 'Mark not done: ' : 'Mark done: ') + x.title) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9"/></svg></button>' +
      '<div class="item-main"><p class="item-title">' + highlight(x.title, ui.taskQuery) + '</p><p class="item-meta">' +
        (x.person ? '<span>' + esc(x.person) + '</span>' : '') +
        '<span class="due">' + (x.status === 'done' ? 'Done' + (x.doneOn ? ' ' + esc(J.fmt(x.doneOn)) : '') : esc(J.dueLabel(x.due, x.time))) + '</span>' +
        (x.priority === 'high' ? J.tag('High', 'gold') : x.priority === 'low' ? J.tag('Low', 'dim') : '') +
        (x.status === 'doing' ? J.tag('In progress') : '') + kind + J.sampleTag(x) +
      '</p></div><div class="item-actions">' + (x.due && x.status !== 'done' ? J.iconBtn('calAdd', x.id, 'Add to Google, Outlook or Apple calendar: ' + x.title, 'cal') : '') + J.iconBtn('editTask', x.id, 'Edit task: ' + x.title, 'edit') + J.iconBtn('delTask', x.id, 'Delete task: ' + x.title, 'del', 'del') + '</div></li>';
  }
  J.taskRow = taskRow;
  J.screens.tasks = {
    render: function () {
      var t = J.today(), we = J.weekEnd(t), q = ui.taskQuery.toLowerCase().trim();
      var items = J.data.tasks.filter(function (x) {
        if (ui.taskFilter === 'open' && x.status === 'done') return false;
        if (ui.taskFilter === 'done' && x.status !== 'done') return false;
        if (ui.taskPriority !== 'all' && x.priority !== ui.taskPriority) return false;
        return !q || (x.title + ' ' + x.person).toLowerCase().indexOf(q) >= 0;
      });
      var groups = [
        ['Overdue', function (x) { return x.status !== 'done' && x.due && x.due < t; }, 'red'],
        ['Today', function (x) { return x.status !== 'done' && x.due === t; }],
        ['This week', function (x) { return x.status !== 'done' && x.due > t && x.due <= we; }],
        ['Later', function (x) { return x.status !== 'done' && x.due > we; }],
        ['No date', function (x) { return x.status !== 'done' && !x.due; }],
        ['Done', function (x) { return x.status === 'done'; }]
      ];
      var body = groups.map(function (g) {
        var list = items.filter(g[1]);
        if (!list.length) return '';
        list.sort(g[0] === 'Done' ? function (a, b) { return (b.doneOn || '').localeCompare(a.doneOn || ''); } : J.byDue);
        return '<section class="group' + (g[2] ? ' ' + g[2] : '') + '"><h2 class="label">' + g[0] + '<span class="n">' + list.length + '</span></h2><ul class="items">' + list.map(taskRow).join('') + '</ul></section>';
      }).join('');
      return J.head('Command', 'Tasks', 'Everything you need to do: who it is for, when it is due and how important it is.', '<button type="button" class="btn" data-act="addTask"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON.plus + '</svg>Add task</button>') +
        '<form class="panel" data-form="capture" autocomplete="off"><label class="label" for="capIn" style="display:block">Quick capture</label>' +
          '<div class="capture-row"><input id="capIn" type="text" placeholder="Submit report to Dr. Ahmed by Sunday" enterkeyhint="done"><button type="submit" class="btn primary">Add task</button></div>' +
          '<p class="preview" id="capPreview" aria-live="polite">Type in plain English, like <b>Call HR tomorrow at 10am</b>. NOVA finds the person, date, time and priority.</p></form>' +
        '<div class="toolbar"><label class="sr-only" for="taskSearch">Search tasks</label><input class="search" id="taskSearch" type="search" placeholder="Search tasks" value="' + esc(ui.taskQuery) + '" data-ui="taskQuery">' +
          '<div class="segs" role="group" aria-label="Show">' + J.seg('taskFilter', 'open', ui.taskFilter, 'Open') + J.seg('taskFilter', 'done', ui.taskFilter, 'Done') + J.seg('taskFilter', 'all', ui.taskFilter, 'All') + '</div>' +
          '<label class="sr-only" for="taskPri">Priority</label><select id="taskPri" data-ui="taskPriority"><option value="all">All priorities</option>' + PRI.map(function (p) { return '<option value="' + p[0] + '"' + (ui.taskPriority === p[0] ? ' selected' : '') + '>' + p[1] + ' priority</option>'; }).join('') + '</select></div>' +
        '<div class="stack">' + (body || J.empty(q ? 'No tasks match <b>' + esc(ui.taskQuery) + '</b>.' : ui.taskFilter === 'done' ? 'Nothing completed yet.' : 'No open tasks. Add one above or say <b>"add task"</b>.')) + '</div>';
    }
  };
  J.taskForm = function (x, preset) {
    preset = preset || {};
    J.openForm({
      title: x ? 'Edit task' : 'Add task',
      fields: [
        { name: 'title', label: 'Title', value: x ? x.title : preset.title, required: true, placeholder: 'Submit the report' },
        { name: 'person', label: 'Person', value: x ? x.person : preset.person, placeholder: 'Dr. Ahmed', half: true },
        { name: 'priority', label: 'Priority', type: 'select', options: PRI, value: x ? x.priority : (preset.priority || 'medium'), half: true },
        { name: 'due', label: 'Due date', type: 'date', value: x ? x.due : preset.due, half: true },
        { name: 'time', label: 'Time (reminder)', type: 'time', value: x ? x.time : preset.time, half: true, hint: 'NOVA reminds you at this time while the site is open.' },
        { name: 'status', label: 'Status', type: 'select', options: STATUS, value: x ? x.status : 'todo' },
        { type: 'html', html: '<p class="form-warn" id="clashWarn" aria-live="polite"></p>' }
      ],
      after: function (root) {
        // Warn about calendar clashes while the date or time is being chosen.
        function check() { var w = $('#clashWarn'); if (w) w.textContent = J.clashNote ? J.clashNote($('#f_due').value, $('#f_time').value, x && x.id, x && x.kind) : ''; }
        ['f_due', 'f_time'].forEach(function (id) { var el = $('#' + id, root); if (el) el.addEventListener('input', check); });
        check();
      },
      validate: function (v) { if (v.time && !v.due) return 'Pick a date for the reminder time.'; },
      onSave: function (v) {
        if (x) {
          if (v.due !== x.due || v.time !== x.time) x.reminded = false;
          var wasDone = x.status === 'done';
          Object.assign(x, { title: J.cap(v.title), person: v.person, priority: v.priority, due: v.due, time: v.time, status: v.status });
          if (v.status === 'done' && !wasDone) x.doneOn = J.today();
          if (v.status !== 'done') x.doneOn = '';
          J.commit(); J.toast('Task updated.' + clash(v.due, v.time, x.id, x.kind));
        } else { var nt = J.addTask(v); J.toast('Task added.' + clash(v.due, v.time, nt.id)); }
      }
    });
  };
  function clash(date, time, id, kind) { var n = J.clashNote ? J.clashNote(date, time, id, kind) : ''; return n ? ' ' + n : ''; }
  J.clash = clash;
  Object.assign(J.actions, {
    addTask: function () { J.taskForm(null); },
    editTask: function (id) { var x = J.byId(J.data.tasks, id); if (x) J.taskForm(x); },
    delTask: function (id) { var x = J.byId(J.data.tasks, id); if (!x) return; J.removeTask(id); J.toast('Deleted: ' + x.title, true); },
    toggleTask: function (id) {
      var x = J.byId(J.data.tasks, id); if (!x) return;
      J.setTaskDone(id, x.status !== 'done');
      J.toast(x.status === 'done' ? 'Done: ' + x.title : 'Reopened: ' + x.title);
      var again = $('[data-act="toggleTask"][data-id="' + id + '"]'); if (again) again.focus();
    }
  });
  J.forms.capture = function () {
    var inp = $('#capIn'), v = inp.value.trim();
    if (!v) { inp.focus(); return; }
    var p = J.parseTask(v);
    if (!p.title) { J.toast('Add what you need to do.'); return; }
    var added = J.addTask(p);
    J.toast('Added: ' + p.title + (p.due ? ', ' + J.when(p.due, p.time) : '') + '.' + clash(p.due, p.time, added.id));
    var again = $('#capIn'); if (again) { again.value = ''; again.focus(); capPreview(); }
  };
  function capPreview() {
    var inp = $('#capIn'), out = $('#capPreview');
    if (!inp || !out) return;
    var v = inp.value.trim();
    if (!v) { out.innerHTML = 'Type in plain English, like <b>Call HR tomorrow at 10am</b>. NOVA finds the person, date, time and priority.'; return; }
    var p = J.parseTask(v);
    out.innerHTML = '<span>Task: <b>' + esc(p.title || '—') + '</b></span><span>Person: <b>' + esc(p.person || '—') + '</b></span><span>Due: <b>' + esc(p.due ? J.dueLabel(p.due, p.time) : 'No date') + '</b></span><span>Priority: <b>' + esc(J.cap(p.priority)) + '</b></span>';
  }

  /* ================= CALENDAR: see calendar.js ================= */
  J.actions.addOnDay = function (id) { J.taskForm(null, { due: id }); };

  /* ================= NOTES ================= */
  J.screens.notes = {
    render: function () {
      var q = ui.noteQuery.toLowerCase().trim();
      var notes = J.data.notes.filter(function (n) { return !q || n.text.toLowerCase().indexOf(q) >= 0; }).sort(function (a, b) { return b.updated - a.updated; });
      return J.head('Memory', 'Notes', 'Quick notes you can search. Or say <q>add note</q> followed by the text.', '') +
        '<form class="panel" data-form="note" autocomplete="off"><label class="label" for="noteIn" style="display:block">New note</label><textarea id="noteIn" rows="3" placeholder="Write anything you want to remember"></textarea>' +
          '<div class="btn-row" style="margin-top:10px"><button type="submit" class="btn primary">Save note</button></div></form>' +
        '<div class="toolbar"><label class="sr-only" for="noteSearch">Search notes</label><input class="search" id="noteSearch" type="search" placeholder="Search notes" value="' + esc(ui.noteQuery) + '" data-ui="noteQuery"><span class="muted small-text">' + J.plural(notes.length, 'note') + '</span></div>' +
        (notes.length ? '<div class="notes">' + notes.map(function (n) {
          return '<article class="panel note"><p>' + highlight(n.text, ui.noteQuery.trim()) + '</p><div class="note-foot"><span>' + esc(J.ago(n.updated)) + ' ' + J.sampleTag(n) + '</span><span class="item-actions">' + J.iconBtn('editNote', n.id, 'Edit note', 'edit') + J.iconBtn('delNote', n.id, 'Delete note', 'del', 'del') + '</span></div></article>';
        }).join('') + '</div>' : J.empty(q ? 'No notes match <b>' + esc(ui.noteQuery) + '</b>.' : 'No notes yet. Write one above.'));
    }
  };
  J.forms.note = function () {
    var el = $('#noteIn'), v = el.value.trim();
    if (!v) { el.focus(); return; }
    J.addNote(v); J.toast('Note saved.');
    var again = $('#noteIn'); if (again) again.focus();
  };
  Object.assign(J.actions, {
    editNote: function (id) {
      var n = J.byId(J.data.notes, id); if (!n) return;
      J.openForm({ title: 'Edit note', fields: [{ name: 'text', label: 'Note', type: 'textarea', rows: 6, value: n.text, required: true }], onSave: function (v) { n.text = v.text; n.updated = Date.now(); J.commit(); J.toast('Note saved.'); } });
    },
    delNote: function (id) { J.snapshot(); J.data.notes = J.data.notes.filter(function (n) { return n.id !== id; }); J.commit(); J.toast('Note deleted.', true); }
  });

  /* ================= GROWTH ================= */
  J.screens.growth = {
    render: function () {
      var p = J.data.profile;
      var avg = J.data.skills.length ? Math.round(J.data.skills.reduce(function (s, x) { return s + x.progress; }, 0) / J.data.skills.length) : 0;
      var wins = J.data.wins.filter(function (w) { return ui.winKind === 'all' || w.kind === ui.winKind; }).sort(function (a, b) { return b.date.localeCompare(a.date); });
      var skillOpts = '<option value="">No skill</option>' + J.data.skills.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('');
      return J.head('Development', 'Growth', 'Your goal, the skills you are learning, and proof of progress.', '<button type="button" class="btn" data-act="addSkill"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON.plus + '</svg>Add skill</button>') +
        '<article class="panel gold"><div class="goal-panel"><div class="txt"><h2 class="label">My goal</h2><p class="goal-text">' + (p.goal ? esc(p.goal) : '<span class="muted">No goal yet.</span>') + ' ' + (p.goalSample ? J.tag('Sample', 'sample') : '') + '</p>' +
          '<button type="button" class="btn small ghost" data-act="editGoal">Edit goal</button></div>' + J.ring(avg, { size: 104, segs: 36, tone: 'gold', label: 'Average skill progress ' + avg + ' percent' }) + '</div></article>' +
        '<h2 class="section-title">Skills I am learning</h2>' +
        (J.data.skills.length ? '<div class="skills">' + J.data.skills.map(function (s) {
          return '<article class="panel skill">' + J.ring(s.progress, { size: 70, segs: 28, label: s.name + ' ' + s.progress + ' percent' }) +
            '<div class="skill-body"><h3>' + esc(s.name) + ' ' + J.sampleTag(s) + '</h3>' +
            '<label class="sr-only" for="sk_' + s.id + '">Progress for ' + esc(s.name) + '</label><input type="range" id="sk_' + s.id + '" min="0" max="100" step="5" value="' + s.progress + '" data-skill="' + s.id + '"></div>' +
            '<div class="item-actions">' + J.iconBtn('editSkill', s.id, 'Edit ' + s.name, 'edit') + J.iconBtn('delSkill', s.id, 'Delete ' + s.name, 'del', 'del') + '</div></article>';
        }).join('') + '</div>' : J.empty('No skills yet. Add the skills you are learning.')) +
        '<h2 class="section-title">Wins and certificates</h2>' +
        '<form class="panel" data-form="win" autocomplete="off"><div class="row">' +
          '<div class="field grow" style="margin:0"><label for="winText">Achievement or certificate</label><input id="winText" type="text" placeholder="Finished the SQL course"></div>' +
          '<div class="field" style="margin:0"><label for="winKind">Type</label><select id="winKind"><option value="win">Win</option><option value="certificate">Certificate</option></select></div>' +
          '<div class="field" style="margin:0"><label for="winSkill">Skill</label><select id="winSkill">' + skillOpts + '</select></div>' +
          '<div class="field" style="margin:0"><label for="winDate">Date</label><input id="winDate" type="date" value="' + J.today() + '"></div>' +
          '<button type="submit" class="btn primary">Log it</button></div></form>' +
        '<div class="toolbar" style="margin-top:14px"><div class="segs" role="group" aria-label="Show">' + J.seg('winKind', 'all', ui.winKind, 'All') + J.seg('winKind', 'win', ui.winKind, 'Wins') + J.seg('winKind', 'certificate', ui.winKind, 'Certificates') + '</div></div>' +
        (wins.length ? '<ul class="items" style="margin-top:12px">' + wins.map(function (w) {
          var s = J.byId(J.data.skills, w.skillId);
          return '<li class="item"><span class="win-mark' + (w.kind === 'certificate' ? ' cert' : '') + '" aria-hidden="true"></span><div class="item-main"><p class="item-title">' + esc(w.text) + '</p><p class="item-meta"><span>' + esc(J.fmt(w.date)) + '</span>' + J.tag(w.kind === 'certificate' ? 'Certificate' : 'Win', w.kind === 'certificate' ? '' : 'gold') + (s ? '<span>' + esc(s.name) + '</span>' : '') + J.sampleTag(w) + '</p></div>' +
            '<div class="item-actions">' + J.iconBtn('editWin', w.id, 'Edit', 'edit') + J.iconBtn('delWin', w.id, 'Delete', 'del', 'del') + '</div></li>';
        }).join('') + '</ul>' : '<div style="margin-top:12px">' + J.empty('Nothing logged yet. Say <b>"log a win"</b> to NOVA.') + '</div>');
    }
  };
  J.forms.win = function () {
    var text = $('#winText').value.trim();
    if (!text) { $('#winText').focus(); return; }
    J.addWin(text, $('#winKind').value, $('#winSkill').value, $('#winDate').value || J.today());
    J.toast('Logged. Well done.');
    var again = $('#winText'); if (again) again.focus();
  };
  function skillForm(s) {
    J.openForm({
      title: s ? 'Edit skill' : 'Add skill',
      fields: [{ name: 'name', label: 'Skill', value: s && s.name, required: true, placeholder: 'Excel' }, { name: 'progress', label: 'Progress (0–100)', type: 'number', min: 0, max: 100, value: s ? s.progress : 10 }],
      onSave: function (v) {
        var pr = J.clamp(+v.progress || 0, 0, 100);
        if (s) { s.name = J.cap(v.name); s.progress = pr; } else J.data.skills.push({ id: J.uid(), name: J.cap(v.name), progress: pr });
        J.commit(); J.toast(s ? 'Skill updated.' : 'Skill added.');
      }
    });
  }
  Object.assign(J.actions, {
    addSkill: function () { skillForm(null); },
    editSkill: function (id) { skillForm(J.byId(J.data.skills, id)); },
    delSkill: function (id) {
      J.snapshot();
      J.data.skills = J.data.skills.filter(function (s) { return s.id !== id; });
      J.data.wins.forEach(function (w) { if (w.skillId === id) w.skillId = ''; });
      J.commit(); J.toast('Skill deleted.', true);
    },
    editGoal: function () {
      var p = J.data.profile;
      J.openForm({ title: 'My goal', fields: [{ name: 'goal', label: 'Goal', type: 'textarea', rows: 3, value: p.goal, placeholder: 'Where do you want to be in a year?' }], onSave: function (v) { if (v.goal !== p.goal) p.goalSample = false; p.goal = v.goal; J.commit(); } });
    },
    editWin: function (id) {
      var w = J.byId(J.data.wins, id); if (!w) return;
      J.openForm({
        title: 'Edit entry',
        fields: [{ name: 'text', label: 'Text', value: w.text, required: true },
          { name: 'kind', label: 'Type', type: 'select', options: [['win', 'Win'], ['certificate', 'Certificate']], value: w.kind, half: true },
          { name: 'date', label: 'Date', type: 'date', value: w.date, required: true, half: true },
          { name: 'skillId', label: 'Skill', type: 'select', options: [['', 'No skill']].concat(J.data.skills.map(function (s) { return [s.id, s.name]; })), value: w.skillId }],
        onSave: function (v) { Object.assign(w, v, { text: J.cap(v.text) }); J.commit(); }
      });
    },
    delWin: function (id) { J.snapshot(); J.data.wins = J.data.wins.filter(function (w) { return w.id !== id; }); J.commit(); J.toast('Deleted.', true); }
  });

  /* ================= WEEKLY REVIEW ================= */
  J.screens.review = {
    render: function () {
      var r = J.weekReview(), goal = +J.data.settings.weeklyGoal || 0;
      function list(items, fn, none) { return items.length ? '<ul class="plain">' + items.map(fn).join('') + '</ul>' : J.empty(none); }
      return J.head('Every Friday', 'Weekly review', 'Week of ' + esc(J.fmt(r.start, { weekday: undefined })) + ' to ' + esc(J.fmt(r.end, { weekday: undefined })) + ' (Monday to Friday).', '<button type="button" class="btn" data-act="say" data-say="how was my week"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON.mic + '</svg>Read it to me</button>') +
        '<div class="stats">' +
          '<div class="panel stat"><span><span class="label">Finished</span><b class="num" data-count="' + r.finished.length + '">' + r.finished.length + '</b><small>tasks this week</small></span></div>' +
          '<div class="panel stat' + (r.slipped.length ? ' red' : ' calm') + '"><span><span class="label">Slipped</span><b class="num" data-count="' + r.slipped.length + '">' + r.slipped.length + '</b><small>past their date</small></span></div>' +
          '<div class="panel stat gold"><span><span class="label">Applications</span><b class="num" data-count="' + r.applied.length + '">' + r.applied.length + '</b><small>goal ' + goal + '</small></span>' + J.ring(goal ? r.applied.length / goal * 100 : 0, { size: 62, segs: 24, tone: 'gold', label: r.applied.length + ' of ' + goal }) + '</div>' +
          '<div class="panel stat"><span><span class="label">Wins</span><b class="num" data-count="' + r.wins.length + '">' + r.wins.length + '</b><small>logged this week</small></span></div>' +
        '</div>' +
        '<div class="grid-2">' +
          '<article class="panel"><h2 class="label">What I finished</h2>' + list(r.finished, function (x) { return '<li>' + esc(J.taskPhrase(x)) + '</li>'; }, 'Nothing finished yet this week.') + '</article>' +
          '<article class="panel' + (r.slipped.length ? ' red' : '') + '"><h2 class="label">What slipped</h2>' + list(r.slipped, function (x) { return '<li><span class="red-text">' + esc(J.taskPhrase(x)) + '</span> <span class="muted mono small-text">' + esc(J.dueLabel(x.due)) + '</span></li>'; }, 'Nothing slipped. Well done.') + '</article>' +
          '<article class="panel"><h2 class="label">Skills progress</h2>' + (J.data.skills.length ? '<div class="btn-row">' + J.data.skills.map(function (s) { return '<span style="display:inline-flex;align-items:center;gap:10px;min-width:170px">' + J.ring(s.progress, { size: 54, segs: 20, label: s.name + ' ' + s.progress + ' percent' }) + '<span>' + esc(s.name) + '</span></span>'; }).join('') + '</div>' : J.empty('No skills added yet.')) + '</article>' +
          '<article class="panel"><h2 class="label">Applications this week</h2>' + list(r.applied, function (a) { return '<li>' + esc(a.title) + ' <span class="muted">at ' + esc(a.company) + '</span> ' + J.tag(J.stageName(a.stage)) + '</li>'; }, 'No applications sent this week yet.') + '</article>' +
        '</div>' +
        (J.reviewExtra ? J.reviewExtra() : '') +
        '<article class="panel' + (r.next.tone === 'red' ? ' red' : ' gold') + '"><h2 class="label">One next step</h2><p class="next-text">' + esc(r.next.text) + '</p><a class="btn small" href="#' + r.next.view + '">' + esc(r.next.label) + '</a></article>';
    }
  };

  /* ================= PROFILE ================= */
  var CITIES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain', 'Al Ain', 'Remote'];
  var JOB_TYPES = ['Internship', 'Graduate programme', 'Trainee', 'Full-time', 'Part-time', 'Remote'];
  J.CITIES = CITIES;
  J.screens.profile = {
    render: function () {
      var p = J.data.profile;
      function val(k) { return esc(Array.isArray(p[k]) ? p[k].join(', ') : p[k]); }
      function chips(name, opts, legend) {
        return '<fieldset class="field" style="border:0;padding:0;margin:0 0 16px"><legend class="flabel" style="padding:0;margin-bottom:8px">' + legend + '</legend><div class="checks">' + opts.map(function (o) { return '<label class="check-chip"><input type="checkbox" name="' + name + '" value="' + esc(o) + '"' + (p[name].indexOf(o) >= 0 ? ' checked' : '') + '>' + esc(o) + '</label>'; }).join('') + '</div></fieldset>';
      }
      var sampleNote = p.sampleFields.length ? '<p class="small-text" style="margin:0 0 14px">' + J.tag('Sample', 'sample') + ' <span class="muted">Some details are examples. Replace them with your own, or clear sample data.</span></p>' : '';
      return J.head('Identity', 'Profile', 'NOVA uses this to match jobs, fill cover letters and understand names you mention.', '') +
        '<form class="panel" data-form="profile" autocomplete="off">' + sampleNote +
          '<div class="grid-2" style="gap:0 18px">' +
            '<div class="field"><label for="pName">Name</label><input id="pName" type="text" value="' + val('name') + '" required></div>' +
            '<div class="field"><label for="pDegree">Degree</label><input id="pDegree" type="text" value="' + val('degree') + '" placeholder="BSc Computer Science"></div>' +
            '<div class="field"><label for="pField">Field of study</label><input id="pField" type="text" value="' + val('field') + '" placeholder="Computer Science"></div>' +
            '<div class="field"><label for="pUni">University</label><input id="pUni" type="text" value="' + val('university') + '"></div>' +
            '<div class="field"><label for="pSkills">Skills</label><input id="pSkills" type="text" value="' + esc(J.skillsString ? J.skillsString(p) : p.skills.join(', ')) + '" placeholder="Python (strong), SQL, Excel"><small>Comma separated. Add a level in brackets if you like: beginner, working, strong. Used for job match scores.</small></div>' +
            '<div class="field"><label for="pLang">Languages</label><input id="pLang" type="text" value="' + val('languages') + '" placeholder="English, Arabic"></div>' +
            '<div class="field"><label for="pTitles">Desired job titles</label><input id="pTitles" type="text" value="' + val('titles') + '" placeholder="Data Analyst, Software Engineer"><small>Used for one-click job searches.</small></div>' +
            '<div class="field"><label for="pGoal">Career goal</label><input id="pGoal" type="text" value="' + val('goal') + '"></div>' +
          '</div>' +
          chips('cities', CITIES, 'Preferred UAE cities') + chips('jobTypes', JOB_TYPES, 'Job types') +
          '<div class="btn-row"><button type="submit" class="btn primary">Save profile</button></div>' +
        '</form>' +
        '<article class="panel"><div class="panel-head"><h2 class="label">Job matching details</h2><button type="button" class="btn small primary" data-act="jobProfile">Edit job profile</button></div>' +
          '<p class="small-text muted" style="margin:0 0 10px">Graduation, GPA, skill levels, tools, experience, nationality and visa, salary floor, notice period and industries to avoid. They stay in this browser and are never uploaded.</p>' +
          '<ul class="plain small-text"><li>Skills: ' + esc(J.skillsString ? J.skillsString(p) : p.skills.join(', ')) + '</li><li>Experience: ' + esc(p.yearsExp) + ' years · Nationality: ' + esc(p.nationality || 'not set') + ' · Visa: ' + esc(p.visa) + ' · Remote: ' + esc(p.remote) + '</li><li>Graduation: ' + esc(p.gradDate || 'not set') + ' · GPA: ' + esc(p.gpa || 'not set') + ' · Salary floor: ' + (+p.salaryFloor ? 'AED ' + esc(p.salaryFloor) : 'not set') + '</li></ul></article>' +
        '<article class="panel"><div class="panel-head"><h2 class="label">Important people</h2><button type="button" class="btn small" data-act="addPerson">Add person</button></div>' +
          '<p class="small-text muted" style="margin:-6px 0 12px">NOVA recognises these names when you add tasks, for example <q>email Sara by Friday</q>.</p>' +
          (J.data.people.length ? '<ul class="items">' + J.data.people.map(function (x) {
            return '<li class="item"><div class="item-main"><p class="item-title">' + esc(x.name) + '</p><p class="item-meta"><span>' + esc(x.role || '') + '</span>' + J.sampleTag(x) + '</p></div><div class="item-actions">' + J.iconBtn('editPerson', x.id, 'Edit ' + x.name, 'edit') + J.iconBtn('delPerson', x.id, 'Delete ' + x.name, 'del', 'del') + '</div></li>';
          }).join('') + '</ul>' : J.empty('No people yet.')) +
        '</article>';
    }
  };
  J.forms.profile = function (form) {
    var p = J.data.profile;
    var name = $('#pName').value.trim();
    if (!name) { J.toast('Please enter your name.'); $('#pName').focus(); return; }
    var map = {
      name: name, degree: $('#pDegree').value.trim(), field: $('#pField').value.trim(), university: $('#pUni').value.trim(),
      languages: J.list($('#pLang').value), titles: J.list($('#pTitles').value), goal: $('#pGoal').value.trim(),
      cities: $$('input[name="cities"]:checked', form).map(function (c) { return c.value; }), jobTypes: $$('input[name="jobTypes"]:checked', form).map(function (c) { return c.value; })
    };
    var sk = $('#pSkills').value;
    if (J.saveSkills && sk !== (J.skillsString ? J.skillsString(p) : '')) { J.saveSkills(p, sk); p.sampleFields = p.sampleFields.filter(function (f) { return f !== 'skills'; }); }
    else if (!J.saveSkills) p.skills = J.list(sk);
    Object.keys(map).forEach(function (k) {
      if (JSON.stringify(map[k]) !== JSON.stringify(p[k])) { p.sampleFields = p.sampleFields.filter(function (f) { return f !== k; }); if (k === 'goal') p.goalSample = false; }
      p[k] = map[k];
    });
    J.commit();
    J.toast('Profile saved.');
  };
  function personForm(x) {
    J.openForm({ title: x ? 'Edit person' : 'Add person', fields: [{ name: 'name', label: 'Name', value: x && x.name, required: true, half: true, placeholder: 'Dr. Ahmed' }, { name: 'role', label: 'Role', value: x && x.role, half: true, placeholder: 'Supervisor, mentor, recruiter…' }],
      onSave: function (v) { if (x) Object.assign(x, v); else J.data.people.push({ id: J.uid(), name: v.name, role: v.role }); J.commit(); } });
  }
  Object.assign(J.actions, {
    addPerson: function () { personForm(null); },
    editPerson: function (id) { personForm(J.byId(J.data.people, id)); },
    delPerson: function (id) { J.snapshot(); J.data.people = J.data.people.filter(function (x) { return x.id !== id; }); J.commit(); J.toast('Removed.', true); }
  });

  /* ================= SETTINGS ================= */
  function sw(key, title, desc) {
    return '<label class="switch"><span class="txt"><b>' + esc(title) + '</b><small>' + esc(desc) + '</small></span><input type="checkbox" data-setting="' + key + '"' + (J.data.settings[key] ? ' checked' : '') + '><span class="knob" aria-hidden="true"></span></label>';
  }
  J.screens.settings = {
    render: function () {
      var s = J.data.settings;
      var notif = !('Notification' in window) ? 'This browser does not support notifications.' : Notification.permission === 'granted' ? 'Allowed.' : Notification.permission === 'denied' ? 'Blocked. Allow notifications for this site in your browser settings.' : 'Not asked yet. Turn the switch on to ask.';
      return J.head('System', 'Settings', 'Voice, reminders, sounds and your data.', '') +
        '<div class="grid-2">' +
          '<article class="panel"><h2 class="label">You</h2>' +
            '<form data-form="name" class="row" autocomplete="off"><div class="field grow" style="margin:0"><label for="sName">Your name</label><input id="sName" type="text" value="' + esc(J.data.profile.name) + '"></div><button type="submit" class="btn">Save</button></form>' +
            '<div class="field" style="margin-top:16px"><label for="sGoal">Weekly application goal</label><input id="sGoal" type="number" min="0" max="50" value="' + esc(s.weeklyGoal) + '" data-setting="weeklyGoal"></div>' +
            '<h2 class="label" style="margin-top:22px">Reminders</h2>' +
            sw('notify', 'Browser notifications', 'Show a notification when a reminder is due, while the site is open.') +
            '<p class="small-text muted" style="margin:8px 0 0">Permission: ' + esc(notif) + '</p>' +
          '</article>' +
          '<article class="panel"><h2 class="label">Voice</h2>' +
            sw('voice', 'Spoken replies', 'NOVA answers out loud.') +
            sw('wake', 'Wake mode', 'Keep listening for "Hey NOVA" while this page is open.') +
            sw('sounds', 'Interface sounds', 'Soft beeps when NOVA starts and stops listening.') +
            '<div class="field" style="margin-top:12px"><label for="voiceSelect">Voice</label><select id="voiceSelect" data-setting="voiceURI"><option value="">Automatic (calm British English male)</option></select></div>' +
            '<div class="field"><label for="rate">Speaking speed: <span class="mono" id="rateOut">' + (+s.rate).toFixed(2) + '×</span></label><input id="rate" type="range" min="0.7" max="1.4" step="0.05" value="' + esc(s.rate) + '" data-setting="rate"></div>' +
            '<div class="btn-row"><button type="button" class="btn small" data-act="say" data-say="test voice">Test voice</button></div>' +
            '<p class="small-text muted" id="voiceSupport" style="margin:12px 0 0"></p>' +
          '</article>' +
        '</div>' +
        (J.calSettingsHTML ? J.calSettingsHTML() : '') + (J.jobSettingsHTML ? J.jobSettingsHTML() : '') + (J.smartSettingsHTML ? J.smartSettingsHTML() : '') +
        '<article class="panel"><h2 class="label">Your data</h2>' +
          '<p class="small-text muted" style="margin:0 0 12px">Everything is saved only in this browser, on this device. Export a backup regularly; import it to restore or move to another device.</p>' +
          '<div class="btn-row"><button type="button" class="btn" data-act="export">Export backup (JSON)</button><button type="button" class="btn" data-act="import">Import backup</button>' +
          (J.hasSample() ? '<button type="button" class="btn ghost" data-act="clearSample">Clear sample data</button>' : '') + '<button type="button" class="btn danger" data-act="resetAll">Delete all data</button></div>' +
        '</article>';
    }
  };
  J.forms.name = function () {
    var v = $('#sName').value.trim();
    if (!v) { J.toast('Please enter a name.'); return; }
    J.data.profile.name = v;
    J.commit(); J.toast('Name saved.');
  };

  /* ================= VOICE COMMANDS HELP ================= */
  var HELP = [
    ['Everyday', [['Brief me', 'Good morning / what\'s my day'], ['What\'s due today?', 'Also: due this week, what\'s overdue'], ['What\'s my next step?', 'One suggestion'], ['What time is it?', 'Also: what\'s the date'], ['Repeat that', 'Says the last reply again'], ['What can you do?', 'A short list of commands'], ['Stop', 'Also: cancel, Esc, or tap the core']]],
    ['Tasks and reminders', [['Add task submit report to Dr. Ahmed by Sunday', 'Adds a task with person and date'], ['Remind me to call HR tomorrow at 10am', 'Timed reminder: spoken + notification'], ['Mark submit report as done', 'Completes a task'], ['Delete task call HR', 'Asks you to confirm with yes or no']]],
    ['Notes and growth', [['Add note bring printed CVs to the fair', 'Saves a note'], ['Read my notes', 'Reads your latest notes'], ['Log a win finished the SQL course', 'Adds to Growth']]],
    ['Jobs and applications', [['Find internships', 'Live intern roles in the UAE'], ['Find fresher jobs in Dubai', 'Entry-level roles in a city'], ['Show new jobs', 'New since you last looked'], ['Save this job', 'Saves the job NOVA just mentioned'], ['How many applications do I have?', 'Counts by stage'], ['What deadlines are coming up?', 'Deadlines and interviews']]],
    ['Job matching', [['What jobs can hire me?', 'Your best matches, with reasons'], ['Why did you match this job?', 'Or: what am I missing for this job?'], ['Show new jobs since yesterday', 'Then: read the top three'], ['Which job should I apply to first?', 'Best score plus nearest deadline'], ['What should I learn to get more jobs?', 'Skills that unlock the most jobs'], ['Set an alert for data analyst jobs in Dubai above 70 percent', 'Asks you to confirm'], ['Turn job alerts on', 'Or off'], ['Run the job search now', 'Reloads the job list'], ['When did you last check?', 'Time and sources'], ['Prepare an application for this job', 'Saves it with a checklist, letter and reminders'], ['Set up my job profile', 'Short questions by voice']]],
    ['Calendar', [['What\'s on my calendar today?', 'Also: tomorrow, this week, on Monday'], ['What\'s my next meeting?', 'Your next event or interview'], ['Am I free at 3 pm tomorrow?', 'Checks your calendar and tasks'], ['When am I free on Monday?', 'Free time inside your working hours'],
      ['Add interview with Careem on Sunday at 11am', 'Asks you to confirm, then adds it'], ['Move my 3 pm meeting to 4 pm', 'Asks you to confirm first'], ['Cancel the call with HR', 'Asks yes or no first'], ['Sync my calendar', 'Refreshes Google and Outlook']]],
    ['Navigation and voice', [['Open calendar', 'Any screen: tasks, notes, jobs, applications…'], ['Go back', 'Previous screen'], ['Voice off', 'Text replies only ("voice on" to undo)'], ['Turn on wake mode', 'Listen for "Hey NOVA"'], ['Speak slower', 'Or "speak faster"']]]
  ];
  J.HELP = HELP;
  J.screens.help = {
    render: function () {
      return J.head('Reference', 'Voice commands', 'Tap the core, press <kbd>J</kbd>, or say <q>Hey NOVA</q> in wake mode. You can also type any command in the chat panel. Wording is flexible.', '<button type="button" class="btn primary" data-act="talk"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON.mic + '</svg>Talk to NOVA</button>') +
        HELP.map(function (g) {
          return '<article class="panel"><h2 class="label">' + esc(g[0]) + '</h2><div class="table-wrap"><table class="cmds"><thead><tr><th scope="col">Say</th><th scope="col">What happens</th><th scope="col" class="try"><span class="sr-only">Try it</span></th></tr></thead><tbody>' +
            g[1].map(function (c) { return '<tr><td>"' + esc(c[0]) + '"</td><td>' + esc(c[1]) + '</td><td class="try"><button type="button" class="btn small ghost" data-act="say" data-say="' + esc(c[0]) + '" aria-label="Try: ' + esc(c[0]) + '">Try</button></td></tr>'; }).join('') +
            '</tbody></table></div></article>';
        }).join('') +
        '<article class="panel"><h2 class="label">If voice does not work</h2><ul class="plain">' +
          '<li><b>Microphone blocked:</b> click the lock or settings icon next to the web address, set Microphone to Allow, then reload the page.</li>' +
          '<li><b>No microphone found:</b> connect or switch on a microphone, or type in the chat panel.</li>' +
          '<li><b>No internet:</b> in Chrome and Edge, speech-to-text needs the internet. Typing always works.</li>' +
          '<li><b>Firefox:</b> it cannot listen. Use Chrome, Edge or Safari for voice, or type your commands.</li>' +
        '</ul></article>';
    }
  };

  /* ================= data actions ================= */
  Object.assign(J.actions, {
    talk: function () { if (J.voice) J.voice.listen(); else J.toast('Voice is not available.'); },
    core: function () { if (J.voice) J.voice.coreTap(); },
    say: function (id, el) { if (J.voice) J.voice.run(el.getAttribute('data-say')); },
    export: function () {
      var blob = new Blob([JSON.stringify({ app: 'jarvis', version: 3, exported: new Date().toISOString(), data: J.data }, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'nova-backup-' + J.today() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
      J.toast('Backup downloaded.');
    },
    import: function () { closeMore(); $('#importFile').click(); },
    clearSample: function () { J.confirm('Remove all items marked Sample? Your own items stay.', 'Clear sample data', 'Clear sample data').then(function (ok) { if (ok) { J.clearSample(); J.toast('Sample data cleared.', true); } }); },
    resetAll: function () {
      J.confirm('This deletes ALL your tasks, notes, applications, growth and profile data in this browser. Export a backup first if you need it.', 'Delete everything', 'Delete all data?').then(function (ok) {
        if (ok) { J.resetAll(); J.toast('All data deleted.', true); }
      });
    }
  });
  function importFile(file) {
    var r = new FileReader();
    r.onload = function () {
      var d;
      try { var parsed = JSON.parse(r.result); d = parsed && parsed.data ? parsed.data : parsed; if (!d || !Array.isArray(d.tasks)) throw new Error('bad'); }
      catch (e) { J.toast('That file is not a NOVA backup.'); return; }
      J.confirm('Replace all data in this browser with this backup?', 'Import', 'Import backup').then(function (ok) {
        if (!ok) return;
        J.snapshot(); J.data = J.normalize(d); J.commit(); J.toast('Backup imported.', true);
      });
    };
    r.onerror = function () { J.toast('Could not read that file.'); };
    r.readAsText(file);
  }

  /* ================= reminders ================= */
  function checkReminders() {
    var now = Date.now(), fired = [], changed = false;
    J.data.tasks.forEach(function (x) {
      if (x.status === 'done' || !x.due || !x.time || x.reminded || (x.sample && document.body.classList.contains('nova-server'))) return;   // sample data never nags in NOVA server mode
      var at = J.stamp(x.due, x.time);
      if (at > now) return;
      x.reminded = true; changed = true;
      if (now - at < 6 * 3600e3) fired.push(x); // older ones are not announced
    });
    if (changed) J.persist();
    fired.forEach(function (x) {
      var text = 'Reminder: ' + J.taskPhrase(x) + (x.kind === 'interview' ? '. Good luck.' : '.');
      J.toast(text);
      if (J.voice) J.voice.announce(text);
      if (J.data.settings.notify && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification('NOVA reminder', { body: J.taskPhrase(x) + ' · ' + J.fmtTime(x.time), tag: 'jarvis-' + x.id }); } catch (e) { /* some mobile browsers need a service worker */ }
      }
    });
  }
  J.checkReminders = checkReminders;

  /* ================= clock ================= */
  var dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: J.TZ, weekday: 'short', day: '2-digit', month: 'short' });
  var lastDay = J.today();
  function tick() {
    var p = J.parts();
    $('#clockTime').textContent = p.hour + ':' + p.minute + ':' + p.second;
    $('#clockDate').textContent = dateFmt.format(new Date()).toUpperCase().replace(',', '');
    var d = J.today();
    if (d !== lastDay && !document.querySelector('dialog[open]')) { lastDay = d; render(false); }
    if (+p.second % 15 === 0) checkReminders();
  }

  /* ================= events ================= */
  function closeMore() { var s = $('#moreSheet'); if (s && !s.hidden) { s.hidden = true; $('#moreBtn').setAttribute('aria-expanded', 'false'); } }
  function requestNotify(el) {
    function off(msg) { J.data.settings.notify = false; J.persist(); el.checked = false; J.toast(msg); render(false); }
    if (!('Notification' in window)) return off('This browser does not support notifications.');
    if (Notification.permission === 'granted') { J.toast('Notifications are on.'); return; }
    if (Notification.permission === 'denied') return off('Notifications are blocked. Allow them in your browser settings.');
    Notification.requestPermission().then(function (p) {
      if (p !== 'granted') off('Notifications were not allowed.');
      else { J.toast('Notifications are on.'); render(false); }
    });
  }
  function bind() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el || el.tagName === 'INPUT') return;
      var act = el.getAttribute('data-act'), fn = J.actions[act];
      if (!fn) return;
      e.preventDefault();
      // NOVA actions talk to the server: a second click within 800 ms (a double click) is ignored so nothing is sent twice
      if (/^(nova|life|kb|hab|rem|exp|bud|pl|d[A-Z]|f[A-Z]|i[A-Z])/.test(act)) { if (el.getAttribute('data-busy')) return; el.setAttribute('data-busy', '1'); setTimeout(function () { el.removeAttribute('data-busy'); }, 800); }
      fn(el.getAttribute('data-id'), el);
    });
    document.addEventListener('submit', function (e) {
      var f = e.target.closest('[data-form]');
      if (!f) return;
      e.preventDefault();
      var fn = J.forms[f.getAttribute('data-form')];
      if (fn) fn(f);
    });
    var searchTimer;
    document.addEventListener('input', function (e) {
      var el = e.target;
      if (el.id === 'capIn') capPreview();
      var k = el.getAttribute('data-ui');
      if (k && el.type === 'search') { ui[k] = el.value; clearTimeout(searchTimer); searchTimer = setTimeout(function () { render(false); }, 150); }
      if (el.id === 'rate') { var o = $('#rateOut'); if (o) o.textContent = (+el.value).toFixed(2) + '×'; }
      if (el.hasAttribute('data-skill')) {
        var s = J.byId(J.data.skills, el.getAttribute('data-skill'));
        if (s) { s.progress = +el.value; var ring = el.closest('.skill').querySelector('.ring'); if (ring) ring.outerHTML = J.ring(s.progress, { size: 70, segs: 28, label: s.name + ' ' + s.progress + ' percent' }); }
      }
    });
    document.addEventListener('change', function (e) {
      var el = e.target, k;
      if ((k = el.getAttribute('data-ui')) && el.type !== 'search') { ui[k] = el.value; render(false); return; }
      if (el.hasAttribute('data-skill')) { J.persist(); return; }
      if ((k = el.getAttribute('data-setting'))) {
        var v = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? +el.value : el.value;
        if (k === 'weeklyGoal') v = J.clamp(Math.round(v) || 0, 0, 50);
        J.data.settings[k] = v;
        J.persist();
        if (k === 'notify' && v) requestNotify(el);
        if (k === 'smart' && J.smart) J.smart.toggled(v);
        if (J.voice) J.voice.settingsChanged(k);
        if (k === 'weeklyGoal') render(false);
      }
    });
    $('#importFile').addEventListener('change', function () { if (this.files && this.files[0]) importFile(this.files[0]); this.value = ''; });
    $('#skipLink').addEventListener('click', function (e) { e.preventDefault(); main.focus(); });
    var more = $('#moreBtn'), sheet = $('#moreSheet');
    more.addEventListener('click', function (e) {
      e.stopPropagation();
      sheet.hidden = !sheet.hidden;
      more.setAttribute('aria-expanded', String(!sheet.hidden));
      if (!sheet.hidden) sheet.querySelector('a').focus();
    });
    document.addEventListener('click', function (e) { if (!sheet.hidden && !sheet.contains(e.target) && !more.contains(e.target)) closeMore(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) { closeMore(); more.focus(); } });
    window.addEventListener('hashchange', function () { route(false); });
    document.addEventListener('visibilitychange', function () { document.documentElement.classList.toggle('paused', document.hidden); });
    bindDialog();
  }

  /* ================= boot sequence (2 s, once per visit, skippable) ================= */
  function boot() {
    var el = $('#boot');
    if (!el) return;
    if (document.documentElement.classList.contains('no-boot')) { el.remove(); return; }
    try { sessionStorage.setItem('jarvis.booted', '1'); } catch (e) { /* private mode */ }
    var done = false;
    function end() {
      if (done) return;
      done = true;
      el.classList.add('out');
      window.removeEventListener('keydown', end, true);
      setTimeout(function () { el.remove(); document.dispatchEvent(new Event('jarvis:booted')); }, 450);
    }
    el.addEventListener('click', end);
    window.addEventListener('keydown', end, true);
    setTimeout(end, 2000);
  }
  J.booting = function () { return !!$('#boot'); };

  /* ================= start (after every script has loaded) ================= */
  J.onChange(function () { render(false); });
  document.addEventListener('DOMContentLoaded', function () {
    boot();
    bind();
    route(true);
    tick();
    setInterval(tick, 1000);
    setTimeout(checkReminders, 1500);
  });
})();

/* NOVA Focus and Planner + Weekly Insights (server mode).
   Plan my day: your tasks and promises fitted into today's working hours, each with the reason it is there.
   Focus: a timer on a task or block; the orb changes to "Focusing"; at the end NOVA tells you (and asks before marking anything done).
   Insights: reliability score, tasks done and focus time per day, and what stands out, from your own data only. */
(function () {
  'use strict';
  var J = window.J, N = window.NOVA; if (!J || !N) return;
  var esc = J.esc, $ = J.$, $$ = J.$$, S = J.screens;
  var api = function (m, p, b) { return N.api(m, p, b); };
  var fail = function (e) { J.toast(e && e.message ? e.message : 'Something went wrong.'); };
  var F = N.focus = { state: null, tick: 0, ended: {} };
  function mmss(ms) { var s = Math.max(0, Math.round(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
  function dur(m) { return m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '') : m + 'm'; }
  function st() { return J.data.settings; }

  /* ================= focus timer ================= */
  function remaining() { var r = F.state && F.state.running; return r ? Math.max(0, r.endsAt - Date.now()) : 0; }
  function load() {
    return api('GET', '/api/focus').then(function (r) {
      var was = F.state && F.state.running ? F.state.running.id : null, now = r.running ? r.running.id : null;
      F.state = r; N.focusRunning = !!r.running; paintAll();
      if (was !== now && J.current() === 'focus') J.render(false);           // started or stopped somewhere else (another tab or device)
      if (!r.running && N.state === 'focusing') N.setState('idle');
      return r;
    });
  }
  F.start = function (o) {
    return api('POST', '/api/focus/start', o).then(function (r) { J.toast('Focus started: ' + r.session.title + ' for ' + r.session.plannedMin + ' minutes.'); return load(); })
      .then(function () { N.setState('focusing'); if (J.current() === 'focus') J.render(false); }).catch(fail);
  };
  function stop(completed) {
    var r = F.state && F.state.running; if (!r) return Promise.resolve();
    return api('POST', '/api/focus/' + r.id + '/stop', { completed: !!completed }).then(function (x) { F.last = x.session; return load(); }).then(function () { if (N.state === 'focusing') N.setState('completed'); J.render(false); }).catch(fail);
  }
  function finished() {        // the timer ran out while NOVA was open
    var r = F.state && F.state.running; if (!r || F.ended[r.id]) return; F.ended[r.id] = true;
    var msg = 'Focus session finished: ' + r.title + ', ' + r.plannedMin + ' minutes.';
    J.toast(msg);
    if (J.voice && J.voice.speak && st().voice) J.voice.speak(msg + ' Take a short break.');
    if (st().novaPopups !== false && 'Notification' in window && Notification.permission === 'granted') { try { new Notification('NOVA focus finished', { body: r.title + ' (' + r.plannedMin + ' min)', tag: 'nova-focus-' + r.id }); } catch (e) { /* not allowed here */ } }
    stop(true);
  }
  function paintAll() {
    var r = F.state && F.state.running, left = remaining();
    // top bar chip while a session runs, on every page
    var host = $('.readouts'), chip = $('#focusChip');
    if (r && host && !chip) { host.insertAdjacentHTML('afterbegin', '<a class="chip focus-chip" id="focusChip" href="#focus"><i aria-hidden="true"></i><span class="sr-only">Focus, time left </span><span id="focusChipT"></span></a>'); chip = $('#focusChip'); }
    if (!r && chip) chip.remove();
    if (r) { var t = $('#focusChipT'); if (t) t.textContent = mmss(left); }
    // the big ring on the Focus page
    var ring = $('#focusRing');
    if (ring && r) {
      var frac = 1 - left / (r.plannedMin * 60e3); ring.style.strokeDashoffset = String(Math.round(1000 * (1 - frac)) / 10);
      var tt = $('#focusTime'); if (tt) tt.textContent = mmss(left);
    }
    if (r && left <= 0) finished();
  }
  setInterval(function () { if (F.state && F.state.running) paintAll(); }, 1000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && N.user) load().catch(function () {}); });

  function timerHTML() {
    var s = F.state, r = s && s.running;
    if (r) return '<article class="panel focus-card running"><h2 class="label">Focusing</h2><div class="focus-ring" role="timer" aria-label="Time left in this focus session"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="trk" pathLength="100"/><circle id="focusRing" cx="60" cy="60" r="52" class="val" pathLength="100" stroke-dasharray="100" stroke-dashoffset="' + (100 * remaining() / (r.plannedMin * 60e3)).toFixed(1) + '"/></svg>' +
      '<span><b id="focusTime" class="mono">' + mmss(remaining()) + '</b><small>of ' + r.plannedMin + ' min</small></span></div><p class="focus-title">' + esc(r.title) + '</p>' +
      '<div class="btn-row center-row"><button type="button" class="btn primary" data-act="fDone">I finished</button><button type="button" class="btn ghost" data-act="fStop">Stop</button></div><p class="small-text muted">Notifications, voice and the top-bar timer tell you when it ends, on any page.</p></article>';
    var last = F.last && F.last.status !== 'running' ? F.last : null;
    var tasks = (N.cache.tasks && N.cache.tasks.tasks || []).filter(function (t) { return t.status === 'open'; });
    return '<article class="panel focus-card"><h2 class="label">Start a focus session</h2>' +
      (last ? '<p class="focus-last">' + (last.status === 'completed' ? 'Well done: ' : 'Stopped: ') + esc(last.title) + ', ' + last.minutes + ' min.' + (last.taskId ? ' <button type="button" class="btn small" data-act="fMarkDone" data-id="' + last.taskId + '">Mark the task done…</button>' : '') + '</p>' : '') +
      '<div class="field"><label for="fTask">Work on</label><select id="fTask"><option value="">Something else (no task)</option>' + tasks.map(function (t) { return '<option value="' + t.id + '">' + esc(t.title) + (t.due ? ' (due ' + esc(t.due) + ')' : '') + '</option>'; }).join('') + '</select></div>' +
      '<fieldset class="seg-field"><legend>Length</legend>' + [15, 25, 50, 90].map(function (m) { return '<label class="check-chip"><input type="radio" name="fMin" value="' + m + '"' + (m === (st().focusMin || 25) ? ' checked' : '') + '>' + m + ' min</label>'; }).join('') + '</fieldset>' +
      '<button type="button" class="btn primary" data-act="fStart">Start focus</button></article>';
  }
  function blockHTML(b) {
    var focusable = b.kind === 'task' || b.kind === 'promise';
    return '<li class="blk k-' + esc(b.kind) + '"><span class="blk-time mono">' + esc(b.start) + '<small>' + esc(b.end) + '</small></span><div class="blk-body"><b>' + esc(b.title) + '</b><small>' + esc(b.why) + (b.minutes ? ' · ' + dur(b.minutes) + (b.guessed ? ' (estimated)' : '') : '') + '</small>' +
      (focusable ? '<div class="btn-row"><button type="button" class="btn small" data-act="fBlock" data-min="' + b.minutes + '" data-task="' + (b.taskId || '') + '" data-title="' + esc(b.title) + '">Focus on this</button>' + (b.taskId ? '<button type="button" class="btn small ghost" data-act="fEstimate" data-id="' + b.taskId + '" data-min="' + b.minutes + '" data-title="' + esc(b.title) + '">' + (b.guessed ? 'Set time' : 'Change time') + '</button>' : '') + '</div>' : '') + '</div></li>';
  }
  S.focus = {
    render: function () {
      var p = N.cache.plan, f = F.state;
      var head = J.head('Productivity', 'Focus and Planner', 'NOVA fits your overdue and due tasks and your promises into your working day, with the reason for each. Then focus on one thing at a time.', '');
      if (!p) return head + J.empty('Planning…');
      var pr = p.proposal, w = pr.window;
      return head + '<div class="focus-grid"><div class="focus-side">' + timerHTML() +
        '<article class="panel"><h2 class="label">Focus today</h2>' + (f ? '<p class="focus-total"><b class="num">' + dur(f.todayMin) + '</b> today · ' + dur(f.weekMin) + ' this week</p>' + (f.today.length ? '<ul class="mini-list">' + f.today.map(function (x) { return '<li><span class="when">' + new Date(x.startedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) + '</span><span class="what">' + esc(x.title) + '<small>' + (x.status === 'running' ? 'running' : x.minutes + ' min · ' + x.status) + '</small></span></li>'; }).join('') + '</ul>' : '<p class="empty">No sessions yet today.</p>') : '…') + '</article></div>' +
        '<article class="panel plan"><div class="panel-head"><h2 class="label">' + (pr.note ? 'Tomorrow' : 'Today') + ' · ' + esc(pr.weekday) + '</h2><span class="small-text muted">' + esc(w.start) + '–' + esc(w.end) + ' Dubai</span></div>' +
          (pr.note ? '<p class="gmail-msg"><span>' + esc(pr.note) + '</span></p>' : '') +
          '<p class="plan-sum">' + esc(pr.summary) + '</p>' +
          '<div class="plan-opts"><div class="field"><label for="pStart">Start</label><input id="pStart" type="time" value="' + esc(st().planStart || '09:00') + '"></div><div class="field"><label for="pEnd">End</label><input id="pEnd" type="time" value="' + esc(st().planEnd || '18:00') + '"></div>' +
          '<label class="check-chip"><input type="checkbox" id="pLunch"' + (st().planLunch === false ? '' : ' checked') + '>Lunch 13:00–14:00</label></div>' +
          (pr.blocks.length ? '<ol class="timeline-plan" aria-label="Suggested plan">' + pr.blocks.map(blockHTML).join('') + '</ol>' : '<p class="empty">Nothing to plan. Add tasks with dates, or say "remind me to … by Friday".</p>') +
          (pr.unscheduled.length ? '<h3 class="label">Does not fit</h3><ul class="plain small-text">' + pr.unscheduled.map(function (u) { return '<li><b>' + esc(u.title) + '</b>: ' + esc(u.why) + '</li>'; }).join('') + '</ul>' : '') +
          '<div class="btn-row"><button type="button" class="btn" data-act="fSavePlan">Save this plan</button><span class="small-text muted">' + (p.saved ? 'Saved at ' + new Date(p.saved.savedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) + '. ' : '') + 'Planning changes nothing; it is a suggestion.</span></div></article></div>';
    },
    after: function () {
      N.h.stale('focus', [['plan', planUrl()], ['tasks', '/api/tasks']]);
      load().catch(function () {});
      ['pStart', 'pEnd'].forEach(function (id) { var el = $('#' + id); if (el) el.addEventListener('change', function () { st()[id === 'pStart' ? 'planStart' : 'planEnd'] = el.value; J.persist(); replan(); }); });
      var l = $('#pLunch'); if (l) l.addEventListener('change', function () { st().planLunch = l.checked; J.persist(); replan(); });
    }
  };
  function planUrl() { var s = st(); return '/api/plan?start=' + encodeURIComponent(s.planStart || '09:00') + '&end=' + encodeURIComponent(s.planEnd || '18:00') + (s.planLunch === false ? '&lunch=off' : ''); }
  function replan() { N.h.load('plan', planUrl()).then(function () { J.render(false); }).catch(function (e) { fail(e); }); }

  /* ================= Weekly Insights ================= */
  // One series per chart (one hue), rounded data-ends, recessive grid, hover/focus tooltip, and a table view.
  function bars(id, title, days, key, unit) {
    var W = 560, Hh = 200, padL = 34, padB = 26, padT = 12, n = days.length, max = Math.max.apply(null, days.map(function (d) { return d[key]; }).concat([key === 'focusMin' ? 30 : 3]));
    var step = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : max <= 60 ? 15 : max <= 180 ? 30 : 60, top = Math.ceil(max / step) * step;
    var plotH = Hh - padB - padT, slot = (W - padL) / n, bw = Math.min(46, slot * 0.56), y = function (v) { return padT + plotH - plotH * v / top; };
    var grid = ''; for (var g = 0; g <= top; g += step) grid += '<line x1="' + padL + '" x2="' + W + '" y1="' + y(g) + '" y2="' + y(g) + '" class="gl"/><text x="' + (padL - 6) + '" y="' + (y(g) + 4) + '" class="ax" text-anchor="end">' + g + '</text>';
    var marks = days.map(function (d, i) {
      var x = padL + slot * i + (slot - bw) / 2, v = d[key], h = Math.max(0, plotH * v / top), label = d.label + ': ' + (key === 'focusMin' ? dur(v) : v + ' ' + unit) + (d.future ? ' (still to come)' : '');
      var shape = d.future ? '<rect x="' + x + '" y="' + (padT + plotH - 2) + '" width="' + bw + '" height="2" class="fut"/>' : v ? '<path d="M' + x + ',' + (padT + plotH) + 'V' + (y(v) + Math.min(4, h)) + 'q0,-' + Math.min(4, h) + ' ' + Math.min(4, h) + ',-' + Math.min(4, h) + 'H' + (x + bw - Math.min(4, h)) + 'q' + Math.min(4, h) + ',0 ' + Math.min(4, h) + ',' + Math.min(4, h) + 'V' + (padT + plotH) + 'Z" class="bar"/>' : '';
      return '<g class="bm" tabindex="0" role="img" aria-label="' + esc(label) + '" data-tip="' + esc(label) + '"><rect x="' + (padL + slot * i) + '" y="' + padT + '" width="' + slot + '" height="' + plotH + '" class="hit"/>' + shape + '<text x="' + (x + bw / 2) + '" y="' + (Hh - 8) + '" class="ax" text-anchor="middle">' + esc(d.label) + '</text></g>';
    }).join('');
    return '<figure class="chart" id="' + id + '"><figcaption class="label">' + esc(title) + '</figcaption><div class="chart-box"><svg viewBox="0 0 ' + W + ' ' + Hh + '" role="group" aria-label="' + esc(title) + '">' + grid + '<line x1="' + padL + '" x2="' + W + '" y1="' + (padT + plotH) + '" y2="' + (padT + plotH) + '" class="base"/>' + marks + '</svg><div class="tip" role="status" hidden></div></div>' +
      '<details class="small-text"><summary>Show as a table</summary><table class="cmds"><thead><tr><th scope="col">Day</th><th scope="col">' + esc(unit === 'tasks' ? 'Tasks done' : 'Focus') + '</th></tr></thead><tbody>' + days.map(function (d) { return '<tr><th scope="row">' + esc(d.label) + ' ' + esc(d.day) + '</th><td>' + (d.future ? '-' : key === 'focusMin' ? dur(d[key]) : d[key]) + '</td></tr>'; }).join('') + '</tbody></table></details></figure>';
  }
  function delta(a, b, fmt) { if (!b && !a) return 'no change'; if (!b) return 'new this week'; var d = Math.round(100 * (a - b) / b); return (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d) + '% vs last week (' + fmt(b) + ')'; }
  S.insights = {
    render: function () {
      var r = N.cache.insights, head = J.head('Productivity', 'Weekly Insights', 'Your week in numbers, from your own NOVA data. Nothing is estimated or invented.', '<button type="button" class="btn" data-act="iSpeak">Read it to me</button>');
      if (!r) return head + J.empty('Loading…');
      var t = r.totals, rel = r.reliability, score = rel.score;
      return head + '<div class="ins-top"><article class="panel rel-card"><h2 class="label">Reliability</h2>' +
          '<div class="rel-ring ' + (score === null ? 'none' : score >= 80 ? 'ok' : score >= 50 ? 'gold' : 'red') + '" role="img" aria-label="Reliability score: ' + (score === null ? 'not enough data' : score + ' percent') + '"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" class="trk" pathLength="100"/><circle cx="60" cy="60" r="50" class="val" pathLength="100" stroke-dasharray="' + (score || 0) + ' 100"/></svg><span><b class="num">' + (score === null ? '–' : score + '%') + '</b><small>promises kept on time</small></span></div>' +
          '<p class="small-text muted">' + (score === null ? 'Needs at least 3 promises with a deadline closed or overdue in the last 4 weeks (' + rel.judged + ' so far).' : rel.kept + ' of ' + rel.judged + ' in the last 4 weeks, from ProofLoop.') + '</p></article>' +
        '<div class="stats ins-stats">' + N.h.tile('Tasks done', t.done, delta(t.done, t.doneLastWeek, String)) + N.h.tile('Done on time', t.onTimePct === null ? '–' : t.onTimePct + '%', t.onTimePct === null ? 'no dated tasks done yet' : 'of dated tasks done this week') +
          N.h.tile('Focus time', dur(t.focusMin), delta(t.focusMin, t.focusMinLastWeek, dur)) + N.h.tile('Overdue now', t.overdue, t.overdue ? 'tasks and promises' : 'nothing overdue', t.overdue ? 'gold' : '') + '</div></div>' +
        '<article class="panel"><h2 class="label">What stands out</h2><ul class="ins-lines">' + r.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></article>' +
        '<div class="grid-2">' + '<article class="panel">' + bars('chDone', 'Tasks done per day (' + r.week.start + ' to ' + r.week.end + ')', r.days, 'done', 'tasks') + '</article>' +
        '<article class="panel">' + bars('chFocus', 'Focus time per day', r.days, 'focusMin', 'min') + '</article></div>';
    },
    after: function () {
      N.h.stale('insights', [['insights', '/api/insights']]);
      $$('.chart').forEach(function (fig) {
        var tip = fig.querySelector('.tip'), box = fig.querySelector('.chart-box');
        function show(g) { var b = g.getBoundingClientRect(), o = box.getBoundingClientRect(); tip.textContent = g.getAttribute('data-tip'); tip.hidden = false; tip.style.left = Math.max(0, Math.min(o.width - 150, b.left - o.left + b.width / 2 - 75)) + 'px'; tip.style.top = '0px'; }
        fig.querySelectorAll('.bm').forEach(function (g) { g.addEventListener('mouseenter', function () { show(g); }); g.addEventListener('focus', function () { show(g); }); g.addEventListener('mouseleave', function () { tip.hidden = true; }); g.addEventListener('blur', function () { tip.hidden = true; }); });
      });
    }
  };

  Object.assign(J.actions, {
    fStart: function () { var t = $('#fTask'), m = $('input[name="fMin"]:checked'), minutes = m ? +m.value : 25; st().focusMin = minutes; J.persist(); F.start(t && t.value ? { taskId: +t.value, minutes: minutes } : { title: 'Focus', minutes: minutes }); },
    fBlock: function (id, el) { var task = el.getAttribute('data-task'), o = { minutes: Math.max(5, Math.min(180, +el.getAttribute('data-min') || 25)) }; if (task) o.taskId = +task; else o.title = el.getAttribute('data-title'); F.start(o); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    fStop: function () { stop(false); },
    fDone: function () { stop(true); },
    fMarkDone: function (id) {
      var t = (N.cache.tasks && N.cache.tasks.tasks || []).filter(function (x) { return String(x.id) === String(id); })[0]; if (!t) return;
      F.last = null; location.hash = 'chat';                           // completing a task goes through the normal approval
      setTimeout(function () { var m = $('#novaMsg'), f = $('#novaChatForm'); if (m && f) { m.value = 'mark ' + t.title + ' done'; f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); } }, 400);
    },
    fEstimate: function (id, el) {
      J.openForm({ title: 'How long will "' + el.getAttribute('data-title') + '" take?', submit: 'Save', fields: [{ name: 'minutes', label: 'Minutes (5 to 480)', value: el.getAttribute('data-min'), required: true }],
        onSave: function (v) { var n = parseInt(v.minutes, 10); if (!(n >= 5 && n <= 480)) { J.toast('Use a number from 5 to 480.'); return false; } api('PATCH', '/api/tasks/' + id + '/estimate', { minutes: n }).then(function () { J.toast('Saved. The plan uses your estimate now.'); replan(); }).catch(fail); } });
    },
    fSavePlan: function () { var s = st(); api('POST', '/api/plan', { start: s.planStart || '09:00', end: s.planEnd || '18:00', lunch: s.planLunch !== false }).then(function () { J.toast('Plan saved for today.'); replan(); }).catch(fail); },
    iSpeak: function () { var r = N.cache.insights; if (!r) return; if (J.voice && J.voice.speak && st().voice) J.voice.speak(r.spoken); else J.toast(r.spoken); }
  });

  var prev = N.daily && N.daily.start;
  if (N.daily) N.daily.start = function () { if (prev) prev.apply(this, arguments); load().then(function (r) { if (r.running) N.setState('focusing'); }).catch(function () {}); };
})();

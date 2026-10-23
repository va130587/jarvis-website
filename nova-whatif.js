/* NOVA "What if I say yes?": type a possible commitment and see, without changing anything, what it would do to that day.
   Calendar events already in this browser are sent for this one answer and never stored. "Add it for real" opens Quick capture
   (preview, approval, undo as always). */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc, $ = J.$, S = J.screens;
  var W = N.whatif = { text: '', result: null, error: '', busy: false };

  function events() {
    if (!J.cal || !J.cal.itemsByDay) return { has: false, list: [] };
    var c = J.cal.cfg ? J.cal.cfg() : null, has = !!((J.cal.connected && J.cal.connected().length) || (c && c.ics && c.ics.length));
    if (!has) return { has: false, list: [] };
    var from = J.today(), to = J.addDays(from, 60), map = J.cal.itemsByDay(from, to) || {}, out = [];
    Object.keys(map).sort().forEach(function (d) {
      (map[d] || []).filter(function (x) { return x.kind === 'event'; }).forEach(function (x) { if (out.length < 100) out.push({ date: d, title: String(x.title || 'Busy').slice(0, 80), allDay: !!x.allDay, start: x.time || '00:00', end: x.endTime || x.time || '00:00' }); });
    });
    return { has: true, list: out };
  }
  var VERDICT = { fits: ['It fits', 'ok'], tight: ['Tight', 'warn'], overbooked: ['Overbooked', 'red'], clash: ['Clash', 'red'] };
  function nice(m) { return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : ''); }
  function stat(label, value, note) { return '<div class="wi-stat"><dt>' + esc(label) + '</dt><dd>' + esc(value) + (note ? '<span class="small-text muted">' + esc(note) + '</span>' : '') + '</dd></div>'; }
  function resultHTML(r) {
    var p = r.proposal, v = VERDICT[r.verdict], c = r.capacity;
    return '<article class="panel wi-result" id="wiResult" aria-labelledby="wiH"><h2 id="wiH" tabindex="-1">' + J.tag(v[0], v[1]) + ' ' + esc(p.title) + '</h2>' +
      '<p class="wi-summary" role="status">' + esc(r.summary) + '</p>' +
      '<p class="small-text muted">' + esc(J.longDate ? J.longDate(p.date) : p.date) + (p.timed ? ', ' + esc(p.start) + ' to ' + esc(p.end) : ', no time of day') + ' · ' + esc(nice(p.minutes)) + (p.guess ? ' (guessed)' : '') + '</p>' +
      (p.note ? '<p class="small-text">' + esc(p.note) + '</p>' : '') + (r.outsideHours ? '<p class="small-text">' + esc(r.outsideHours) + '</p>' : '') +
      '<dl class="wi-stats">' + stat('Free that day now', nice(Math.max(c.freeBeforeMin, 0)), c.freeBeforeMin < 0 ? 'Already over by ' + nice(-c.freeBeforeMin) : '') + stat('Free if you say yes', c.freeAfterMin < 0 ? 'None' : nice(c.freeAfterMin), c.freeAfterMin < 0 ? 'Over by ' + nice(-c.freeAfterMin) : '') + stat('Work waiting', nice(c.workWaitingMin), 'tasks and promises due that day') + stat('Calendar busy', nice(c.busyAfterMin), r.calendar.checked ? r.calendar.events + ' event' + (r.calendar.events === 1 ? '' : 's') + (r.calendar.allDay ? ', ' + r.calendar.allDay + ' all-day' : '') : '') + '</dl>' +
      (r.calendar.note ? '<p class="small-text muted">' + esc(r.calendar.note) + '</p>' : '') +
      (r.calendar.clashes.length ? '<h3>Clashes</h3><ul class="wi-list">' + r.calendar.clashes.map(function (x) { return '<li><b>' + esc(x.title) + '</b><span class="small-text">' + esc(x.start) + ' to ' + esc(x.end) + '</span></li>'; }).join('') + '</ul>' : '') +
      (r.atRisk ? '<h3>Most at risk</h3><p><b>' + esc(r.atRisk.title) + '</b><br><span class="small-text">' + esc(r.atRisk.why) + '</span></p>' : '<h3>Most at risk</h3><p class="small-text muted">Nothing becomes at risk.</p>') +
      (r.tight.tasks.length || r.tight.promises.length ? '<h3>Becomes tight</h3><ul class="wi-list">' + r.tight.tasks.map(function (x) { return '<li><b>' + esc(x.title) + '</b><span class="small-text">Task, about ' + x.minutes + ' min' + (x.guess ? ' (a guess)' : '') + '</span></li>'; }).join('') + r.tight.promises.map(function (x) { return '<li><b>' + esc(x.title) + '</b><span class="small-text">Promise' + (x.counterparty ? ' to ' + esc(x.counterparty) : '') + ', due ' + esc(x.deadline) + '</span></li>'; }).join('') + '</ul>' : '') +
      '<details class="wi-rules"><summary>The rules behind these numbers</summary><ul class="small-text">' + r.rules.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>' +
      '<p class="small-text muted">' + esc(r.changed) + '</p><div class="btn-row"><button type="button" class="btn primary" data-act="wiAdd">Add it for real</button><button type="button" class="btn" data-act="wiClear">Try another</button></div></article>';
  }
  S.whatif = {
    render: function () {
      return J.head('Work', 'What if I say yes?', 'Type something you might agree to. NOVA shows what it would do to that day, and changes nothing.', '') +
        '<article class="panel"><form id="wiForm" data-wi="form"><div class="field"><label for="wiText">What might you say yes to?</label><input id="wiText" type="text" maxlength="300" autocomplete="off" value="' + esc(W.text) + '" placeholder="Join the Friday workshop 2pm to 5pm" aria-describedby="wiHint"><p class="small-text muted" id="wiHint">Say the day and, if you know it, the time or the length. For example: "Dinner with Sara tomorrow 7 to 9pm" or "Finish the report on Friday for 2 hours".</p></div>' +
        '<button type="submit" class="btn primary"' + (W.busy ? ' disabled' : '') + '>' + (W.busy ? 'Checking…' : 'See what happens') + '</button></form>' +
        '<div aria-live="polite">' + (W.error ? '<p class="load-error" role="alert">' + esc(W.error) + '</p>' : '') + '</div></article>' +
        (W.result ? resultHTML(W.result) : '<article class="panel"><p class="empty">Nothing checked yet. Type something above. Nothing is added or changed by checking.</p></article>');
    }
  };
  document.addEventListener('submit', function (e) {
    if (!e.target.getAttribute || e.target.getAttribute('data-wi') !== 'form') return;
    e.preventDefault(); if (W.busy) return;
    W.text = ($('#wiText') || {}).value || ''; W.error = ''; W.result = null;
    if (!W.text.trim()) { W.error = 'Type what you might say yes to, for example "Join the Friday workshop 2pm to 5pm".'; return J.render(false); }
    var ev = events(); W.busy = true; J.render(false);
    N.api('POST', '/api/whatif', { text: W.text, calendar: ev.has, events: ev.has ? ev.list : undefined }).then(function (r) { W.result = r; }).catch(function (x) { W.error = x.message; }).then(function () {
      W.busy = false; J.render(false); var h = $('#wiH') || $('#wiText'); if (h) h.focus({ preventScroll: false });
    });
  });
  J.actions.wiAdd = function () { if (W.result && N.capture) N.capture.open(W.text); };
  J.actions.wiClear = function () { W.result = null; W.error = ''; W.text = ''; J.render(false); var f = $('#wiText'); if (f) f.focus(); };
})();

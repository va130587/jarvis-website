/* NOVA Day Replay: what NOVA did on a day, in time order, with a time slider. Read-only: it only shows records NOVA already keeps.
   The slider moves a marker through the day; events up to that time are shown in full, later ones are quieter and marked "later". */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc, $ = J.$, $$ = J.$$, S = J.screens;
  var R = N.replay = { day: null, min: null };

  var GROUP = { asked: 'Request', preview: 'Preview', approved: 'Approved', rejected: 'Rejected', verified: 'Checked', problem: 'Problem', proof: 'ProofLoop', notice: 'Notice', focus: 'Focus', job: 'Job', security: 'Security' };
  var GLYPH = { asked: '?', preview: '◇', approved: '✓', rejected: '✕', verified: '✓', problem: '!', proof: '◎', notice: '●', focus: '◔', job: '↻', security: '⚿' };

  function dubaiToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  function dubaiMinutes() { var p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).split(':'); return (+p[0] % 24) * 60 + +p[1]; }
  function addDays(iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function hhmm(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }
  function minOf(at) { return +at.slice(0, 2) * 60 + +at.slice(3, 5); }
  function day() { return R.day || dubaiToday(); }
  function key(d) { return 'replay-' + (d || day()); }               // one cache entry per day, so a day fetched a moment ago is never mistaken for another
  function url() { return '/api/replay?day=' + encodeURIComponent(day()); }
  function nice(iso) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }

  function marker(r) { return R.min === null ? (r.day === r.today ? dubaiMinutes() : 1439) : R.min; }
  function upTo(r, m) { return r.events.filter(function (e) { return minOf(e.at) <= m; }).length; }
  function readout(r, m) { var n = upTo(r, m); return 'Up to ' + hhmm(m) + ': ' + n + ' of ' + r.total + (r.total === 1 ? ' event' : ' events'); }

  function strip(r, m) {
    var max = Math.max.apply(null, r.hours.concat([1]));
    return '<div class="rp-strip" aria-hidden="true">' + r.hours.map(function (h) { return '<i style="height:' + (h ? 12 + 88 * h / max : 4).toFixed(0) + '%"' + (h ? '' : ' class="none"') + '></i>'; }).join('') + '<b class="rp-mark" style="left:' + (m / 1439 * 100).toFixed(2) + '%"></b></div>';
  }
  function eventsHTML(r, m) {
    return '<ol class="rp-list">' + r.events.map(function (e) {
      var later = minOf(e.at) > m;
      return '<li class="rp-ev g-' + e.group + (later ? ' later' : '') + '" data-min="' + minOf(e.at) + '"><button type="button" class="linklike rp-time" data-act="rpJump" data-id="' + minOf(e.at) + '" aria-label="' + esc(e.at) + ', move the marker here">' + esc(e.at) + '</button>' +
        '<span class="rp-tag"><span aria-hidden="true">' + GLYPH[e.group] + '</span> ' + GROUP[e.group] + '</span>' +
        '<div class="rp-body"><p class="rp-title">' + esc(e.title) + '<span class="sr-only rp-later-text">' + (later ? ' (later than the marker)' : '') + '</span></p>' + (e.detail ? '<p class="rp-detail">' + esc(e.detail) + '</p>' : '') + '</div>' +
        (e.link ? '<a class="rp-open" href="' + esc(e.link) + '" aria-label="Open the page for: ' + esc(e.title) + '">Open</a>' : '') + '</li>';
    }).join('') + '</ol>';
  }

  S.replay = {
    render: function () {
      var d = day(), today = dubaiToday(), r = N.cache[key(d)];
      var head = J.head('Review', 'Day Replay', 'What NOVA did on a day, in order, from its own records. Read-only: nothing here changes anything.', '');
      var controls = '<article class="panel rp-controls"><div class="rp-days"><button type="button" class="btn small" data-act="rpPrev">‹ Previous day</button>' +
        '<label class="rp-date"><span class="sr-only">Day</span><input type="date" id="rpDay" value="' + esc(d) + '" max="' + esc(today) + '" min="2020-01-01"></label>' +
        '<button type="button" class="btn small" data-act="rpNext"' + (d >= today ? ' disabled' : '') + '>Next day ›</button><button type="button" class="btn small ghost" data-act="rpToday"' + (d === today ? ' disabled' : '') + '>Today</button></div>' +
        '<p class="rp-dayname">' + esc(nice(d)) + (d === today ? ' · today' : '') + ' · Dubai time</p>';
      if (!r) return head + controls + '</article>' + J.empty('Loading…');
      var m = marker(r);
      controls += strip(r, m) + '<label class="rp-label" for="rpTime">Time of day</label><input type="range" id="rpTime" min="0" max="1439" step="1" value="' + m + '" aria-valuetext="' + esc(hhmm(m) + ', ' + upTo(r, m) + ' of ' + r.total + ' events so far') + '">' +
        '<p class="rp-readout" id="rpReadout" role="status">' + esc(readout(r, m)) + '</p></article>';
      if (!r.total) return head + controls + J.empty('Nothing happened on this day. NOVA keeps no record of it.');
      return head + controls + '<article class="panel">' + eventsHTML(r, m) + (r.truncated ? '<p class="small-text muted">Showing the first ' + r.events.length + ' of ' + r.total + ' events.</p>' : '') + '</article>';
    },
    after: function () {
      N.h.stale('replay', [[key(), url()]]);
      var sl = $('#rpTime'), dt = $('#rpDay'), r = N.cache[key()];
      if (sl && r) sl.addEventListener('input', function () { R.min = +sl.value; paint(r, R.min); });
      if (dt) dt.addEventListener('change', function () { if (/^\d{4}-\d{2}-\d{2}$/.test(dt.value) && dt.value <= dubaiToday()) go(dt.value); });
    }
  };
  // Move the marker without redrawing the page: only the quiet/full look of the rows, the readout and the strip marker change.
  function paint(r, m) {
    $$('.rp-ev').forEach(function (li) { var later = +li.getAttribute('data-min') > m; li.classList.toggle('later', later); var t = li.querySelector('.rp-later-text'); if (t) t.textContent = later ? ' (later than the marker)' : ''; });
    var ro = $('#rpReadout'), mk = $('.rp-mark'), sl = $('#rpTime');
    if (ro) ro.textContent = readout(r, m); if (mk) mk.style.left = (m / 1439 * 100).toFixed(2) + '%';
    if (sl) { sl.value = m; sl.setAttribute('aria-valuetext', hhmm(m) + ', ' + upTo(r, m) + ' of ' + r.total + ' events so far'); }
  }
  function go(d) { R.day = d; R.min = null; J.render(false); var f = $('#rpDay'); if (f) f.focus({ preventScroll: true }); }
  Object.assign(J.actions, {
    rpPrev: function () { go(addDays(day(), -1)); },
    rpNext: function () { if (day() < dubaiToday()) go(addDays(day(), 1)); },
    rpToday: function () { go(dubaiToday()); },
    rpJump: function (min) { var r = N.cache[key()]; if (r) { R.min = +min; paint(r, R.min); } }
  });
})();

/* NOVA Life Timeline: everything that happened, newest first, grouped by day, with filters by kind, a search and "Show more". Read-only:
   every row links back to its own page. Loaded in pages, so a long history stays fast. */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc, $ = J.$, S = J.screens;
  var T = N.timeline = { events: null, next: null, types: [], selected: null, q: '', busy: false, error: '', started: false };

  function url(before) { return '/api/timeline?limit=50' + (T.selected && T.types.length && T.selected.length < T.types.length ? '&types=' + encodeURIComponent(T.selected.join(',')) : '') + (T.q ? '&q=' + encodeURIComponent(T.q) : '') + (before ? '&before=' + encodeURIComponent(before) : ''); }
  function load(more) {
    if (T.busy) return; T.busy = true; T.error = ''; J.render(false);
    N.api('GET', url(more ? T.next : null)).then(function (d) {
      T.types = d.types; if (!T.selected) T.selected = d.selected.slice();
      T.events = more ? (T.events || []).concat(d.events) : d.events; T.next = d.next; T.today = d.today;
    }).catch(function (e) { T.error = e.message; }).then(function () { T.busy = false; J.render(false); if (more) { var b = $('#tlMore'); if (b) b.focus({ preventScroll: true }); } });
  }
  function dayHead(d) { return (d === T.today ? 'Today' : J.longDate ? J.longDate(d) : d); }
  function groups() {
    var out = [], cur = null;
    T.events.forEach(function (e) { if (!cur || cur.day !== e.day) { cur = { day: e.day, rows: [] }; out.push(cur); } cur.rows.push(e); });
    return out.map(function (g) {
      return '<section class="panel tl-day" aria-labelledby="tl-' + esc(g.day) + '"><h2 class="label" id="tl-' + esc(g.day) + '">' + esc(dayHead(g.day)) + ' <span class="n">' + g.rows.length + '</span></h2><ul class="tl-list">' + g.rows.map(function (e) {
        return '<li class="tl-row"><span class="tl-time mono">' + esc(e.time || '') + '</span><div class="tl-main"><span class="tag tl-kind">' + esc(e.typeLabel) + '</span> <b>' + esc(e.title) + '</b><span class="small-text muted">' + esc(e.what) + (e.detail ? ' · ' + esc(e.detail) : '') + '</span></div><a class="btn small ghost" href="' + esc(e.link) + '" aria-label="Open: ' + esc(e.title) + '">Open</a></li>';
      }).join('') + '</ul></section>';
    }).join('');
  }
  S.timeline = {
    render: function () {
      var head = J.head('Life', 'Life Timeline', 'Everything that happened, newest first: tasks finished, promises kept, expenses, habits, notes and what NOVA did for you. Nothing here changes anything.', '');
      var chips = T.types.length ? '<div class="mail-filters" role="group" aria-label="Show these kinds">' + T.types.map(function (t) { var on = T.selected.indexOf(t.id) >= 0; return '<button type="button" class="chip-btn' + (on ? ' on' : '') + '" data-act="tlType" data-id="' + t.id + '" aria-pressed="' + on + '">' + esc(t.label) + '</button>'; }).join('') + '</div>' : '';
      var ctl = '<article class="panel"><form id="tlForm" data-tl="form" role="search"><div class="field"><label for="tlQ">Search the timeline</label><input id="tlQ" type="search" maxlength="80" value="' + esc(T.q) + '" placeholder="A word, a name or an amount"></div><button type="submit" class="btn">Search</button></form>' + chips + '</article>';
      var body = T.error ? '<p class="load-error" role="alert">' + esc(T.error) + '</p>' : T.events === null ? J.empty('Loading…') : !T.events.length ? '<article class="panel"><p class="empty">' + (T.q || (T.selected && T.selected.length < T.types.length) ? 'Nothing matches. Try a different word or show more kinds.' : 'Nothing has happened yet. Finish a task, add a note or log an expense and it appears here.') + '</p></article>' : groups();
      return head + ctl + body + (T.next ? '<p class="btn-row"><button type="button" class="btn" id="tlMore" data-act="tlMore"' + (T.busy ? ' disabled' : '') + '>' + (T.busy ? 'Loading…' : 'Show more') + '</button></p>' : '') + '<p class="sr-only" role="status">' + (T.events ? T.events.length + ' events shown' : '') + '</p>';
    },
    after: function () { if (!T.started) { T.started = true; load(false); } }
  };
  document.addEventListener('submit', function (e) {
    if (!e.target.getAttribute || e.target.getAttribute('data-tl') !== 'form') return;
    e.preventDefault(); T.q = (($('#tlQ') || {}).value || '').trim(); T.events = null; T.next = null; load(false);
  });
  J.actions.tlType = function (id) {
    var i = T.selected.indexOf(id); if (i >= 0) { if (T.selected.length === 1) { J.toast('Keep at least one kind selected.'); return; } T.selected.splice(i, 1); } else T.selected.push(id);
    T.events = null; T.next = null; load(false);
  };
  J.actions.tlMore = function () { load(true); };
  document.addEventListener('jarvis:rendered', function () { if (J.current && J.current() !== 'timeline') T.started = false; });
})();

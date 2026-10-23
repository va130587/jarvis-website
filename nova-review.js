/* NOVA Weekly Review: the last full Dubai week, only from your own data, with "not enough data yet" where there is none,
   three suggested priorities with the rule shown, Copy as text and Download as Markdown. Read-only. */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc, $ = J.$, S = J.screens;
  var R = N.review = { week: '' };

  function nice(iso) { return J.longDate ? J.longDate(iso) : iso; }
  function none(msg) { return '<p class="small-text muted wr-none">' + esc(msg) + '</p>'; }
  function panel(id, title, body) { return '<article class="panel wr-sec" aria-labelledby="wr-' + id + '"><h2 class="label" id="wr-' + id + '">' + esc(title) + '</h2>' + body + '</article>'; }
  function dl(pairs) { return '<dl class="trust-counts">' + pairs.map(function (p) { return '<div><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>'; }).join('') + '</dl>'; }
  function list(rows) { return '<ul class="trust-people">' + rows.join('') + '</ul>'; }
  function row(a, b) { return '<li><b>' + esc(a) + '</b>' + (b ? '<span class="small-text">' + esc(b) + '</span>' : '') + '</li>'; }
  function mins(m) { return m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min'; }
  var RESULT = { onTime: 'kept on time', late: 'kept late', notKept: 'not kept', stillOpen: 'still open', cancelled: 'cancelled', doneNoDeadline: 'done' };

  function body(d) {
    var f = d.finished, p = d.promises, fo = d.focus, h = d.habits, sp = d.spending, sl = d.slipped, pr = d.priorities;
    return panel('done', 'What I finished', f.empty ? none(f.message) : '<p class="wr-big">' + f.total + ' task' + (f.total === 1 ? '' : 's') + ' finished</p>' +
        list(f.byDay.filter(function (x) { return x.count; }).map(function (x) { return row(x.weekday + ' ' + nice(x.date), x.count + ' finished'); })) + (f.items.length ? '<details class="trust-rule"><summary>Which tasks</summary><ul class="small-text">' + f.items.map(function (x) { return '<li>' + esc(x.title) + '</li>'; }).join('') + '</ul></details>' : '')) +
      panel('promises', 'Promises', p.empty ? none(p.message) : dl([['Kept on time', p.onTime], ['Kept late', p.late], ['Not kept', p.notKept], ['Still open', p.stillOpen], ['Kept this week', p.keptThisWeek]]) +
        (p.items.length ? list(p.items.map(function (x) { return row(x.title, (x.counterparty ? 'To ' + x.counterparty + ' · ' : '') + 'due ' + x.deadline + ' · ' + RESULT[x.result]); })) : '') + '<p class="small-text muted">' + esc(p.rule) + '</p>') +
      panel('focus', 'Focus time', fo.empty ? none(fo.message) : '<p class="wr-big">' + esc(mins(fo.totalMin)) + ' in ' + fo.sessions + ' session' + (fo.sessions === 1 ? '' : 's') + '</p>' + list(fo.byDay.filter(function (x) { return x.minutes; }).map(function (x) { return row(x.weekday + ' ' + nice(x.date), mins(x.minutes)); }))) +
      panel('habits', 'Habits', h.empty ? none(h.message) : list(h.items.map(function (x) { return row(x.name, x.done + ' of ' + x.of + ' days · streak ' + x.streak + ' day' + (x.streak === 1 ? '' : 's') + ' · the week before ' + x.previousDone + ' of ' + x.previousOf); }))) +
      panel('spending', 'Spending against budget', (sp.empty ? none(sp.message) : '<p class="wr-big">' + esc(sp.totalLabel) + ' spent in ' + sp.count + ' purchase' + (sp.count === 1 ? '' : 's') + '</p>' + list(sp.byCategory.map(function (x) { return row(x.category, x.label); }))) +
        (sp.budget ? '<p>Month so far: <b>' + esc(sp.budget.monthToDateLabel) + '</b> of ' + esc(sp.budget.monthlyLabel) + ' (' + sp.budget.usedPct + '%). <span class="small-text muted">' + esc(sp.budget.note) + '</span></p>' : none(sp.budgetMessage))) +
      panel('slipped', 'Things that slipped', sl.empty ? none(sl.message) : '<p>' + sl.total + ' item' + (sl.total === 1 ? '' : 's') + ' past their date at the end of the week.</p>' + list(sl.items.map(function (x) { return row(x.kind + ': ' + x.title, 'due ' + x.due + ' · ' + x.daysLate + ' day' + (x.daysLate === 1 ? '' : 's') + ' late'); }))) +
      panel('next', 'Three priorities for next week', '<ol class="wr-prio">' + pr.items.map(function (x) { return '<li><b>' + (x.title ? esc(x.kind + ': ' + x.title) : 'No suggestion') + '</b><span class="small-text">' + esc(x.why) + '</span><span class="small-text muted">' + esc(x.rule) + '</span></li>'; }).join('') + '</ol><p class="small-text muted">' + esc(pr.note) + '</p>');
  }
  S.weekreview = {
    render: function () {
      var d = N.cache.weekreview;
      var actions = d ? '<button type="button" class="btn" data-act="wrCopy">Copy as text</button><button type="button" class="btn" data-act="wrDownload">Download as Markdown</button>' : '';
      var head = J.head('Life', 'Weekly Review', 'Your week, from your own data only. Nothing here changes anything.', actions);
      if (!d) return head + J.empty('Loading…');
      return head + '<article class="panel"><div class="field wr-pick"><label for="wrWeek">Week</label><select id="wrWeek">' + d.weeks.map(function (w) { return '<option value="' + esc(w.from) + '"' + (w.from === d.week.from ? ' selected' : '') + '>' + esc(w.label) + '</option>'; }).join('') + '</select></div>' +
        '<p class="wr-week"><b>' + esc(d.week.label) + '</b></p>' + (d.week.note ? '<p class="small-text muted">' + esc(d.week.note) + '</p>' : '') + '</article>' + body(d);
    },
    after: function () {
      N.h.stale('weekreview', [['weekreview', '/api/review' + (R.week ? '?week=' + encodeURIComponent(R.week) : '')]]);
      var s = $('#wrWeek'); if (s && !s._wr) { s._wr = 1; s.addEventListener('change', function () { R.week = s.value; R.refocus = true; N.cache.weekreview = null; J.render(false); }); }
      if (R.refocus && N.cache.weekreview) { R.refocus = false; var n = $('#wrWeek'); if (n) n.focus({ preventScroll: true }); }   // the picker is redrawn once the new week has loaded
    }
  };
  function download(name, text, type) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  J.actions.wrCopy = function () {
    var d = N.cache.weekreview; if (!d) return;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(d.text).then(function () { J.toast('Copied your weekly review as text.'); }).catch(function () { J.toast('Could not copy. Use Download as Markdown instead.'); });
    else J.toast('Could not copy. Use Download as Markdown instead.');
  };
  J.actions.wrDownload = function () { var d = N.cache.weekreview; if (!d) return; download('nova-weekly-review-' + d.week.from + '.md', d.markdown, 'text/markdown'); J.toast('Downloaded your weekly review.'); };
})();

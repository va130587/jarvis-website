/* NOVA "Can people rely on me?": reliability from ProofLoop only, with the rule next to every number, and a "Before you promise" check of the week.
   Read-only: it changes nothing. Shown on the ProofLoop page. */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc;
  var T = N.trust = { heads: null, busy: false, error: '' };

  var PARTS = [['onTime', 'Kept on time'], ['late', 'Late'], ['notKept', 'Not kept'], ['overdue', 'Past deadline, still open'], ['open', 'Open, not due yet'], ['doneNoDeadline', 'Done, no deadline'], ['cancelled', 'Cancelled']];
  function counts(g) {
    return '<dl class="trust-counts">' + PARTS.map(function (p) { return '<div><dt>' + esc(p[1]) + '</dt><dd>' + (g[p[0]] || 0) + '</dd></div>'; }).join('') + '</dl>';
  }
  function side(title, g, empty) {
    var t = g.total;
    return '<section class="trust-side" aria-label="' + esc(title) + '"><h3>' + esc(title) + '</h3>' +
      '<p class="trust-line' + (t.percent === null ? ' muted' : '') + '">' + esc(t.line) + (t.percent !== null ? ' <b>(' + t.percent + '%)</b>' : '') + '</p>' + counts(t) +
      (g.people.length ? '<ul class="trust-people">' + g.people.map(function (p) { return '<li><b>' + esc(p.name) + '</b><span class="small-text' + (p.percent === null ? ' muted' : '') + '">' + esc(p.line) + '</span></li>'; }).join('') + '</ul>' : '<p class="small-text muted">' + esc(empty) + '</p>') + '</section>';
  }
  T.panel = function () {
    var d = N.cache.trust;
    if (!d) return '<article class="panel" id="trustPanel"><h2 class="label">Can people rely on me?</h2><p class="small-text muted">Loading…</p></article>';
    return '<article class="panel" id="trustPanel"><h2 class="label">Can people rely on me?</h2>' +
      (d.promises ? '<div class="trust-grid">' + side('My promises to others', d.iOwe, 'Name the person on a promise to see it here.') + side('Promises made to me', d.owedToMe, 'Name the person on a promise to see it here.') + '</div>'
        : '<p class="empty">No promises yet. Add a commitment above, or say "I promised Sara the slides by Friday" in Chat, and this page shows how it goes.</p>') +
      '<details class="trust-rule"><summary>How is this worked out?</summary><p class="small-text">' + esc(d.rule) + ' A percentage appears only with at least ' + d.min + ' counted promises. Everything here is read from ProofLoop; nothing is guessed.</p></details>' +
      '<form class="trust-form" data-trust="form"><div class="field"><label for="trustDate">Before I promise something due on</label><input id="trustDate" type="date" value="' + esc(T.date || '') + '"></div><button type="submit" class="btn">Check my week</button></form>' +
      '<div class="trust-heads" role="status" aria-live="polite">' + (T.error ? '<p class="load-error">' + esc(T.error) + '</p>' : T.heads ? headsHtml(T.heads) : '') + '</div></article>';
  };
  function headsHtml(h) {
    var list = h.items.length ? '<ul class="trust-people">' + h.items.map(function (i) { return '<li><b>' + esc(i.title) + '</b><span class="small-text">due ' + esc(i.deadline) + (i.counterparty ? ' · ' + esc(i.counterparty) : '') + '</span></li>'; }).join('') + '</ul>' : '';
    return '<p><b>' + (h.message ? 'Heads up. ' : 'No heads-up. ') + '</b>' + esc(h.message || 'You have ' + h.open + ' open promise' + (h.open === 1 ? '' : 's') + ' due that week (Monday ' + h.week.from + ' to Sunday ' + h.week.to + ').') + '</p>' + list;
  }
  document.addEventListener('submit', function (e) {
    if (!e.target.getAttribute || e.target.getAttribute('data-trust') !== 'form') return;
    e.preventDefault(); var v = (document.getElementById('trustDate') || {}).value; T.date = v;
    if (!v) { T.error = 'Choose a date first.'; T.heads = null; return J.render(false); }
    T.error = '';
    N.api('GET', '/api/proofloop/heads-up?deadline=' + encodeURIComponent(v)).then(function (r) { T.heads = r; }).catch(function (x) { T.error = x.message; T.heads = null; }).then(function () { J.render(false); var f = document.getElementById('trustDate'); if (f) f.focus({ preventScroll: true }); });
  });
})();

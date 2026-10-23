/* NOVA Decision Journal: record a decision, what you expect and a date to look back. On that date one notification asks how it turned out.
   Saving and answering use the same preview and approval as everything else, and appear in the Undo list. */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc, $ = J.$, S = J.screens;
  var Jn = N.journal = { runId: 0, error: '', busy: false, reloaded: true, draft: { title: '', why: '', expected: '', reviewOn: '' } };

  function week() { return J.addDays ? J.addDays(J.today(), 7) : ''; }
  function runArea() {
    var run = Jn.runId && N.runs[Jn.runId]; if (!run) return '';
    if (run.pendingApproval) return '<article class="panel" id="jnRun"><h2 class="label">Check this first</h2>' + (N.previewCard ? N.previewCard(run) : '') + '</article>';
    var ok = run.status === 'completed';
    return '<article class="panel" id="jnRun" role="status"><p class="tag ' + (ok ? '' : 'gold') + '">' + esc(ok ? 'Done and checked' : run.status.replace(/_/g, ' ')) + '</p> <span class="small-text">' + esc(run.result || (ok ? '' : 'Nothing was changed.')) + '</span> <button type="button" class="btn small ghost" data-act="jnDismiss">Dismiss</button></article>';
  }
  function form() {
    var d = Jn.draft;
    return '<article class="panel"><h2 class="label">Record a decision</h2><form id="jnForm" data-jn="form" novalidate><div class="field"><label for="jnTitle">What did you decide?</label><input id="jnTitle" type="text" maxlength="200" value="' + esc(d.title) + '"></div>' +
      '<div class="field"><label for="jnWhy">Why? <span class="muted">(optional)</span></label><textarea id="jnWhy" rows="2" maxlength="500">' + esc(d.why) + '</textarea></div>' +
      '<div class="field"><label for="jnExpected">What do you expect to happen?</label><input id="jnExpected" type="text" maxlength="300" value="' + esc(d.expected) + '"></div>' +
      '<div class="field"><label for="jnDate">Look back on</label><input id="jnDate" type="date" value="' + esc(d.reviewOn || week()) + '"></div>' +
      (Jn.error ? '<p class="load-error" role="alert">' + esc(Jn.error) + '</p>' : '') + '<button type="submit" class="btn primary"' + (Jn.busy ? ' disabled' : '') + '>Preview</button> <span class="small-text muted">You see a preview and approve before anything is saved.</span></form></article>';
  }
  function item(x) {
    var asked = x.due ? '<div class="btn-row" role="group" aria-label="How did it turn out?">' + [['as_expected', 'As expected'], ['better', 'Better than expected'], ['worse', 'Worse than expected']].map(function (o) { return '<button type="button" class="btn small" data-act="jnAnswer" data-id="' + x.id + ':' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>' : '';
    return '<li class="jn-item"><b>' + esc(x.title) + '</b>' + (x.why ? '<span class="small-text">Why: ' + esc(x.why) + '</span>' : '') + '<span class="small-text">Expected: ' + esc(x.expected) + '</span>' +
      '<span class="small-text muted">' + (x.status === 'reviewed' ? 'Turned out: ' + esc(x.outcomeLabel) + (x.outcomeNote ? ' (' + esc(x.outcomeNote) + ')' : '') : (x.due ? 'Time to look back (due ' + esc(x.reviewOn) + ')' : 'Look back on ' + esc(x.reviewOn))) + '</span>' + asked + '</li>';
  }
  function sections(d) {
    var due = d.decisions.filter(function (x) { return x.due; }), soon = d.decisions.filter(function (x) { return x.status === 'open' && !x.due; }), done = d.decisions.filter(function (x) { return x.status === 'reviewed'; }), r = d.record;
    function sec(id, t, rows, empty) { return '<article class="panel" aria-labelledby="jn-' + id + '"><h2 class="label" id="jn-' + id + '">' + esc(t) + (rows.length ? ' <span class="n">' + rows.length + '</span>' : '') + '</h2>' + (rows.length ? '<ul class="trust-people">' + rows.map(item).join('') + '</ul>' : '<p class="small-text muted">' + esc(empty) + '</p>') + '</article>'; }
    return sec('due', 'Time to look back', due, 'Nothing is waiting for your answer.') + sec('soon', 'Coming up', soon, 'No decisions waiting for their review date.') + sec('done', 'Answered', done, 'None answered yet.') +
      '<article class="panel" aria-labelledby="jn-rec"><h2 class="label" id="jn-rec">Your record</h2><p class="jn-line' + (r.ready ? '' : ' muted') + '">' + esc(r.line) + '</p>' +
      '<dl class="trust-counts"><div><dt>As expected</dt><dd>' + r.asExpected + '</dd></div><div><dt>Better than expected</dt><dd>' + r.better + '</dd></div><div><dt>Worse than expected</dt><dd>' + r.worse + '</dd></div></dl><p class="small-text muted">' + esc(r.rule) + '</p></article>';
  }
  S.journal = {
    render: function () {
      var d = N.cache.decisions, head = J.head('Life', 'Decision Journal', 'Write down a decision and what you expect. When the date comes, NOVA asks how it turned out, and builds an honest record over time.', '');
      return head + runArea() + form() + (d ? sections(d) : J.empty('Loading…'));
    },
    after: function () {
      var run = Jn.runId && N.runs[Jn.runId];
      if (run && !run.pendingApproval && !Jn.reloaded) { Jn.reloaded = true; N.cache.decisions = null; if (run.status === 'completed') { Jn.draft = { title: '', why: '', expected: '', reviewOn: '' }; } }
      N.h.stale('journal', [['decisions', '/api/decisions']]);
    }
  };
  function start(path, body) {
    Jn.busy = true; Jn.error = ''; J.render(false);
    return N.api('POST', path, body).then(function (r) { N.runs[r.run.id] = r.run; Jn.runId = r.run.id; Jn.reloaded = false; }).catch(function (e) { Jn.error = e.message; }).then(function () { Jn.busy = false; J.render(false); var p = $('#jnRun'); if (p) p.scrollIntoView({ block: 'nearest' }); });
  }
  document.addEventListener('submit', function (e) {
    if (!e.target.getAttribute || e.target.getAttribute('data-jn') !== 'form') return;
    e.preventDefault(); if (Jn.busy) return;
    Jn.draft = { title: $('#jnTitle').value, why: $('#jnWhy').value, expected: $('#jnExpected').value, reviewOn: $('#jnDate').value };
    if (!Jn.draft.title.trim() || !Jn.draft.expected.trim()) { Jn.error = 'Write what you decided and what you expect to happen.'; return J.render(false); }
    start('/api/decisions/start', Jn.draft);
  });
  J.actions.jnAnswer = function (id) { var p = String(id).split(':'); if (Jn.busy) return; start('/api/decisions/' + p[0] + '/review', { outcome: p[1] }); };
  J.actions.jnDismiss = function () { Jn.runId = 0; J.render(false); };
})();

/* NOVA energy marks: tap high, medium or low for the morning, afternoon and evening. After 7 days of marks NOVA shows your own pattern and, only if you
   switch it on, the planner puts hard tasks in your high-energy hours. Nothing is guessed from anything else. Shown on Focus and Planner. */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc;
  var E = N.energy = { busy: false };
  var LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

  E.panel = function () {
    var d = N.cache.energy;
    if (!d) return '<article class="panel" id="energyPanel"><h2 class="label">How is your energy?</h2><p class="small-text muted">Loading…</p></article>';
    return '<article class="panel" id="energyPanel"><h2 class="label">How is your energy?</h2>' +
      '<p class="small-text muted">Tap one for each part of today. Press the same one again to clear it. This is only your own report: NOVA never guesses your energy.</p>' +
      '<div class="en-rows">' + d.slots.map(function (s) {
        return '<div class="en-row" role="group" aria-label="' + esc(s.label + ' energy, ' + s.window) + '"><span class="en-slot">' + esc(s.label) + '<span class="small-text muted"> ' + esc(s.window) + '</span></span><span class="en-btns">' +
          d.levels.map(function (l) { return '<button type="button" class="chip-btn" data-act="enMark" data-id="' + s.id + ':' + l + '" aria-pressed="' + (s.level === l) + '"' + '>' + LABEL[l] + '</button>'; }).join('') + '</span></div>';
      }).join('') + '</div>' +
      '<p class="en-summary" role="status">' + esc(d.summary) + '</p>' +
      '<div class="en-plan"><label class="check-chip"><input type="checkbox" id="enPlan" data-en="plan"' + (d.plan.wanted && d.plan.on ? ' checked' : '') + (!d.plan.available && !d.plan.wanted ? ' disabled' : '') + '>Put hard tasks in my high-energy hours</label><p class="small-text muted">' + esc(d.plan.note) + '</p></div>' +
      '<details class="trust-rule"><summary>How is this worked out?</summary><p class="small-text">' + esc(d.rule) + ' Hard tasks are the ones that need 60 minutes or more.</p></details></article>';
  };
  function refresh(r, replan) { N.cache.energy = r; if (replan) N.cache.plan = null; J.render(false); }
  // the page is redrawn after every change, so focus goes back to what you were using
  document.addEventListener('jarvis:rendered', function () { if (!E.refocus) return; var el = document.querySelector(E.refocus); if (el) { E.refocus = ''; el.focus({ preventScroll: true }); } });
  J.actions.enMark = function (id) {
    if (E.busy) return; var p = String(id).split(':'), d = N.cache.energy, cur = d && d.slots.filter(function (s) { return s.id === p[0]; })[0];
    var level = cur && cur.level === p[1] ? null : p[1]; E.busy = true;
    E.refocus = '[data-act="enMark"][data-id="' + id + '"]';
    N.api('POST', '/api/energy', { slot: p[0], level: level }).then(function (r) { refresh(r, false); }).catch(function (e) { J.toast(e.message); }).then(function () { E.busy = false; J.render(false); });
  };
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t || !t.getAttribute || t.getAttribute('data-en') !== 'plan') return;
    E.refocus = '#enPlan';
    N.api('POST', '/api/energy/plan', { on: t.checked }).then(function (r) { refresh(r, true); }).catch(function (x) { J.toast(x.message); t.checked = !t.checked; });
  });
})();

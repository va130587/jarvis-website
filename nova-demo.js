/* NOVA guided demo (only when NOVA runs in demo mode: `npm run demo`): five numbered steps on the dashboard, each ticked when you have done it.
   The ticks are remembered for your account. Everything in the demo is fictional. */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc, $ = J.$;
  var D = N.demo = {};
  var STEPS = [
    { id: 'orbit', title: 'Promise Orbit', how: 'Open one of the dots around the orb on this page. Each dot is something you owe or are owed.', act: 'demoOrbit', label: 'Show me the dots' },
    { id: 'replay', title: 'Day Replay', how: 'Open Day Replay and move the time slider to see what NOVA did, hour by hour.', href: '#replay', label: 'Open Day Replay' },
    { id: 'radar', title: 'Life Radar', how: 'Open Weekly Insights, then point at (or Tab to) a spoke of the radar to read its number.', href: '#insights', label: 'Open Weekly Insights' },
    { id: 'receipt', title: 'Receipt check', how: 'In ProofLoop, press "Check a receipt". It opens the public page that checks a proof receipt.', href: '#proofloop', label: 'Open ProofLoop' },
    { id: 'effects', title: '"What happens if"', how: 'In Chat, type: add a task to call HR by friday. The preview lists what else it would touch, before you approve.', href: '#chat', label: 'Open Chat' }
  ];
  function steps() { return (N.user && N.user.demoSteps) || []; }
  function on() { return !!(N.session && N.session.demo && N.user); }
  function done(id) { return steps().indexOf(id) >= 0; }

  D.banner = function () {
    if (!on() || done('hidden')) return '';
    var n = STEPS.filter(function (s) { return done(s.id); }).length, all = n === STEPS.length;
    return '<article class="panel demo-guide" id="demoGuide"><div class="panel-head"><h2 class="label">Guided demo · <span id="demoCount">' + (all ? 'all 5 done' : n + ' of 5 done') + '</span></h2><button type="button" class="btn small ghost" data-act="demoHide">Hide this guide</button></div>' +
      '<p class="small-text muted">Everything in this demo is fictional. Try these five things, in any order. Each one ticks when you have done it.</p>' +
      (all ? '<p class="demo-all" role="status"><b>You have seen all five.</b> Press "Hide this guide" when you are done.</p>' : '') +
      '<ol class="demo-steps">' + STEPS.map(function (s) {
        var d = done(s.id);
        return '<li class="demo-step' + (d ? ' done' : '') + '"><span class="demo-tick" aria-hidden="true">' + (d ? '✓' : '○') + '</span><div class="demo-what"><b>' + esc(s.title) + '</b> ' + (d ? J.tag('Done', 'ok') : '<span class="sr-only">(not done yet)</span>') +
          '<br><span class="small-text muted">' + esc(s.how) + '</span></div>' + (s.href ? '<a class="btn small" href="' + s.href + '">' + esc(s.label) + '</a>' : '<button type="button" class="btn small" data-act="' + s.act + '">' + esc(s.label) + '</button>') + '</li>';
      }).join('') + '</ol></article>';
  };
  function repaint() { var el = $('#demoGuide'); if (!el) return; var h = document.createElement('div'); h.innerHTML = D.banner(); var nu = h.firstElementChild; if (nu) el.replaceWith(nu); else el.remove(); }
  D.mark = function (id) {
    if (!on() || done(id)) return;
    N.user.demoSteps = steps().concat(id);
    N.api('PATCH', '/api/profile', { demoStep: id }).catch(function () { /* it ticks again next time */ });
    repaint();
  };

  var open = J.actions.orbitOpen;
  if (open) J.actions.orbitOpen = function () { D.mark('orbit'); return open.apply(this, arguments); };
  var jump = J.actions.rpJump;
  if (jump) J.actions.rpJump = function () { D.mark('replay'); return jump.apply(this, arguments); };
  document.addEventListener('input', function (e) { if (e.target && e.target.id === 'rpTime') D.mark('replay'); });
  ['focusin', 'mouseover'].forEach(function (t) { document.addEventListener(t, function (e) { if (e.target && e.target.closest && e.target.closest('.rd-spoke')) D.mark('radar'); }); });
  document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('a[href="/verify"]')) D.mark('receipt'); });
  new MutationObserver(function () { if (on() && !done('effects') && document.querySelector('.preview .fx li')) D.mark('effects'); }).observe(document.body, { childList: true, subtree: true });

  Object.assign(J.actions, {
    demoOrbit: function () { var dot = $('.odot'); if (dot) { dot.scrollIntoView({ block: 'center' }); dot.focus(); } else J.toast('There are no dots yet. Your promises appear around the orb.'); },
    demoHide: function () { N.user.demoSteps = steps().concat('hidden'); N.api('PATCH', '/api/profile', { demoStep: 'hidden' }).catch(function () { /* it hides again next time */ }); repaint(); }
  });
})();

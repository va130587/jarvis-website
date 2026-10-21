/* NOVA first-run tour: six short steps, shown once per account (the database remembers it) and again whenever you ask.
   A real <dialog>: the page behind it is inert, Escape skips, Tab stays inside, focus returns to where it was.
   The ring is a visual aid only; every step is fully described in words. */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc, $ = J.$;
  var T = N.tour = { step: 0, open: false, shown: false };

  var STEPS = [
    { title: 'The orb', text: 'The orb shows what NOVA is doing right now: resting, thinking, or waiting for you to approve something.', sel: ['.nova-hero .nova-orb', '.nova-orb', '.nova-hero'] },
    { title: 'The menu', text: 'Everything NOVA can do is in this menu, in five groups: Today, Work, Life, Knowledge and System.', sel: ['.nav', '.bottom-nav'] },
    { title: 'Chat and approvals', text: 'Ask NOVA to do things in Chat. It shows a preview first, and nothing changes until you press Approve.', sel: ['.nav a[data-view="chat"]', '.bottom-nav a[data-view="chat"]'] },
    { title: 'Promise Orbit', text: 'The dots around the orb are things you owe or are owed. A red ring means overdue, and a green tick means the proof was checked.', sel: ['.nova-hero .orbit', '.orbit', '.nova-hero'] },
    { title: 'Search with Ctrl+K', text: 'Press Ctrl+K (or the search button at the top) to search everything you own and jump to any page.', sel: ['#palBtn'] },
    { title: 'Settings and themes', text: 'Security and Settings is where you choose the Deep Space or Daylight theme, see your devices and download your data. You can show this tour again there.', sel: ['.nav a[data-view="security"]', '.bottom-nav #moreBtn'] }
  ];

  var dlg, ring, from;
  function visible(el) { if (!el) return false; var r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }
  function target(s) { for (var i = 0; i < s.sel.length; i++) { var el = document.querySelector(s.sel[i]); if (visible(el)) return el; } return null; }

  function build() {
    dlg = document.createElement('dialog'); dlg.id = 'novaTour'; dlg.className = 'tour'; dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'tourTitle'); dlg.setAttribute('aria-describedby', 'tourText');
    dlg.innerHTML = '<div class="tour-ring" aria-hidden="true"></div><div class="tour-card"><p class="tour-count mono" id="tourCount"></p>' +
      '<div class="tour-body" aria-live="polite" aria-atomic="true"><h2 id="tourTitle"></h2><p id="tourText"></p></div>' +
      '<div class="tour-btns"><button type="button" class="btn small ghost" data-tour="skip">Skip tour</button><span class="grow"></span><button type="button" class="btn small" data-tour="back">Back</button><button type="button" class="btn small primary" data-tour="next">Next</button></div></div>';
    document.body.appendChild(dlg); ring = dlg.querySelector('.tour-ring');
    dlg.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-tour]') : null; if (!b) return;
      var a = b.getAttribute('data-tour');
      if (a === 'skip') end(); else if (a === 'back') go(T.step - 1); else if (T.step === STEPS.length - 1) end(); else go(T.step + 1);
    });
    dlg.addEventListener('keydown', function (e) {                // Tab goes round inside the tour (the browser would otherwise leave the page)
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(dlg.querySelectorAll('button'), function (b) { return !b.disabled; }), i = f.indexOf(document.activeElement);
      if (!f.length) return; e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    });
    dlg.addEventListener('close', finish);                       // Escape, Skip and Finish all end here
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
  }
  function place() {
    if (!T.open) return;
    var el = target(STEPS[T.step]), card = dlg.querySelector('.tour-card');
    dlg.classList.toggle('no-target', !el);
    if (!el) { ring.style.cssText = 'display:none'; card.classList.remove('top'); return; }
    var r = el.getBoundingClientRect(), pad = 6;
    ring.style.cssText = 'display:block;left:' + (r.left - pad) + 'px;top:' + (r.top - pad) + 'px;width:' + (r.width + 2 * pad) + 'px;height:' + (r.height + 2 * pad) + 'px';
    var room = window.innerHeight - r.bottom, above = r.top;             // the card goes where there is more room, so it never covers what it explains
    card.classList.toggle('top', above > room);
  }
  function go(i) {
    T.step = Math.max(0, Math.min(STEPS.length - 1, i));
    var s = STEPS[T.step], el = target(s);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $('#tourCount').textContent = 'Step ' + (T.step + 1) + ' of ' + STEPS.length;
    $('#tourTitle').textContent = s.title; $('#tourText').textContent = s.text;
    dlg.querySelector('[data-tour="back"]').disabled = T.step === 0;
    dlg.querySelector('[data-tour="next"]').textContent = T.step === STEPS.length - 1 ? 'Finish' : 'Next';
    place();
  }
  function start() {
    if (T.open) return;
    if (!dlg) build();
    from = document.activeElement; T.open = true; T.shown = true; go(0);
    dlg.showModal(); dlg.querySelector('[data-tour="next"]').focus();
  }
  function end() { if (dlg.open) dlg.close(); else finish(); }
  function finish() {
    if (!T.open) return;
    T.open = false;
    if (N.user && !N.user.tourSeen) { N.user.tourSeen = true; N.api('PATCH', '/api/profile', { tour: 'done' }).catch(function () { /* it will simply show once more */ }); }
    var back = from && document.contains(from) ? from : $('#main'); from = null;
    if (back && back.focus) back.focus({ preventScroll: true });
  }
  T.start = start;

  // the first time this account reaches the dashboard
  document.addEventListener('jarvis:rendered', function (e) {
    if (T.shown || !e.detail || e.detail.view !== 'dashboard' || !N.user || N.user.tourSeen || !(N.session && N.session.tour)) return;
    T.shown = true;
    setTimeout(function () { if (J.current() === 'dashboard' && !document.querySelector('dialog[open]')) { T.shown = false; start(); } else T.shown = false; }, 700);
  });
  J.actions.tourStart = function () { if (J.current() !== 'dashboard') { location.hash = 'dashboard'; setTimeout(start, 500); } else start(); };
})();

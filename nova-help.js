/* NOVA Help: how to start, what each page is for, the most common problems with a fix each, and "Check my setup".
   "Check my setup" only reads (GET /api/check): it changes nothing. */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc, $ = J.$, S = J.screens;
  var H = N.help = { result: null, busy: false, error: '' };

  var PAGES = [['Dashboard', 'Your day at a glance, with the Promise Orbit of things you owe.'], ['Daily Briefing', 'What is overdue, due today and waiting for you.'], ['NOVA Chat', 'Ask NOVA to do things. Every change shows a preview and waits for your approval.'], ['Voice Assistant', 'Talk to NOVA. Risky changes still need a button press.'],
    ['Smart Email', 'Gmail sorted by what matters (read-only), or demo e-mail.'], ['Tasks and Calendar', 'Your tasks, notes and calendar.'], ['Focus and Planner', 'A plan for the day and a focus timer.'], ['Life Tracker', 'Habits, spending and reminders.'], ['ProofLoop', 'Promises you made or were made to you, with proof they were kept, and how reliable people have been.'], ['What if I say yes?', 'Type something you might agree to and see what it would do to that day, without changing anything.'],
    ['Weekly Insights', 'How your week went, with the Life Radar.'], ['Decision Journal', 'Write down a decision and what you expect; on the date NOVA asks how it turned out and keeps an honest record.'], ['Weekly Review', 'Your last full week from your own data: what you finished, promises, focus, habits, spending, what slipped and three priorities for next week.'], ['Day Replay', 'What NOVA did on any day, in order.'], ['Automation Centre', 'The jobs NOVA runs by itself, and when.'], ['Personal Identity', 'What NOVA knows about you.'], ['Memory Vault', 'Everything NOVA remembers. You can correct or delete any of it.'],
    ['Knowledge Base', 'Your own documents, searchable. Ask a question and see the source.'], ['AI Usage and Cost', 'How much the AI was used. The free setup costs nothing.'], ['Connected Apps', 'Gmail, calendars and the AI model.'], ['Security and Settings', 'Themes, devices, your data and the activity log.']];

  var PROBLEMS = [
    ['NOVA says the port is already in use', 'NOVA is probably already running in another window. Close the old window (or press Ctrl+C in it) and start NOVA again. If it still fails, restart the computer, then start NOVA once.'],
    ['NOVA says Node.js is too old or missing', 'Go to nodejs.org, download the "LTS" version and install it. Then close the black window, open a new one and start NOVA again.'],
    ['Gmail will not connect', 'Gmail needs a one-time setup with Google. Follow "Connect Gmail: step by step" on this page or on the Smart Email page; it shows the exact addresses and a live checklist. It is optional: NOVA works with demo e-mail until then. NOVA only reads Gmail and can never send.'],
    ['Voice does not work in Firefox', 'Firefox cannot listen to speech. Use Chrome or Edge to talk to NOVA, or type in NOVA Chat. NOVA can still read answers aloud in Firefox.'],
    ['I forgot which e-mail I used to sign in', 'On your own computer, the demo uses demo@nova.local. If you signed in with your own address, it is shown in Connected Apps ("Signed in as") once you are in. Each address has its own separate data.']];

  function steps() {
    return '<article class="panel"><h2>How to start NOVA</h2><ol class="hp-steps"><li>Install <b>Node.js</b> (the "LTS" version) from nodejs.org. You only do this once.</li>' +
      '<li>Unzip the NOVA folder, then double-click <b>Start NOVA demo.bat</b> on Windows or <b>Start NOVA demo.command</b> on a Mac.</li>' +
      '<li>Your browser opens NOVA. If it does not, open <b>http://127.0.0.1:8788</b> yourself.</li>' +
      '<li>Sign in with <b>demo@nova.local</b>. Keep the black window open while you use NOVA; close it to stop.</li></ol></article>';
  }
  function pages() {
    return '<article class="panel"><h2>What each page is for</h2><dl class="hp-pages">' + PAGES.map(function (p) { return '<dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd>'; }).join('') + '</dl></article>';
  }
  function problems() {
    return '<article class="panel"><h2>Common problems</h2>' + PROBLEMS.map(function (p) { return '<details class="hp-prob"><summary>' + esc(p[0]) + '</summary><p>' + esc(p[1]) + '</p></details>'; }).join('') + '</article>';
  }
  var LABEL = { ok: 'OK', attention: 'Needs attention', not_set_up: 'Not set up' }, TONE = { ok: 'ok', attention: 'warn', not_set_up: 'dim' };
  function check() {
    var body;
    if (H.busy) body = J.empty('Loading…');
    else if (H.error) body = '<div class="load-error" role="alert"><b>The check could not run</b><p>' + esc(H.error) + '</p></div>';
    else if (!H.result) body = '<p class="small-text muted">Press the button to see if everything NOVA needs is working. It only looks; it changes nothing.</p>';
    else body = '<p class="hp-summary" role="status">' + esc(H.result.summary) + '</p><ul class="sources hp-checks">' + H.result.checks.map(function (c) {
      return '<li><span class="grow"><b>' + esc(c.name) + '</b><br><span class="small-text">' + esc(c.message) + '</span>' +
        (c.next ? '<br><span class="small-text"><b>What to do:</b> ' + esc(c.next) + '</span>' : '') + (c.why ? '<br><span class="small-text muted">' + esc(c.why) + '</span>' : '') + '</span>' + J.tag(LABEL[c.status], TONE[c.status]) + '</li>';
    }).join('') + '</ul>';
    return '<article class="panel" id="hpCheck"><h2>Check my setup</h2><p><button type="button" class="btn primary" data-act="hpCheck"' + (H.busy ? ' disabled' : '') + '>' + (H.result ? 'Check again' : 'Check my setup') + '</button></p>' + body + '</article>';
  }

  S.support = {
    render: function () {
      return J.head('System', 'Help', 'How to start, what each page does, and what to do when something is wrong.', '') + check() + steps() + (N.gmail ? N.gmail.guide(false) : '') + problems() + pages();
    }
  };
  J.actions.hpCheck = function () {
    if (H.busy) return;
    H.busy = true; H.error = ''; J.render(false);
    N.api('GET', '/api/check').then(function (r) { H.result = r; }).catch(function (e) { H.error = e.message; }).then(function () {
      H.busy = false; J.render(false);
      var b = $('button[data-act="hpCheck"]'); if (b) b.focus({ preventScroll: true });
    });
  };
})();

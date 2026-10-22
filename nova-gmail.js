/* NOVA Gmail setup guide: exact addresses for this server, a live checklist (only "set / not set", never a secret), numbered steps with Copy buttons,
   "Test connection" (reads the newest 5 headers, stores nothing) and plain answers to the usual problems. Shown on Smart Email and on Help. */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc, $ = J.$;
  var G = N.gmail = { setup: null, loading: false, failed: false, test: null, testing: false, open: null };

  G.load = function () {
    if (G.setup) return Promise.resolve(G.setup);
    if (G.loading) return G.pending;
    G.loading = true;
    G.pending = N.api('GET', '/api/gmail/setup').then(function (r) { G.setup = r; G.loading = false; return r; }).catch(function () { G.loading = false; G.failed = true; return null; });
    return G.pending;
  };
  G.message = function (reason) { var m = G.setup && G.setup.messages && G.setup.messages[reason]; return m || 'Gmail: something went wrong. Open "Connect Gmail: step by step" below.'; };

  var LINK = function (href, text) { return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + text + '</a>'; };
  function uriRow(label, uri, id) {
    return '<li class="gm-uri"><span class="gm-uri-label">' + esc(label) + '</span><code>' + esc(uri) + '</code><button type="button" class="btn small" data-act="gmCopy" data-id="' + id + '" aria-label="Copy the ' + esc(label.toLowerCase()) + '">Copy</button></li>';
  }
  function checks(s) {
    var T = { ok: ['OK', 'ok'], todo: ['To do', 'warn'], manual: ['Check yourself', 'dim'] };
    return '<ul class="gm-checks" aria-label="Live checklist">' + s.checks.map(function (c) {
      return '<li><span class="gm-check-main"><b>' + esc(c.label) + '</b>' + (c.state === 'ok' ? '' : '<br><span class="small-text">' + esc(c.fix) + '</span>') + '</span>' + J.tag(T[c.state][0], T[c.state][1]) + '</li>';
    }).join('') + '</ul>';
  }
  function steps(s) {
    var u = s.redirectUris;
    return '<ol class="gm-steps">' +
      '<li><b>Create a Google Cloud project.</b> Open ' + LINK('https://console.cloud.google.com/projectcreate', 'console.cloud.google.com/projectcreate') + ', sign in with your Gmail, name it "NOVA" and press Create. No card is needed.</li>' +
      '<li><b>Enable the Gmail API.</b> Open APIs &amp; Services, then Library, search for "Gmail API" and press Enable.</li>' +
      '<li><b>Set up the consent screen.</b> Open APIs &amp; Services, then OAuth consent screen (Google Auth Platform). Choose <b>External</b>, enter the app name NOVA and your e-mail, and leave it in <b>Testing</b> mode. Under <b>Test users</b> add your own Gmail address.</li>' +
      '<li><b>Create the OAuth client.</b> Open Credentials, Create credentials, OAuth client ID, type <b>Web application</b>. Under Authorised redirect URIs add both addresses below, exactly as written, then press Create.' +
        '<ul class="gm-uris">' + uriRow('Gmail redirect address', u.gmail, 'gmail') + uriRow('Sign-in redirect address (only if you also use Google sign-in)', u.signIn, 'signIn') + '</ul></li>' +
      '<li><b>Make a secret key.</b> Run this once and keep the result in a password manager (losing it means connecting Gmail again):<div class="gm-cmd"><code>' + esc(s.keyCommand) + '</code> <button type="button" class="btn small" data-act="gmCopy" data-id="key" aria-label="Copy the command">Copy</button></div></li>' +
      '<li><b>Start NOVA with the settings.</b> Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and NOVA_SECRET_KEY (the first two come from the OAuth client you just made), then restart NOVA. The checklist above turns green. Never put these values in a file that is shared.</li>' +
      '<li><b>Press Connect Gmail.</b> At Google, if you see "Google hasn\'t verified this app", choose <b>Advanced</b>, then <b>Continue</b>: it is your own app. Keep "view your email messages" ticked. NOVA gets read-only access and can never send.</li></ol>';
  }
  function problems(s) {
    return '<h2>If something goes wrong</h2>' + s.problems.map(function (p) { return '<details class="gm-prob"><summary>' + esc(p.title) + '</summary><p>' + esc(p.cause) + '</p><p><b>What to do:</b> ' + esc(p.fix) + '</p></details>'; }).join('');
  }
  function testBox(connected) {
    if (!connected) return '';
    var r = G.test;
    return '<div class="gm-test"><button type="button" class="btn" data-act="gmTest"' + (G.testing ? ' disabled' : '') + '>' + (G.testing ? 'Testing…' : 'Test connection') + '</button> <span class="small-text muted">Reads the headers of your newest 5 messages and keeps nothing.</span>' +
      (r ? '<p class="gm-result ' + (r.ok ? 'ok' : 'bad') + '" role="status"><b>' + (r.ok ? 'Passed. ' : 'Did not pass. ') + '</b>' + esc(r.message) + '</p>' : '<p class="sr-only" role="status"></p>') + '</div>';
  }

  // connected: whether Gmail is connected (the guide folds away then, but stays available)
  G.guide = function (connected) {
    if (!N.user) return '';
    if (!G.setup) { if (!G.failed && !G.loading) G.load().then(function () { J.render(false); }); return '<article class="panel gm-guide"><h2>Connect Gmail: step by step</h2>' + (G.failed ? '<p class="small-text muted">The guide could not load. Try again in a moment.</p>' : '<p class="small-text muted">Loading…</p>') + '</article>'; }
    var s = G.setup, open = G.open === null ? !connected : G.open;
    return '<article class="panel gm-guide" id="gmGuide"><details' + (open ? ' open' : '') + ' data-gm="guide"><summary><b>Connect Gmail: step by step</b></summary>' +
      '<p class="small-text muted">Free, about ten minutes, no card. NOVA only ever asks for read-only access (gmail.readonly) and can never send, delete or change your mail.</p>' +
      '<h2>Live checklist</h2>' + checks(s) + steps(s) + problems(s) + '</details>' + testBox(connected) + '</article>';
  };

  // Remember a fold or unfold the person did themselves (the page opening it by itself is not remembered).
  document.addEventListener('click', function (e) { var sm = e.target.closest && e.target.closest('details[data-gm="guide"] > summary'); if (sm) G.open = !sm.parentNode.open; });

  function copy(text, label) {
    var done = function () { J.toast('Copied ' + label + '.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(function () { J.toast('Could not copy. Select the text and copy it yourself.'); });
    else J.toast('Could not copy. Select the text and copy it yourself.');
  }
  J.actions.gmCopy = function (id) {
    var s = G.setup; if (!s) return;
    if (id === 'key') copy(s.keyCommand, 'the command'); else copy(id === 'gmail' ? s.redirectUris.gmail : s.redirectUris.signIn, 'the address');
  };
  J.actions.gmTest = function () {
    if (G.testing) return; G.testing = true; G.test = null; J.render(false);
    N.api('POST', '/api/gmail/test', {}).then(function (r) { G.test = r; }).catch(function (e) { G.test = { ok: false, message: e.message }; }).then(function () {
      G.testing = false; J.render(false); var b = $('button[data-act="gmTest"]'); if (b) b.focus({ preventScroll: true });
    });
  };
})();

/* First-run setup page (served only by `npm start` before NOVA is configured). */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  fetch('/setup/status').then(function (r) { return r.json(); }).then(function (s) {
    $('#checks').innerHTML = s.checks.map(function (c) { return '<li class="' + (c.ok ? 'ok' : 'bad') + '"><b>' + (c.ok ? '✓ ' : '✗ ') + esc(c.name) + '</b> <small>' + esc(c.detail) + '</small></li>'; }).join('');
    if (s.envExists) err('A .env file already exists. Edit it and restart NOVA instead.');
  }).catch(function () { $('#checks').innerHTML = '<li class="bad">Could not reach the setup server.</li>'; });
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function err(m) { var e = $('#err'); e.textContent = m; e.hidden = !m; }
  $('#setupForm').addEventListener('submit', function (ev) {
    ev.preventDefault(); err('');
    var f = ev.target, body = { token: f.token.value.trim(), email: f.email.value.trim(), ai: f.querySelector('input[name="ai"]:checked').value, ntfy: f.ntfy.checked };
    if (!body.token) { err('Paste the setup code from the terminal.'); f.token.focus(); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) { err('Enter a valid e-mail address.'); f.email.focus(); return; }
    f.querySelector('button').disabled = true;
    fetch('/setup/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error && j.error.message || 'Setup failed.'); return j; }); })
      .then(function (j) {
        f.hidden = true; $('#doneBox').hidden = false;
        $('#doneText').textContent = 'Saved. Sign in with ' + j.email + ' on the next page (development sign-in on this computer). ' + (body.ai === 'ollama' ? 'Remember to run: ollama pull qwen2.5:7b' : '');
        if (j.ntfyTopic) { $('#ntfyBox').hidden = false; $('#ntfyTopic').textContent = j.ntfyTopic; }
        var tries = 0; (function wait() { fetch('/api/session').then(function (r) { return r.json(); }).then(function (s) { if (s && !s.setup) location.href = '/'; else if (++tries < 40) setTimeout(wait, 500); }).catch(function () { if (++tries < 40) setTimeout(wait, 500); }); })();
      })
      .catch(function (e) { err(e.message); f.querySelector('button').disabled = false; });
  });
})();

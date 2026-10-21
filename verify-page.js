/* The public receipt check page. It sends the pasted text to POST /api/verify and shows one of a few fixed answers. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  function err(m) { var e = $('#err'); e.textContent = m; e.hidden = !m; }
  function show(verdict, message) {
    var box = $('#result'); box.hidden = false; box.className = 'result ' + (verdict === 'matches' ? 'ok' : 'bad');
    $('#verdict').textContent = verdict === 'matches' ? '✓ Matches' : '✗ Does not match'; $('#message').textContent = message; box.focus();
  }
  var f = /[?&]f=([0-9a-fA-F]{64})(?:&|$)/.exec(location.search);                      // from a receipt's QR code: fill it in and check at once
  $('#verifyForm').addEventListener('submit', function (ev) {
    ev.preventDefault(); err(''); $('#result').hidden = true;
    var text = $('#receipt').value;
    if (!text.trim()) { err('Paste a receipt or a fingerprint first.'); $('#receipt').focus(); return; }
    var b = $('#check'); b.disabled = true;
    fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j, retry: r.headers.get('Retry-After') }; }); })
      .then(function (r) {
        if (r.ok) { show(r.j.verdict, r.j.message); return; }
        if (r.status === 429) err('Too many checks. Wait ' + (r.retry || '30') + ' seconds, then try again.');
        else if (r.status === 413) err('That is too long to be a receipt.');
        else err('The check could not run (' + r.status + '). Nothing was changed. Try again in a moment.');
      })
      .catch(function () { err('NOVA could not be reached. Check your connection, then try again.'); })
      .then(function () { b.disabled = false; });
  });
  if (f) { $('#receipt').value = f[1].toLowerCase(); $('#verifyForm').requestSubmit(); }
})();

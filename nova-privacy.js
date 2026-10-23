/* NOVA "What NOVA knows about me": real counts of what is stored, connected accounts and what each may do, what is encrypted, what NOVA never does,
   export, and deleting ONE kind of data with a preview, a typed word and an approval. Deleting cannot be undone: the page says so. */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc, $ = J.$, S = J.screens;
  var P = N.privacy = { del: null, busy: false, error: '', done: '' };

  function when(ms) { return ms && J.longDate ? J.longDate(new Date(ms + 4 * 3600e3).toISOString().slice(0, 10)) : '—'; }
  function panel(id, title, body) { return '<article class="panel pv-sec" aria-labelledby="pv-' + id + '"><h2 class="label" id="pv-' + id + '">' + esc(title) + '</h2>' + body + '</article>'; }
  function delPanel() {
    var d = P.del; if (!d) return '';
    return '<article class="panel pv-del" id="pvDel" aria-labelledby="pvDelH"><h2 class="label" id="pvDelH" tabindex="-1">Check this before you delete</h2>' +
      '<p class="tag red">Cannot be undone</p><ul class="plain">' + d.changes.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' +
      '<p class="small-text"><b>Not touched:</b> ' + esc(d.notTouched.join(' ')) + '</p><p class="small-text"><b>Kept on purpose:</b> ' + esc(d.kept.join(' ')) + '</p><p class="small-text">' + esc(d.warning) + '</p>' +
      '<form id="pvForm" data-pv="form"><div class="field"><label for="pvWord">Type ' + esc(d.confirmWord) + ' to confirm</label><input id="pvWord" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="10"></div>' +
      (P.error ? '<p class="load-error" role="alert">' + esc(P.error) + '</p>' : '') + '<div class="btn-row"><button type="submit" class="btn danger"' + (P.busy ? ' disabled' : '') + '>Approve and delete</button><button type="button" class="btn" data-act="pvCancel">Cancel, keep everything</button></div></form></article>';
  }
  function body(d) {
    var counts = '<ul class="trust-people">' + d.counts.map(function (c) {
      return '<li class="pv-row"><div class="pv-main"><b>' + esc(c.label) + '</b><span class="small-text">' + c.count + (c.extra !== undefined ? ' · ' + c.extra + ' ' + esc(c.extraLabel) : '') + (c.note ? ' · ' + esc(c.note) : '') + '</span></div>' +
        '<button type="button" class="btn small ghost" data-act="pvDelete" data-id="' + c.id + '"' + (c.count || c.extra ? '' : ' disabled') + ' aria-label="Delete ' + esc(c.label.toLowerCase()) + '">Delete…</button></li>';
    }).join('') + '</ul>';
    var acc = d.accounts.length ? '<ul class="trust-people">' + d.accounts.map(function (a) {
      return '<li><b>' + esc(a.provider) + ': ' + esc(a.account || 'account') + '</b><span class="small-text">' + esc(a.permission) + '</span><span class="small-text muted">Connected ' + esc(when(a.since)) + ' · last read ' + esc(a.lastRead ? when(a.lastRead) : 'never') + ' · ' + (a.tokensEncrypted ? 'access is stored encrypted' : 'access is not stored') + '</span><span class="small-text muted">' + esc(a.manage) + '</span></li>';
    }).join('') + '</ul>' : '<p class="small-text muted">No accounts are connected.</p>';
    return (P.done ? '<p class="gmail-msg ok" role="status"><span>' + esc(P.done) + '</span></p>' : '') + delPanel() +
      panel('counts', 'What NOVA stores about you', '<p class="small-text muted">Real counts from your account, signed in as ' + esc(d.signedInAs) + '.</p>' + counts) +
      panel('accounts', 'Connected accounts', acc) +
      panel('enc', 'What is encrypted', '<ul class="plain">' + d.encrypted.map(function (e) { return '<li><b>' + esc(e.what) + ':</b> ' + esc(e.how) + '</li>'; }).join('') + d.notEncrypted.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul><p class="small-text">' + esc(d.ai.note) + '</p>') +
      panel('never', 'What NOVA never does', '<ul class="plain">' + d.never.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>') +
      panel('export', 'Take your data with you', '<p class="small-text muted">A copy of everything, to keep or to bring back later. Nothing is deleted by downloading.</p><div class="btn-row"><button type="button" class="btn" data-act="pvExport" data-id="json">Download everything (JSON)</button><button type="button" class="btn" data-act="pvExport" data-id="md">Download a readable copy (Markdown)</button></div>');
  }
  S.privacy = {
    render: function () {
      var d = N.cache.privacy, head = J.head('System', 'What NOVA knows about me', 'Exactly what is stored, which accounts are connected, what is protected, and how to take your data or delete one kind of it.', '');
      return head + (d ? body(d) : J.empty('Loading…'));
    },
    after: function () { N.h.stale('privacy', [['privacy', '/api/privacy']]); var h = $('#pvDelH'); if (h && P.focus) { P.focus = false; h.focus(); } }
  };
  function download(name, text, type) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  J.actions.pvExport = function (id) {
    var md = id === 'md';
    fetch('/api/export' + (md ? '?format=md' : ''), { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('The copy could not be made. Nothing was changed.'); return r.text(); })
      .then(function (t) { download(md ? 'nova-export.md' : 'nova-export.json', t, md ? 'text/markdown' : 'application/json'); J.toast('Downloaded your data.'); }).catch(function (e) { J.toast(e.message); });
  };
  J.actions.pvDelete = function (id) {
    P.error = ''; P.done = '';
    N.api('POST', '/api/privacy/delete/preview', { kind: id }).then(function (r) { P.del = r; P.focus = true; }).catch(function (e) { P.del = null; P.error = ''; J.toast(e.message); }).then(function () { J.render(false); });
  };
  J.actions.pvCancel = function () { var d = P.del; P.del = null; P.error = ''; if (d) N.api('POST', '/api/privacy/delete/cancel', { token: d.token }).catch(function () { /* it expires by itself */ }); J.render(false); };
  document.addEventListener('submit', function (e) {
    if (!e.target.getAttribute || e.target.getAttribute('data-pv') !== 'form') return;
    e.preventDefault(); if (P.busy || !P.del) return; P.busy = true; P.error = '';
    N.api('POST', '/api/privacy/delete/apply', { token: P.del.token, approve: true, confirm: ($('#pvWord') || {}).value || '' }).then(function (r) {
      P.done = r.message; P.del = null; Object.keys(N.cache).forEach(function (k) { if (['sessions', 'audit', 'tools'].indexOf(k) < 0) N.cache[k] = null; });
    }).catch(function (x) { P.error = x.message; }).then(function () { P.busy = false; J.render(false); var w = $('#pvWord') || $('main h1'); if (w && w.focus) w.focus(); });
  });
})();

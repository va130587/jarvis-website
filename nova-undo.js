/* NOVA Undo list: the last 20 changes NOVA made for you, shown under Day Replay and linked from the bell menu.
   Undo is never one click: it opens a preview (what changes, and "what happens if" facts) and runs only when you approve. */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc, $ = J.$;
  var U = N.undo = {};

  function row(i) {
    var right;
    if (i.state === 'can') right = '<button type="button" class="btn small" data-act="undoOpen" data-id="' + i.id + '" aria-label="Undo: ' + esc(i.action + (i.detail ? ' (' + i.detail + ')' : '')) + '">Undo</button>';
    else if (i.state === 'undone') right = J.tag('Undone', 'dim');
    else right = '<span class="small-text muted un-reason">' + esc(i.reason) + '</span>';
    return '<li class="un-row s-' + i.state + '"><div class="un-what"><b>' + esc(i.action) + '</b>' + (i.detail ? '<br><span class="small-text muted">' + esc(i.detail) + '</span>' : '') + '<br><span class="small-text muted mono">' + esc(N.h.when(i.at)) + '</span></div><div class="un-act">' + right + '</div></li>';
  }
  U.panel = function () {
    var r = N.cache.undo;
    return '<article class="panel" id="undoPanel"><h2 class="label">Changes NOVA made for you</h2><p class="small-text muted">Your last 20 changes. Undo shows you what would change and asks for your approval first.</p>' +
      (!r ? J.empty('Loading…') : r.items.length ? '<ul class="un-list">' + r.items.map(row).join('') + '</ul>' : '<p class="empty">NOVA has not changed anything for you yet.</p>') + '</article>';
  };
  U.count = function () { return N.cache.undo ? N.cache.undo.canUndo : null; };

  function refresh() {
    return N.h.load('undo', '/api/undo').then(function () { Object.keys(N.cache).forEach(function (k) { if (['undo', 'sessions', 'audit', 'tools'].indexOf(k) < 0 && !/^replay-/.test(k)) N.cache[k] = null; }); J.render(false); });
  }
  function previewHTML(p) {
    return '<p><b>' + esc(p.detail || p.action) + '</b></p><dl class="preview-dl"><dt>What changes</dt><dd>' + p.changes.map(esc).join('<br>') + '</dd>' +
      '<dt>What happens if</dt><dd>' + (p.effects === null ? 'NOVA could not check what else this touches. You can still undo it.' : p.effects.length ? '<ul class="fx-list">' + p.effects.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : 'Nothing else is affected.') + '</dd>' +
      '<dt>Afterwards</dt><dd>' + esc(p.consequences) + '</dd></dl>';
  }
  J.actions.undoOpen = function (id, el) {
    N.api('POST', '/api/undo/' + id + '/preview', {}).then(function (p) {
      J.openForm({ title: p.action, submit: 'Approve undo', fields: [{ type: 'html', html: previewHTML(p) }], noFocus: false,
        onSave: function () {
          N.api('POST', '/api/undo/' + id + '/apply', { token: p.token, approve: true }).then(function (r) { J.toast(r.message || 'Undone.'); return refresh(); }).catch(function (e) { J.toast(e.message); refresh(); });
        } });
    }).catch(function (e) { J.toast(e.message); refresh(); });
  };
})();

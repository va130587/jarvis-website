/* NOVA data portability (Security and Settings): a readable copy of your data, and "Import a NOVA export".
   Import is always preview first, then your approval; nothing is written before you press Approve (server enforced). */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc, $ = J.$;
  var D = N.data = { phase: 'idle', name: '', preview: null, result: null, error: '' };
  var MAX = 6 * 1024 * 1024;

  function sectionRows(p) {
    return '<div class="table-wrap" tabindex="0" role="region" aria-label="What would be imported (scrolls sideways on small screens)"><table class="cmds imp-table"><thead><tr><th scope="col">Kind</th><th scope="col">New</th><th scope="col">Already there</th><th scope="col">Left out</th></tr></thead><tbody>' +
      p.sections.filter(function (s) { return s.found; }).map(function (s) { return '<tr><th scope="row">' + esc(s.label) + '</th><td>' + s.add + '</td><td>' + s.have + '</td><td>' + s.refused + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function inner() {
    var h = '';
    if (D.phase === 'idle') h = '<p class="small-text muted">Bring back a file you downloaded with "Download everything (JSON)". You see what it contains first, and nothing changes until you approve.</p>';
    else if (D.phase === 'checking') h = J.empty('Loading…');
    else if (D.phase === 'error') h = '<div class="load-error" role="alert"><b>This file could not be imported</b><p>' + esc(D.error) + '</p></div>';
    else if (D.phase === 'preview') {
      var p = D.preview;
      h = '<div class="imp-preview" id="impPreview" tabindex="-1"><h3 class="imp-h">Ready to import: ' + esc(D.name) + '</h3>' + sectionRows(p) +
        (p.notes.length ? '<ul class="imp-notes">' + p.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') +
        (p.ignored.length ? '<p class="small-text muted">Not imported, by design: ' + esc(p.ignored.join(', ')) + '. Sessions, passwords and keys are never imported.</p>' : '') +
        (p.totalNew ? '<p class="imp-total"><b>' + p.totalNew + '</b> new ' + (p.totalNew === 1 ? 'item' : 'items') + ' will be added to your account.</p><div class="btn-row"><button type="button" class="btn primary" data-act="dataApprove">Approve import</button><button type="button" class="btn" data-act="dataCancel">Cancel</button></div>'
          : '<p class="imp-total">Nothing new to import. You already have everything in this file.</p><div class="btn-row"><button type="button" class="btn" data-act="dataCancel">Close</button></div>') + '</div>';
    } else if (D.phase === 'applying') h = J.empty('Loading…');
    else if (D.phase === 'done') h = '<div id="impDone" tabindex="-1"><p class="imp-total" role="status"><b>Imported ' + D.result.total + ' ' + (D.result.total === 1 ? 'item' : 'items') + '.</b> ' + esc(Object.keys(D.result.imported).filter(function (k) { return D.result.imported[k]; }).map(function (k) { return D.result.imported[k] + ' ' + k; }).join(', ')) + '</p><div class="btn-row"><button type="button" class="btn" data-act="dataCancel">Close</button></div></div>';
    return h;
  }
  function paint(focusSel) {
    var el = $('#importBody'); if (!el) return;
    el.innerHTML = inner();
    var f = focusSel && $(focusSel); if (f) f.focus({ preventScroll: false });
  }
  D.panel = function () {
    return '<article class="panel" id="importPanel"><h2 class="label">Take your data with you, or bring it back</h2>' +
      '<div class="btn-row"><button type="button" class="btn" data-act="dataMd">Download a readable copy (Markdown)</button><button type="button" class="btn" data-act="dataPick">Import a NOVA export</button></div>' +
      '<input type="file" id="importFile" class="sr-only" tabindex="-1" accept=".json,application/json" aria-label="Choose a NOVA export file (JSON)">' +
      '<div id="importBody" aria-live="polite">' + inner() + '</div></article>';
  };

  function fail(msg) { D.phase = 'error'; D.error = msg; paint('#importBody'); }
  function choose(file) {
    if (!file) return;
    D.name = file.name; D.preview = null; D.result = null;
    if (file.size > MAX) return fail('That file is too big to import (the limit is 6 MB).');
    D.phase = 'checking'; paint();
    file.text().then(function (txt) {
      var data; try { data = JSON.parse(txt); } catch (e) { return fail('That file cannot be read. Choose the .json file you downloaded from NOVA.'); }
      return N.api('POST', '/api/import/preview', { data: data }).then(function (p) { D.preview = p; D.phase = 'preview'; paint('#impPreview'); });
    }).catch(function (e) { fail(e && e.message ? e.message : 'That file could not be checked. Nothing was changed.'); });
  }
  document.addEventListener('change', function (e) { var t = e.target; if (t && t.id === 'importFile') { choose(t.files && t.files[0]); t.value = ''; } });

  function download(name, text, type) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  Object.assign(J.actions, {
    dataPick: function () { var f = $('#importFile'); if (f) f.click(); },
    dataMd: function () {
      fetch('/api/export?format=md', { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('The readable copy could not be made. Nothing was changed.'); return r.text(); })
        .then(function (t) { download('nova-export.md', t, 'text/markdown'); J.toast('Readable copy downloaded.'); }).catch(function (e) { J.toast(e.message); });
    },
    dataApprove: function () {
      if (D.phase !== 'preview' || !D.preview) return;
      var id = D.preview.importId; D.phase = 'applying'; paint();
      N.api('POST', '/api/import/apply', { importId: id, approve: true }).then(function (r) {
        D.result = r; D.phase = 'done'; Object.keys(N.cache).forEach(function (k) { if (['sessions', 'audit', 'tools'].indexOf(k) < 0) N.cache[k] = null; });
        paint('#impDone');
      }).catch(function (e) { fail(e && e.message ? e.message : 'The import did not finish. Nothing was changed.'); });
    },
    dataCancel: function () {
      if (D.phase === 'preview' && D.preview) N.api('POST', '/api/import/cancel', { importId: D.preview.importId }).catch(function () { /* it expires by itself */ });
      D.phase = 'idle'; D.preview = null; D.result = null; paint(); var b = $('button[data-act="dataPick"]'); if (b) b.focus();
    }
  });
})();

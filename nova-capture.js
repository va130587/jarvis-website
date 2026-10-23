/* NOVA Quick capture: type or paste a messy sentence, review ONE combined preview, approve what you want.
   Nothing is added until you press "Approve selected". Each added item goes through the same approval path as everything else. */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J) return;
  var esc = J.esc, $ = J.$, $$ = J.$$;
  var C = N.capture = { phase: 'write', text: '', data: null, picked: {}, edits: {}, result: null, error: '', busy: false };
  var dlg, from;

  function dubaiLocal(ms) { return new Date(ms + 4 * 3600e3).toISOString().slice(0, 16); }
  function fromLocal(v) { var t = Date.parse(v + ':00+04:00'); return isNaN(t) ? null : t; }

  function fxHTML(fx) {
    if (fx === null) return '<p class="small-text muted">NOVA could not check what else this touches.</p>';
    return fx && fx.length ? '<ul class="fx-list small-text">' + fx.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '';
  }
  function editHTML(it) {
    var e = C.edits[it.key] || {}, v = function (f, d) { return e[f] !== undefined ? e[f] : d; }, id = 'cap-' + it.key + '-';
    var f = function (name, label, html) { return '<div class="field"><label for="' + id + name + '">' + label + '</label>' + html + '</div>'; };
    var inp = function (name, type, val, extra) { return '<input id="' + id + name + '" data-field="' + name + '" type="' + type + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + '>'; };
    var h = '';
    if (it.tool === 'tasks.create') h = f('title', 'Task', inp('title', 'text', v('title', it.input.title), ' maxlength="200"')) + f('due', 'Due date (optional)', inp('due', 'date', v('due', it.input.due || '')));
    else if (it.tool === 'notes.create') h = f('text', 'Note', '<textarea id="' + id + 'text" data-field="text" rows="3" maxlength="2000">' + esc(v('text', it.input.text)) + '</textarea>');
    else if (it.tool === 'reminders.create') h = f('text', 'Remind me to', inp('text', 'text', v('text', it.input.text), ' maxlength="200"')) + f('dueAt', 'When (Dubai time)', inp('dueAt', 'datetime-local', dubaiLocal(v('dueAt', it.input.dueAt))));
    else if (it.tool === 'expenses.add') h = f('fils', 'Amount (AED)', inp('fils', 'number', (v('fils', it.input.fils) / 100), ' min="0.01" step="0.01"')) +
      f('category', 'Category', '<select id="' + id + 'category" data-field="category">' + (C.data.categories || []).map(function (c) { var k = typeof c === 'string' ? c : c.id || c.key || c[0]; return '<option value="' + esc(k) + '"' + (k === v('category', it.input.category) ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select>') + f('note', 'What it was for', inp('note', 'text', v('note', it.input.note || ''), ' maxlength="120"'));
    else if (it.tool === 'commitments.create') h = f('title', 'What', inp('title', 'text', v('title', it.input.title), ' maxlength="200"')) + f('counterparty', 'Who', inp('counterparty', 'text', v('counterparty', it.input.counterparty || ''), ' maxlength="100"')) + f('deadline', 'Due date (optional)', inp('deadline', 'date', v('deadline', it.input.deadline || '')));
    return '<div class="cap-edit" data-edit="' + it.key + '" hidden>' + h + '<div class="btn-row"><button type="button" class="btn small primary" data-cap="editDone" data-key="' + it.key + '">Use these changes</button><button type="button" class="btn small ghost" data-cap="editCancel" data-key="' + it.key + '">Cancel</button></div></div>';
  }
  function rowHTML(it) {
    var on = C.picked[it.key];
    return '<li class="cap-row' + (it.confident ? '' : ' unsure') + '" data-row="' + it.key + '"><div class="cap-line"><label class="cap-pick"><input type="checkbox" data-cap="pick" data-key="' + it.key + '"' + (on ? ' checked' : '') + '><span class="tag cap-kind">' + esc(it.kind) + '</span> <span class="cap-text">' + esc(C.edits[it.key] ? '(edited) ' + it.label : it.label) + '</span></label>' +
      '<button type="button" class="btn small ghost" data-cap="edit" data-key="' + it.key + '" aria-label="Edit: ' + esc(it.label) + '">Edit</button></div>' +
      (it.reason ? '<p class="small-text cap-why">' + esc(it.reason) + '</p>' : '') + (it.headsUp ? '<p class="small-text cap-why"><b>Before you promise:</b> ' + esc(it.headsUp) + '</p>' : '') + (C.edits[it.key] ? '<p class="small-text muted">Edited: the facts below are for the original wording.</p>' : '') + fxHTML(it.effects) + editHTML(it) + '</li>';
  }
  function noRow(n) {
    return '<li class="cap-row unsure" data-row="' + n.key + '"><div class="cap-line"><label class="cap-pick"><input type="checkbox" data-cap="pick" data-key="' + n.key + '"' + (C.picked[n.key] ? ' checked' : '') + '><span class="tag dim cap-kind">Not understood</span> <span class="cap-text">' + esc(n.text) + '</span></label></div><p class="small-text cap-why">' + esc(n.reason) + ' Tick it to keep the text as a note.</p></li>';
  }
  function count() { return Object.keys(C.picked).filter(function (k) { return C.picked[k]; }).length; }

  function body() {
    if (C.phase === 'write') return '<div class="field"><label for="capText">What do you want to capture? Several things at once is fine.</label><textarea id="capText" rows="6" maxlength="2000" placeholder="call Sara tomorrow 3pm, AED 40 lunch, note: visa photos need a white background, I promised Sam the slides by Friday">' + esc(C.text) + '</textarea><p class="small-text muted">Separate things with commas, new lines or "and". Up to 2,000 characters and 20 things. Nothing is added until you approve it, and nothing is deleted or sent.</p></div>' +
      (C.error ? '<p class="load-error" role="alert">' + esc(C.error) + '</p>' : '') + '<div class="btn-row"><button type="button" class="btn primary" data-cap="review"' + (C.busy ? ' disabled' : '') + '>Review</button><button type="button" class="btn" data-cap="close">Cancel</button></div>';
    if (C.phase === 'review') {
      var d = C.data;
      return '<h3 class="cap-h" id="capHead" tabindex="-1">Review: ' + d.items.length + (d.items.length === 1 ? ' thing' : ' things') + ' found</h3><p class="small-text muted">Untick anything you do not want. Edit a row if NOVA misunderstood. Nothing is added until you press Approve.</p>' +
        '<ul class="cap-list">' + d.items.map(rowHTML).join('') + d.notUnderstood.map(noRow).join('') + '</ul>' + (d.overLimit ? '<p class="small-text cap-why">' + d.overLimit + ' more than the limit of ' + d.limit + ' were left out. Capture them in a second go.</p>' : '') +
        (C.error ? '<p class="load-error" role="alert">' + esc(C.error) + '</p>' : '') + '<div class="btn-row"><button type="button" class="btn primary" data-cap="approve"' + (!count() || C.busy ? ' disabled' : '') + '>Approve selected (' + count() + ')</button><button type="button" class="btn" data-cap="back">Back</button><button type="button" class="btn ghost" data-cap="close">Cancel</button></div>';
    }
    var r = C.result;
    return '<h3 class="cap-h" id="capHead" tabindex="-1" role="status">Added ' + r.added + ' of ' + r.total + '</h3><ul class="cap-list">' + r.results.map(function (x) { return '<li class="cap-row ' + (x.ok ? 'ok' : 'bad') + '"><span class="tag ' + (x.ok ? 'ok' : 'warn') + '">' + (x.ok ? 'Added' : 'Not added') + '</span> <span class="cap-text">' + esc(x.kind + ': ' + x.label) + '</span><p class="small-text muted">' + esc(x.message) + '</p></li>'; }).join('') + '</ul>' +
      '<p class="small-text muted">Each one is in the Undo list under <a href="#replay" data-cap="close">Day Replay</a>, where you can undo it.</p><div class="btn-row"><button type="button" class="btn primary" data-cap="close">Done</button><button type="button" class="btn" data-cap="again">Capture more</button></div>';
  }
  function build() {
    dlg = document.createElement('dialog'); dlg.id = 'captureDialog'; dlg.className = 'capture'; dlg.setAttribute('aria-labelledby', 'capTitle');
    dlg.innerHTML = '<div class="cap-card"><h2 id="capTitle">Quick capture</h2><div id="capBody" aria-live="polite"></div></div>';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', onClick); dlg.addEventListener('change', onChange);
    dlg.addEventListener('input', function (e) { if (e.target.id === 'capText') C.text = e.target.value; });
    dlg.addEventListener('keydown', function (e) { if (e.target.id === 'capText' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); review(); } });
    dlg.addEventListener('close', function () { if (C.data && C.phase === 'review') N.api('POST', '/api/capture/cancel', { captureId: C.data.captureId }).catch(function () { /* it expires by itself */ }); var b = from && document.contains(from) ? from : $('#main'); from = null; if (b && b.focus) b.focus({ preventScroll: true }); });
  }
  function paint(focus) { $('#capBody').innerHTML = body(); var f = focus && $(focus); if (f) f.focus(); }
  C.open = function (text) {
    if (!N.user) return;
    if (!dlg) build();
    from = document.activeElement; C.phase = 'write'; C.text = text || ''; C.data = null; C.picked = {}; C.edits = {}; C.result = null; C.error = ''; C.busy = false;
    paint(); if (!dlg.open) dlg.showModal(); $('#capText').focus(); if (text) review();
  };
  function review() {
    C.text = ($('#capText') || {}).value || C.text; if (C.busy) return; C.error = '';
    if (!C.text.trim()) { C.error = 'Type or paste what you want to capture.'; return paint('#capText'); }
    C.busy = true; paint();
    N.api('POST', '/api/capture/preview', { text: C.text }).then(function (d) {
      C.data = d; C.phase = 'review'; C.picked = {}; C.edits = {};
      d.items.forEach(function (it) { C.picked[it.key] = !!it.confident; }); d.notUnderstood.forEach(function (n) { C.picked[n.key] = false; });
      C.busy = false; paint('#capHead');
    }).catch(function (e) { C.busy = false; C.error = e.message; paint('#capText'); });
  }
  function approve() {
    if (C.busy || !count()) return; C.busy = true; C.error = ''; paint();
    var sel = Object.keys(C.picked).filter(function (k) { return C.picked[k]; });
    N.api('POST', '/api/capture/apply', { captureId: C.data.captureId, approve: true, select: sel, edits: C.edits }).then(function (r) {
      C.result = r; C.phase = 'done'; C.data = null; C.busy = false;
      Object.keys(N.cache).forEach(function (k) { if (['sessions', 'audit', 'tools'].indexOf(k) < 0) N.cache[k] = null; });
      paint('#capHead'); J.toast('Added ' + r.added + ' of ' + r.total + '.'); J.render(false);
    }).catch(function (e) { C.busy = false; C.error = e.message; C.phase = 'review'; paint(); });
  }
  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-cap]') : null; if (!b || b.tagName === 'INPUT') return;
    var a = b.getAttribute('data-cap'), k = b.getAttribute('data-key');
    if (a === 'close') { if (dlg.open) dlg.close(); }
    else if (a === 'review') review();
    else if (a === 'back') { C.phase = 'write'; if (C.data) N.api('POST', '/api/capture/cancel', { captureId: C.data.captureId }).catch(function () {}); C.data = null; paint('#capText'); }
    else if (a === 'approve') approve();
    else if (a === 'again') { C.phase = 'write'; C.text = ''; paint('#capText'); }
    else if (a === 'edit') { var box = $('[data-edit="' + k + '"]', dlg); if (box) { box.hidden = false; var f = box.querySelector('input, textarea, select'); if (f) f.focus(); } }
    else if (a === 'editCancel') { var bx = $('[data-edit="' + k + '"]', dlg); if (bx) bx.hidden = true; var eb = $('[data-cap="edit"][data-key="' + k + '"]', dlg); if (eb) eb.focus(); }
    else if (a === 'editDone') {
      var box2 = $('[data-edit="' + k + '"]', dlg), ed = {};
      $$('[data-field]', box2).forEach(function (f) { var n = f.getAttribute('data-field'), v = f.value; ed[n] = n === 'dueAt' ? fromLocal(v) : n === 'fils' ? Math.round(parseFloat(v) * 100) : v; });
      if (ed.fils !== undefined && !(ed.fils > 0)) { J.toast('Enter an amount above zero.'); return; }
      if (ed.dueAt === null) { J.toast('Choose a date and time.'); return; }
      C.edits[k] = ed; var it = C.data.items.filter(function (x) { return x.key === k; })[0]; it.label = labelOf(it, ed); paint(); var eb2 = $('[data-cap="edit"][data-key="' + k + '"]', dlg); if (eb2) eb2.focus();
    }
  }
  function labelOf(it, ed) { var i = Object.assign({}, it.input, ed); return it.tool === 'expenses.add' ? 'AED ' + (i.fils / 100) + (i.note ? ' on ' + i.note : '') : it.tool === 'reminders.create' ? i.text + ', ' + new Date(i.dueAt + 4 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : it.tool === 'commitments.create' ? i.title + (i.counterparty ? ' (' + i.counterparty + ')' : '') : it.tool === 'notes.create' ? i.text : i.title + (i.due ? ', due ' + i.due : ''); }
  function onChange(e) { var t = e.target; if (t && t.getAttribute && t.getAttribute('data-cap') === 'pick') { C.picked[t.getAttribute('data-key')] = t.checked; var ap = $('[data-cap="approve"]', dlg); if (ap) { ap.textContent = 'Approve selected (' + count() + ')'; ap.disabled = !count(); } } }

  function mountButton() {
    var host = $('.readouts'); if (!host || $('#capBtn')) return;
    host.insertAdjacentHTML('afterbegin', '<button type="button" class="chip cap-btn" id="capBtn" data-act="capOpen" aria-label="Quick capture" title="Quick capture: add several things at once"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span class="cap-label">Capture</span></button>');
  }
  J.actions.capOpen = function () { C.open(''); };
  document.addEventListener('jarvis:rendered', function () { if (N.user) mountButton(); });
})();

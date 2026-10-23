/* NOVA plus (server mode): the Knowledge Base page (answers from your own documents, with the source passage),
   the Ctrl+K command palette (search everything, jump anywhere, run quick actions) and installing NOVA as an app. */
(function () {
  'use strict';
  var J = window.J, N = window.NOVA; if (!J || !N) return;
  var esc = J.esc, $ = J.$, $$ = J.$$, S = J.screens;
  var api = function (m, p, b) { return N.api(m, p, b); };
  var fail = function (e) { J.toast(e && e.message ? e.message : 'Something went wrong.'); };
  var K = N.kb = { answer: null, results: null, q: '', open: null };
  // FTS snippets mark matches with [[ ]]; escape first, then turn the markers into <mark>.
  function marked(s) { return esc(s).replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>'); }

  /* ================= Knowledge Base ================= */
  function sourcesHTML(list) {
    return '<ol class="kb-sources">' + list.map(function (r) {
      return '<li id="src' + r.n + '"><p class="kb-src-head"><b>[' + r.n + '] ' + esc(r.title) + '</b>' + (r.heading ? ' · ' + esc(r.heading) : '') + ' · passage ' + r.seq + (r.isDemo ? ' ' + J.tag('Demo', 'gold') : '') +
        ' <button type="button" class="link-btn" data-act="kbOpenDoc" data-id="' + r.documentId + '">Open document</button></p><blockquote>' + marked(r.snippet) + '</blockquote><p class="small-text muted">Matched ' + esc(r.matched) + '.</p></li>';
    }).join('') + '</ol>';
  }
  S.knowledge = {
    render: function () {
      var d = N.cache.kb, a = K.answer;
      if (!d) return J.head('Knowledge', 'Knowledge Base', 'Loading…', '') + J.empty('Loading…');
      return J.head('Knowledge', 'Knowledge Base', 'Add your own notes and documents, then ask. NOVA answers only from them and shows the exact passage, so you can check every answer.', '') +
        '<div class="kb-grid"><div class="kb-main">' +
        '<article class="panel kb-ask"><form id="kbAskForm" class="chat-form" autocomplete="off"><label for="kbQ" class="sr-only">Ask your documents</label><input id="kbQ" type="search" maxlength="300" placeholder="Ask, for example: when should I renew my visa?" value="' + esc(K.q) + '"><button type="submit" class="btn primary">Ask</button></form>' +
          (a ? '<section class="kb-answer ' + (a.found ? '' : 'none') + '" aria-live="polite"><p class="tag ' + (a.found ? '' : 'gold') + '">' + (a.found ? 'Answer from your documents' : 'Not found') + '</p><p class="kb-answer-text">' + esc(a.answer) + (a.found ? ' <a href="#src1" class="cite">[1]</a>' : '') + '</p>' +
            (a.found ? '<h3 class="label">Sources</h3>' + sourcesHTML(a.sources) + '<p class="small-text muted">These are passages from your documents, not AI-generated text. Nothing outside your documents is used.</p>' : '') + '</section>' : '<p class="small-text muted">Tip: you can also say "what do my notes say about the interview" to NOVA by voice.</p>') +
        '</article>' +
        (K.open ? '<article class="panel kb-doc"><div class="panel-head"><h2 class="label">' + esc(K.open.document.title) + '</h2><button type="button" class="btn small ghost" data-act="kbCloseDoc">Close</button></div>' +
          K.open.passages.map(function (p) { return '<section class="kb-passage"><p class="mono small-text muted">Passage ' + p.n + (p.heading ? ' · ' + esc(p.heading) : '') + '</p><p>' + esc(p.text) + '</p></section>'; }).join('') + '</article>' : '') +
        '</div><aside class="kb-side">' +
        '<article class="panel"><h2 class="label">Add a document</h2><form id="kbAddForm" autocomplete="off"><div class="field"><label for="kbTitle">Title</label><input id="kbTitle" type="text" maxlength="140" required placeholder="Visa notes"></div>' +
          '<div class="field"><label for="kbText">Text (paste, or choose a file)</label><textarea id="kbText" rows="7" maxlength="200000" placeholder="Paste notes, a syllabus, instructions… Headings starting with # become sections."></textarea></div>' +
          '<div class="field"><label for="kbFile">Or a text file (.txt, .md, .csv, .html)</label><input id="kbFile" type="file" accept=".txt,.md,.markdown,.csv,.html,.htm,.json,text/plain,text/markdown,text/csv,text/html"></div>' +
          '<button type="submit" class="btn primary">Add to Knowledge Base</button></form></article>' +
        '<article class="panel"><div class="panel-head"><h2 class="label">Your documents <span class="n">' + d.documents.length + '</span></h2>' + (d.documents.some(function (x) { return x.isDemo; }) ? '<button type="button" class="btn small ghost" data-act="kbDemoOff">Remove samples</button>' : '<button type="button" class="btn small" data-act="kbDemoOn">Add sample documents</button>') + '</div>' +
          (d.documents.length ? '<ul class="kb-docs">' + d.documents.map(function (x) {
            return '<li><button type="button" class="link-btn" data-act="kbOpenDoc" data-id="' + x.id + '">' + esc(x.title) + '</button><small class="muted">' + x.chunks + ' passage' + (x.chunks === 1 ? '' : 's') + ' · ' + Math.max(1, Math.round(x.chars / 1000)) + 'k characters' + (x.isDemo ? ' · demo' : '') + '</small><button type="button" class="btn small ghost" data-act="kbDelete" data-id="' + x.id + '" aria-label="Delete ' + esc(x.title) + '">Delete</button></li>'; }).join('') + '</ul>'
            : '<p class="empty">No documents yet. Add one, or try the sample documents.</p>') + '</article></aside></div>';
    },
    after: function () {
      N.h.stale('knowledge', [['kb', '/api/kb']]);
      var f = $('#kbAskForm'); if (f) f.addEventListener('submit', function (e) { e.preventDefault(); askKb($('#kbQ').value); });
      var add = $('#kbAddForm');
      if (add) add.addEventListener('submit', function (e) {
        e.preventDefault();
        var title = $('#kbTitle').value.trim(), text = $('#kbText').value;
        if (!title) { J.toast('Give the document a title.'); $('#kbTitle').focus(); return; }
        if (!text.trim()) { J.toast('Paste some text or choose a file first.'); $('#kbText').focus(); return; }
        api('POST', '/api/kb', { title: title, text: text, kind: K.fileName ? 'file' : 'note', source: K.fileName || null }).then(function (r) { K.fileName = null; J.toast('Added "' + r.document.title + '" (' + r.document.chunks + ' passages). You can ask about it now.'); return N.h.load('kb', '/api/kb'); }).then(function () { J.render(false); }).catch(fail);
      });
      var file = $('#kbFile');
      if (file) file.addEventListener('change', function () {
        var fl = file.files && file.files[0]; if (!fl) return;
        if (fl.size > 400000) { J.toast('That file is too large (limit about 200,000 characters).'); file.value = ''; return; }
        fl.text().then(function (t) {
          if (/\.html?$/i.test(fl.name)) { var doc = new DOMParser().parseFromString(t, 'text/html'); t = (doc.body && doc.body.innerText) || doc.documentElement.textContent || ''; }   // parsed, never inserted into the page
          $('#kbText').value = t.slice(0, 200000); if (!$('#kbTitle').value) $('#kbTitle').value = fl.name.replace(/\.[^.]+$/, '').slice(0, 140); K.fileName = fl.name;
          J.toast('Loaded ' + fl.name + '. Check the title, then press Add.');
        }).catch(function () { J.toast('Could not read that file. Use a plain text file.'); });
      });
    }
  };
  function reloadKb() { return N.h.load('kb', '/api/kb').then(function () { J.render(false); }); }
  Object.assign(J.actions, {
    kbOpenDoc: function (id) { api('GET', '/api/kb/' + id).then(function (r) { K.open = r; J.render(false); var d = $('.kb-doc'); if (d) d.scrollIntoView({ block: 'start' }); }).catch(fail); },
    kbCloseDoc: function () { K.open = null; J.render(false); },
    kbDelete: function (id) {
      J.confirm('The document and its passages are removed from NOVA. This cannot be undone.', 'Delete', 'Delete this document?').then(function (ok) {
        if (!ok) return; api('DELETE', '/api/kb/' + id).then(function () { if (K.open && String(K.open.document.id) === String(id)) K.open = null; K.answer = null; J.toast('Document deleted.'); return reloadKb(); }).catch(fail);
      });
    },
    kbDemoOn: function () { api('POST', '/api/kb/demo', {}).then(function (r) { J.toast(r.added ? 'Added ' + r.added + ' sample documents (fictional). Try: when should I renew my visa?' : 'The samples are already there.'); return reloadKb(); }).catch(fail); },
    kbDemoOff: function () { api('POST', '/api/kb/demo/remove', {}).then(function (r) { K.answer = null; K.open = null; J.toast('Removed ' + r.removed + ' sample documents.'); return reloadKb(); }).catch(fail); }
  });
  function askKb(q) {
    q = String(q || '').trim(); K.q = q; if (q.length < 2) { J.toast('Type a question first.'); return; }
    api('POST', '/api/kb/ask', { question: q }).then(function (r) { K.answer = r; J.render(false); var t = $('.kb-answer'); if (t) t.scrollIntoView({ block: 'nearest' }); }).catch(fail);
  }

  /* ================= Command palette (Ctrl+K) ================= */
  var PAGES = [['dashboard', 'Dashboard'], ['briefing', 'Daily Briefing'], ['chat', 'NOVA Chat'], ['voice', 'Voice Assistant'], ['email', 'Smart Email'], ['hub', 'Tasks and Calendar'], ['focus', 'Focus and Planner'], ['life', 'Life Tracker'], ['weekreview', 'Weekly Review'], ['proofloop', 'ProofLoop'], ['whatif', 'What if I say yes?'], ['insights', 'Weekly Insights'], ['replay', 'Day Replay'], ['automation', 'Automation Centre'], ['identity', 'Personal Identity'], ['memory', 'Memory Vault'], ['knowledge', 'Knowledge Base'], ['usage', 'AI Usage and Cost'], ['connections', 'Connected Apps'], ['security', 'Security and Settings'], ['support', 'Help']];
  var ACTIONS = [
    { title: 'Capture several things at once…', sub: 'Quick capture', run: function (q) { if (N.capture) N.capture.open(q || ''); }, usesQuery: false },
    { title: 'Plan my day', sub: 'Focus and Planner', run: function () { location.hash = 'focus'; } },
    { title: 'Start a 25-minute focus session', sub: 'Focus and Planner', run: function () { if (N.focus) N.focus.start({ minutes: 25, title: 'Focus' }); location.hash = 'focus'; } },
    { title: 'How was my week?', sub: 'Weekly Insights', run: function () { location.hash = 'insights'; } },
    { title: 'What did NOVA do today?', sub: 'Day Replay', run: function () { location.hash = 'replay'; } },
    { title: 'Read my briefing aloud', sub: 'Daily Briefing', run: function () { location.hash = 'briefing'; setTimeout(function () { if (J.actions.dSpeakBrief) J.actions.dSpeakBrief(); }, 600); } },
    { title: 'Start listening (push to talk)', sub: 'Voice', run: function () { location.hash = 'voice'; setTimeout(function () { var b = $('#ptt'); if (b && !b.disabled) b.click(); }, 500); } },
    { title: 'Send a test notification', sub: 'Automation Centre', run: function () { if (J.actions.dTestNotif) J.actions.dTestNotif(); } },
    { title: 'Ask my documents…', sub: 'Knowledge Base', run: function (q) { location.hash = 'knowledge'; if (q) setTimeout(function () { askKb(q); }, 400); }, usesQuery: true },
    { title: 'Ask NOVA…', sub: 'NOVA Chat', run: function (q) { location.hash = 'chat'; setTimeout(function () { var m = $('#novaMsg'); if (m) { m.value = q || ''; m.focus(); } }, 400); }, usesQuery: true }
  ];
  var P = { el: null, items: [], sel: 0, t: 0, seq: 0 };
  function open() {
    if (!N.user) return;
    if (!P.el) {
      P.el = document.createElement('div'); P.el.id = 'novaPalette'; P.el.className = 'palette-wrap'; P.el.hidden = true;
      P.el.innerHTML = '<div class="palette" role="dialog" aria-modal="true" aria-label="Search and commands"><label for="palQ" class="sr-only">Search everything or type a command</label>' +
        '<input id="palQ" type="text" autocomplete="off" spellcheck="false" placeholder="Search tasks, notes, memories, e-mail, documents… or go to a page" role="combobox" aria-expanded="true" aria-controls="palList" aria-autocomplete="list">' +
        '<ul id="palList" role="listbox" aria-label="Results"></ul><p class="palette-foot mono"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close · <kbd>&gt;</kbd> ask NOVA</p></div>';
      document.body.appendChild(P.el);
      P.el.addEventListener('mousedown', function (e) { if (e.target === P.el) close(); });
      var q = $('#palQ');
      q.addEventListener('input', function () { clearTimeout(P.t); P.t = setTimeout(update, 120); });
      q.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (P.items.length) { P.sel = (P.sel + (e.key === 'ArrowDown' ? 1 : -1) + P.items.length) % P.items.length; paint(); } }
        else if (e.key === 'Enter') { e.preventDefault(); if (P.t) { clearTimeout(P.t); P.t = 0; update(); } choose(P.sel); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'Tab') e.preventDefault();          // focus stays in the dialog
      });
      $('#palList').addEventListener('click', function (e) { var li = e.target.closest('[data-i]'); if (li) choose(+li.getAttribute('data-i')); });
    }
    P.ret = document.activeElement; P.el.hidden = false; var inp = $('#palQ'); inp.value = ''; update(); inp.focus();
  }
  function close() { if (!P.el || P.el.hidden) return; P.el.hidden = true; if (P.ret && P.ret.focus) P.ret.focus(); }
  function local(q) {
    var l = q.toLowerCase(), out = [];
    var cap = /^capture\s*:\s*(.*)$/i.exec(q); if (cap) return [{ kind: 'Capture', title: 'Capture: ' + (cap[1].trim() || '…'), sub: 'Quick capture: you review it, and nothing is added until you approve', run: function () { if (N.capture) N.capture.open(cap[1].trim()); } }];
    if (q.charAt(0) === '>') return [{ kind: 'Ask NOVA', title: 'Ask NOVA: ' + (q.slice(1).trim() || '…'), sub: 'Sends it to NOVA Chat (changes still need your approval)', run: function () { sendToNova(q.slice(1).trim()); } }];
    PAGES.forEach(function (p) { if (!l || p[1].toLowerCase().indexOf(l) >= 0) out.push({ kind: 'Go to', title: p[1], sub: 'Page', run: function () { location.hash = p[0]; } }); });
    ACTIONS.forEach(function (a) { if (!l || a.title.toLowerCase().indexOf(l) >= 0 || (a.usesQuery && l.length > 2)) out.push({ kind: 'Action', title: a.usesQuery && l ? a.title.replace('…', ': "' + q + '"') : a.title, sub: a.sub, run: function () { a.run(a.usesQuery ? q : ''); } }); });
    return out;
  }
  function sendToNova(t) { if (!t) return; location.hash = 'chat'; setTimeout(function () { var m = $('#novaMsg'), f = $('#novaChatForm'); if (m && f) { m.value = t; f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); } }, 400); }
  var KIND = { task: 'Task', note: 'Note', memory: 'Memory', commitment: 'ProofLoop', email: 'E-mail', document: 'Document' };
  function update() {
    var q = $('#palQ').value.trim(), seq = ++P.seq;
    P.items = local(q); P.sel = 0; paint();
    if (q.length >= 2 && q.charAt(0) !== '>' && !/^capture\s*:/i.test(q)) api('GET', '/api/search?q=' + encodeURIComponent(q)).then(function (r) {
      if (seq !== P.seq) return;                                         // an older answer arrived late: ignore it
      var found = r.results.map(function (x) { return { kind: KIND[x.type] || x.type, title: x.title, sub: x.sub, run: function () { location.hash = x.link.replace(/^#/, ''); } }; });
      P.items = found.concat(P.items); paint(found.length);
    }).catch(function () { /* offline: page and action results still work */ });
  }
  function paint(nFound) {
    var ul = $('#palList'); if (!ul) return;
    ul.innerHTML = P.items.length ? P.items.slice(0, 40).map(function (it, i) {
      return '<li role="option" id="pal' + i + '" data-i="' + i + '" aria-selected="' + (i === P.sel) + '"' + (i === P.sel ? ' class="on"' : '') + '><span class="pk mono">' + esc(it.kind) + '</span><span class="pt">' + esc(it.title) + '<small>' + esc(it.sub || '') + '</small></span></li>';
    }).join('') : '<li class="pal-empty" role="option" aria-disabled="true">Nothing found. Start with &gt; to ask NOVA instead.</li>';
    $('#palQ').setAttribute('aria-activedescendant', P.items.length ? 'pal' + P.sel : '');
    var on = ul.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    if (nFound !== undefined) { var live = $('#palLive'); if (!live) { live = document.createElement('p'); live.id = 'palLive'; live.className = 'sr-only'; live.setAttribute('aria-live', 'polite'); P.el.appendChild(live); } live.textContent = nFound + ' matching item' + (nFound === 1 ? '' : 's'); }
  }
  function choose(i) { var it = P.items[i]; if (!it) return; close(); it.run(); }
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { if (N.user) { e.preventDefault(); P.el && !P.el.hidden ? close() : open(); } }
    else if (e.key === 'Escape' && P.el && !P.el.hidden) { e.preventDefault(); close(); }
  });
  N.palette = { open: open, close: close };
  function mountButton() {
    var host = $('.readouts'); if (!host || $('#palBtn')) return;
    host.insertAdjacentHTML('afterbegin', '<button type="button" class="chip pal-btn" id="palBtn" aria-keyshortcuts="Control+K Meta+K" title="Search and commands (Ctrl+K)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><span class="pal-label">Search</span> <kbd>Ctrl K</kbd></button>');
    $('#palBtn').addEventListener('click', open);
  }

  /* ================= install as an app (PWA) ================= */
  var installEvt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; if (J.current && J.current() === 'security') J.render(false); });
  N.install = {
    can: function () { return !!installEvt; },
    installed: function () { return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches; },
    prompt: function () { if (!installEvt) return Promise.resolve('unavailable'); var e = installEvt; installEvt = null; e.prompt(); return e.userChoice.then(function (c) { return c.outcome; }); }
  };
  J.actions.novaInstall = function () { N.install.prompt().then(function (o) { J.toast(o === 'accepted' ? 'NOVA is installed. Open it from your apps.' : o === 'dismissed' ? 'Not installed.' : 'Use your browser menu: "Install NOVA" or "Add to Home screen".'); J.render(false); }); };
  // The service worker caches the app's own files so NOVA opens fast and shows its shell offline. It never caches /api or /auth (your data).
  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https:|^http:\/\/(127\.0\.0\.1|localhost)/.test(location.href) || navigator.webdriver && !window.__allowSW) return;
    navigator.serviceWorker.register('sw.js').catch(function () { /* the app works without it */ });
  }

  var started = false;
  function start() { if (started || !N.user) return; started = true; mountButton(); registerSW(); }
  var prev = N.daily && N.daily.start;
  if (N.daily) N.daily.start = function () { if (prev) prev.apply(this, arguments); start(); };
  if (N.user) start();
})();

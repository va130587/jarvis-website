/* NOVA front end (server mode). When this page is served by the NOVA server it asks /api/session who is signed in, shows a sign-in screen if nobody is,
   and adds the NOVA pages: Dashboard, Chat, Memory Vault, Identity, Usage, Security and the labelled "Upcoming" pages. Every number and list comes from the server.
   When the page is served without the server (for example GitHub Pages) none of this runs and the classic Classic tools work exactly as before. */
(function () {
  'use strict';
  var J = window.J, esc = J.esc, $ = J.$, $$ = J.$$;
  var N = window.NOVA = { runs: {}, mode: 'unknown', user: null, csrf: '', session: null, state: 'idle', chat: { cid: null, msgs: [], busy: false, convs: [], draft: '', proposals: {} }, cache: {} };

  /* ================= orb: ten states, each set by a real event ================= */
  var STATES = {
    idle: 'Idle', listening: 'Listening', transcribing: 'Transcribing', understanding: 'Understanding the request', planning: 'Planning',
    executing: 'Executing a tool', waiting_approval: 'Waiting for your approval', speaking: 'Speaking', completed: 'Completed', error: 'Something went wrong'
  };
  var resetTimer = 0;
  N.setState = function (s, hold) {
    if (!STATES[s]) return;
    N.state = s;
    $$('.nova-orb').forEach(function (o) { o.setAttribute('data-state', s); o.setAttribute('aria-label', 'NOVA status: ' + STATES[s]); });
    var t = $('#novaStatusText'); if (t) t.textContent = 'NOVA: ' + STATES[s];
    document.body.setAttribute('data-nova', s);
    clearTimeout(resetTimer);
    if (s === 'completed' || (s === 'error' && !hold)) resetTimer = setTimeout(function () { if (N.state === s) N.setState(voiceState() || 'idle'); }, s === 'error' ? 4000 : 1800);
  };
  function voiceState() { var v = document.body.getAttribute('data-voice'); return v === 'listening' ? 'listening' : v === 'speaking' ? 'speaking' : v === 'thinking' ? 'understanding' : null; }
  function orb(size) { return '<div class="nova-orb ' + (size || '') + '" role="img" aria-label="NOVA status: ' + esc(STATES[N.state]) + '" data-state="' + N.state + '"><i class="o-glow"></i><i class="o-ring r1"></i><i class="o-ring r2"></i><i class="o-ring r3"></i><i class="o-core"></i></div>'; }

  /* ================= API ================= */
  function api(method, path, body) {
    var o = { method: method, credentials: 'same-origin', headers: {} };
    if (N.csrf) o.headers['X-NOVA-CSRF'] = N.csrf;
    if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    return fetch(path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        if (r.status === 401 && N.user) { N.user = null; showLogin('Your session ended. Please sign in again.'); }
        var e = new Error((j.error && j.error.message) || 'Request failed (' + r.status + ').'); e.status = r.status; e.code = j.error && j.error.code; throw e;
      });
    });
  }
  N.api = api;
  function fail(e) { J.toast(e && e.message ? e.message : 'Something went wrong.'); }
  function when(ms) { return ms ? new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never'; }
  function ago(ms) { var s = Math.max(0, (Date.now() - ms) / 1000); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; }

  /* ================= sign-in screen ================= */
  var REASONS = { denied: 'Sign-in was cancelled.', invalid: 'Google\'s answer could not be verified, so nobody was signed in.', expired: 'That sign-in link expired. Please start again.', exchange: 'Google refused the sign-in. Check the server\'s Google settings.',
    network: 'The server could not reach Google. Check the internet connection.', not_allowed: 'That Google account is not on this NOVA server\'s allow-list (OWNER_EMAILS).' };
  function showLogin(msg) {
    var s = N.session || {}, el = $('#novaLogin');
    if (!el) { el = document.createElement('div'); el.id = 'novaLogin'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'novaLoginTitle'); document.body.appendChild(el); }
    var q = new URLSearchParams(location.search), why = msg || (q.get('signin') === 'failed' ? (REASONS[q.get('reason')] || 'Sign-in failed.') : '');
    el.innerHTML = '<div class="login-card">' + orb('big') +
      '<p class="eyebrow">Personal AI assistant</p><h1 id="novaLoginTitle">NOVA</h1><p class="lead">From Request to Verified Result</p>' +
      '<p class="small-text muted">NOVA recognises its owner from a signed-in account, not from a name typed in a box. Your memories and chats are stored in this server\'s private database, never in the public repository.</p>' +
      (why ? '<p class="login-msg" role="alert">' + esc(why) + '</p>' : '') +
      (s.googleConfigured ? '<a class="btn primary" href="/auth/google/start">Sign in with Google</a>' : (s.devLogin ? '' : '<p class="login-msg">Google sign-in is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see the README).</p>')) +
      (s.devLogin ? '<form id="novaDevForm" class="dev-login" autocomplete="off"><p class="tag gold">Development sign-in: this computer only</p><label for="novaDevEmail">E-mail (must be on the allow-list)</label><input id="novaDevEmail" type="email" required placeholder="you@example.com"><button type="submit" class="btn primary">Sign in (development)</button></form>' : '') +
      '</div>';
    document.body.classList.add('nova-locked');
    N.setState('idle');
    var f = $('#novaDevForm');
    if (f) f.addEventListener('submit', function (e) {
      e.preventDefault();
      fetch('/auth/dev-login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('#novaDevEmail').value }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j.error && j.error.message) || 'Sign-in failed.'); location.reload(); }); })
        .catch(function (err) { showLogin(err.message); });
    });
    var first = $('#novaDevEmail') || $('#novaLogin a, #novaLogin button'); if (first) first.focus();
  }
  function hideLogin() { var el = $('#novaLogin'); if (el) el.remove(); document.body.classList.remove('nova-locked'); }

  /* ================= navigation ================= */
  var IC = {
    dash: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="5" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="11" width="7" height="9" rx="1"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>', mic: J.ICON ? J.ICON.mic : '', mail: '<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="m4 8 8 6 8-6"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>', loop: '<path d="M5 12a7 7 0 0 1 12-5l2-2v6h-6l2.2-2.2A4.5 4.5 0 0 0 7.5 12M19 12a7 7 0 0 1-12 5l-2 2v-6h6l-2.2 2.2A4.5 4.5 0 0 0 16.5 12"/>',
    auto: '<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>', id: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>', mem: '<path d="M12 3c-4 0-7 2-7 5v8c0 3 3 5 7 5s7-2 7-5V8c0-3-3-5-7-5z"/><path d="M5 8c0 3 3 5 7 5s7-2 7-5M5 14c0 3 3 5 7 5s7-2 7-5"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>', cost: '<path d="M4 19h16"/><path d="M7 16V9M12 16V5M17 16v-4"/>', plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', tool: '<circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.4"/>'
  };
  var NOVA_NAV = [['dashboard', 'Dashboard', 'dash'], ['chat', 'NOVA Chat', 'chat'], ['voice', 'Voice Assistant', 'mic'], ['email', 'Smart Email', 'mail', 'Upcoming'], ['hub', 'Tasks and Calendar', 'cal'], ['proofloop', 'ProofLoop', 'loop', 'Upcoming'],
    ['automation', 'Automation Centre', 'auto', 'Upcoming'], ['identity', 'Personal Identity', 'id'], ['memory', 'Memory Vault', 'mem'], ['knowledge', 'Knowledge Base', 'book', 'Upcoming'], ['usage', 'AI Usage and Cost', 'cost'], ['connections', 'Connected Apps', 'plug'], ['security', 'Security and Settings', 'lock']];
  var TOOLS_NAV = [['today', 'Today', 'tool'], ['tasks', 'Tasks', 'tool'], ['calendar', 'Calendar', 'cal'], ['notes', 'Notes', 'book'], ['matches', 'Jobs for you', 'tool'], ['jobs', 'Job finder', 'tool'], ['applications', 'Applications', 'tool'], ['growth', 'Growth', 'cost'], ['review', 'Weekly review', 'cost'], ['profile', 'Job profile', 'id'], ['settings', 'Tool settings', 'tool'], ['help', 'Voice commands', 'mic']];
  function link(v, label, ic, badge) { return '<a href="#' + v + '" data-view="' + v + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + (IC[ic] || IC.tool) + '</svg><span>' + esc(label) + '</span>' + (badge ? '<em class="count soon" aria-hidden="true">Soon</em><span class="sr-only"> (upcoming, not built yet)</span>' : '') + '</a>'; }
  function buildNav() {
    var nav = $('.nav'); if (!nav) return;
    nav.innerHTML = '<p class="nav-group mono">NOVA</p>' + NOVA_NAV.map(function (n) { return link(n[0], n[1], n[2], n[3]); }).join('') +
      '<p class="nav-group mono">Classic tools (stored in this browser)</p>' + TOOLS_NAV.map(function (n) { return link(n[0], n[1], n[2]); }).join('') + '<a href="blueprint/"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/></svg><span>Blueprint</span></a>';
    var bn = $('.bottom-nav');
    if (bn) { var more = $('#moreBtn'); $$('a', bn).forEach(function (a) { a.remove(); });
      [['dashboard', 'Home', 'dash'], ['chat', 'Chat', 'chat'], ['memory', 'Memory', 'mem'], ['voice', 'Voice', 'mic']].forEach(function (n) { more.insertAdjacentHTML('beforebegin', link(n[0], n[1], n[2])); }); }
    var sheet = $('#moreSheet');
    if (sheet) sheet.innerHTML = NOVA_NAV.concat(TOOLS_NAV).filter(function (n) { return ['dashboard', 'chat', 'memory', 'voice'].indexOf(n[0]) < 0; }).map(function (n) { return '<a href="#' + n[0] + '" data-view="' + n[0] + '">' + esc(n[1]) + (n[3] ? ' (upcoming)' : '') + '</a>'; }).join('') + '<a href="blueprint/">Blueprint</a>';
  }

  /* ================= small shared pieces ================= */
  function soon(phase, what, list) {
    return '<article class="panel upcoming"><p class="tag gold">Upcoming: ' + esc(phase) + '</p><h2 class="label">' + esc(what) + '</h2><p class="muted">This feature is not built yet, so nothing on this page is live. It is listed so you can see what is planned.</p>' +
      (list ? '<ul class="plain">' + list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '</article>';
  }
  function load(key, path) { return api('GET', path).then(function (d) { N.cache[key] = d; return d; }); }
  // Fetch fresh data for a screen and redraw it only if something actually changed (otherwise every redraw would trigger another fetch).
  function stale(screen, keys) {
    var sig = function (k) { return JSON.stringify(N.cache[k[0]] || null, function (key, v) { return key === 'lastSeenAt' ? undefined : v; }); };   // lastSeenAt changes on every fetch, so it must not trigger a redraw
    var before = keys.map(sig);
    Promise.all(keys.map(function (k) { return load(k[0], k[1]); })).then(function () {
      var changed = keys.some(function (k, i) { return sig(k) !== before[i]; });
      if (changed && J.current() === screen) J.render(false);
    }).catch(fail);
  }
  function tile(label, value, note, tone) { return '<div class="panel stat' + (tone ? ' ' + tone : '') + '"><span><span class="label">' + esc(label) + '</span><b class="num">' + esc(value) + '</b><small>' + esc(note) + '</small></span></div>'; }
  function name() { return N.user ? N.user.displayName : 'there'; }

  /* ================= screens ================= */
  var S = J.screens;
  Object.assign(J.titles, { dashboard: 'Dashboard', chat: 'NOVA Chat', voice: 'Voice Assistant', email: 'Smart Email', hub: 'Tasks and Calendar', proofloop: 'ProofLoop', automation: 'Automation Centre', identity: 'Personal Identity', memory: 'Memory Vault', knowledge: 'Knowledge Base', usage: 'AI Usage and Cost', connections: 'Connected Apps', security: 'Security and Settings' });
  S.dashboard = {
    render: function () {
      var m = N.cache.memories, u = N.cache.usage, a = N.cache.activity, convs = N.cache.conversations, ap = N.cache.approvals ? N.cache.approvals.approvals : null;
      var active = m ? m.memories.filter(function (x) { return x.status === 'active'; }).length : '…', proposed = (m ? m.memories.filter(function (x) { return x.status === 'proposed'; }).length : 0) + (ap ? ap.length : 0);
      var rules = 0, model = 0; if (u) u.byHandler.forEach(function (h) { if (h.handler === 'rules') rules += h.calls; else if (h.handler === 'claude') model += h.calls; });
      return '<section class="hero nova-hero"><div class="core-stage">' + orb('big') + '</div><div>' +
        '<p class="eyebrow">' + esc(J.longDate ? J.longDate(J.today()) : '') + ' · Dubai</p><h1 class="greet">Good ' + (new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening') + ', ' + esc(name()) + '</h1>' +
        '<p class="lead">From Request to Verified Result.</p><p class="live" id="novaStatusText" role="status">NOVA: ' + esc(STATES[N.state]) + '</p>' +
        '<div class="btn-row"><a class="btn primary" href="#chat">Talk to NOVA</a><a class="btn" href="#memory">Memory Vault</a></div></div></section>' +
        '<div class="stats">' + tile('Saved memories', active, 'approved by you') + tile('Waiting for approval', proposed, proposed ? 'memories and actions' : 'nothing pending', proposed ? 'gold' : '') +
        tile('Replies without AI', rules, 'free rule-based, this month') + tile('Replies from a model', N.session && N.session.aiProvider === 'claude' ? model : 'off', N.session && N.session.aiProvider === 'claude' ? 'this month' : 'no AI model configured') + '</div>' +
        (ap && ap.length ? '<article class="panel gold" id="approvalsPanel"><h2 class="label">Waiting for your approval <span class="n">' + ap.length + '</span></h2>' + ap.map(function (x) { return previewCard({ id: x.runId, pendingApproval: x }); }).join('') + '</article>' : '') +
        '<div class="grid-2"><article class="panel upcoming"><p class="tag gold">Upcoming: Phase 3</p><h2 class="label">ProofLoop</h2><p class="muted">ProofLoop will track every commitment from request to verified result and never treat a draft or a "sent" response as proof. It is not built yet, so there are no commitments to show.</p>' +
          '<ol class="loop-states">' + ['Request Detected', 'Request Understood', 'Task Prepared', 'Awaiting Approval', 'Executing', 'Submitted', 'Awaiting Confirmation', 'Verified', 'Completed'].map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></article>' +
        '<article class="panel"><div class="panel-head"><h2 class="label">Recent activity (real)</h2><a class="btn small ghost" href="#chat">Chat</a></div>' +
          (a && a.activity.length ? '<ul class="mini-list">' + a.activity.slice(0, 5).map(function (x) { return '<li><span class="when">' + esc(ago(x.at)) + '</span><span class="what">' + esc(x.request) + '<small>' + esc(x.operation.replace(/_/g, ' ')) + ' · ' + esc(x.handler === 'rules' ? 'built-in rule' : x.handler) + ' · ' + esc(x.status.replace(/_/g, ' ')) + '</small></span></li>'; }).join('') + '</ul>' : J.empty(a ? 'No activity yet. Ask NOVA something in Chat.' : 'Loading…')) + '</article></div>' +
        '<article class="panel"><h2 class="label">What works today</h2><ul class="plain small-text"><li><b>Working:</b> sign-in, memories you approve, chat with built-in rules, tasks and notes that NOVA can create after you approve (with Undo where possible), activity history, usage ledger, data export and deletion.</li><li><b>Needs setup:</b> Claude answers (needs an API key; paid). Google sign-in (needs a free Google Client ID).</li><li><b>Upcoming:</b> email, ProofLoop, automations, voice conversations with NOVA, knowledge base.</li></ul></article>' +
        (convs ? '' : '');
    },
    after: function () { stale('dashboard', [['memories', '/api/memories'], ['usage', '/api/usage'], ['activity', '/api/activity'], ['approvals', '/api/approvals']]); }
  };

  /* ---- chat ---- */
  var EDITABLE = { 'tasks.create': [['title', 'Task title', 'text'], ['due', 'Due date (YYYY-MM-DD, optional)', 'text']], 'notes.create': [['text', 'Note', 'text']], 'memory.add': [['text', 'Memory', 'text']] };
  function previewCard(run) {
    var a = run.pendingApproval; if (!a) return '';
    var p = a.preview;
    return '<section class="preview" role="group" aria-label="Review before NOVA acts"><p class="tag gold">Review before NOVA acts</p><dl class="kv">' +
      '<dt>Proposed action</dt><dd>' + esc(p.action) + '</dd><dt>Why</dt><dd>' + esc(p.reason) + '</dd><dt>Where</dt><dd>' + esc(p.target) + '</dd>' +
      '<dt>What will change</dt><dd>' + (p.changes.length ? '<ul class="plain">' + p.changes.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : 'Nothing') + '</dd>' +
      '<dt>Possible consequences</dt><dd>' + esc(p.consequences) + '</dd><dt>Can it be undone?</dt><dd>' + (p.undoable ? 'Yes. ' : '<b>No.</b> ') + esc(p.undoNote || '') + '</dd></dl>' +
      '<div class="btn-row"><button type="button" class="btn small primary" data-act="novaApproveRun" data-id="' + a.id + '">Approve</button><button type="button" class="btn small" data-act="novaRejectRun" data-id="' + a.id + '">Reject</button>' +
      (EDITABLE[a.tool] ? '<button type="button" class="btn small ghost" data-act="novaEditRun" data-id="' + a.id + '">Edit</button>' : '') +
      '<button type="button" class="btn small ghost" data-act="novaCancelRun" data-id="' + run.id + '">Cancel request</button></div></section>';
  }
  function runBlock(m) {
    var run = N.runs[m.runId] || m.run; if (!run) return '';
    var undo = run.executions.filter(function (x) { return x.undoable; }).map(function (x) { return '<button type="button" class="btn small ghost" data-act="novaUndo" data-id="' + x.id + '" data-run="' + run.id + '">Undo this</button>'; }).join(' ');
    var notUndo = run.executions.filter(function (x) { return x.status === 'succeeded' && !x.undoable && !x.undone; }).length ? '<span class="small-text muted">This change cannot be undone.</span>' : '';
    return '<details class="steps"' + (run.pendingApproval ? ' open' : '') + '><summary>What NOVA did (' + esc(run.status.replace(/_/g, ' ')) + ')</summary><ol>' + run.steps.map(function (x) { return '<li class="k-' + esc(x.kind) + '">' + esc(x.summary) + '</li>'; }).join('') + '</ol>' +
      '<p class="small-text muted">Handled by: ' + esc(run.planner === 'rules' ? 'a built-in rule (no AI)' : 'the AI model') + '. Tools can only run after validation' + (run.pendingApproval ? '' : ' and, for changes, your approval') + '.</p></details>' + previewCard(run) + (undo || notUndo ? '<div class="btn-row">' + undo + notUndo + '</div>' : '');
  }
  function chatHTML() {
    var c = N.chat;
    return c.msgs.map(function (m) {
      if (m.role === 'user') return '<div class="msg me"><p class="who mono">' + esc(name()) + '</p><p class="text">' + esc(m.text) + '</p></div>';
      var run = N.runs[m.runId] || m.run, text = run && run.result && run.status !== 'awaiting_approval' ? run.result : m.text;
      var steps = run ? runBlock(m) : (m.steps && m.steps.length ? '<details class="steps"><summary>What NOVA did</summary><ol>' + m.steps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol><p class="small-text muted">Handled by: ' + esc(m.handler === 'rules' ? 'a built-in rule (no AI)' : m.handler === 'claude' ? 'the AI model ' + (m.model || '') : m.handler === 'none' ? 'no AI model (none configured)' : m.handler) + (m.usage && (m.usage.input || m.usage.output) ? ' · ' + m.usage.input + ' in / ' + m.usage.output + ' out tokens' : '') + '</p></details>' : '');
      var prop = m.proposal && m.proposal.status === 'proposed' ? '<div class="proposal" role="group" aria-label="Memory waiting for your approval"><p><b>Waiting for your approval:</b> “' + esc(m.proposal.text) + '” <span class="tag dim">' + esc(m.proposal.kind) + '</span>' + (m.proposal.sensitive ? ' <span class="tag red">looks sensitive</span>' : '') + '</p><div class="btn-row"><button type="button" class="btn small primary" data-act="novaApprove" data-id="' + m.proposal.id + '">Save this memory</button><button type="button" class="btn small" data-act="novaReject" data-id="' + m.proposal.id + '">Don\'t save</button></div></div>'
        : m.proposal && m.proposal.status === 'active' ? '<p class="small-text muted">Saved to your Memory Vault.</p>' : m.proposal && m.proposal.status === 'rejected' ? '<p class="small-text muted">Not saved.</p>' : '';
      return '<div class="msg bot"><p class="who mono">NOVA</p><p class="text">' + esc(text) + '</p>' + steps + prop + '</div>';
    }).join('');
  }
  S.chat = {
    render: function () {
      var c = N.chat;
      return J.head('Conversation', 'NOVA Chat', 'Ask in plain English. NOVA shows what it plans to do, asks before it changes anything, and then checks the result.', '<button type="button" class="btn" data-act="novaNewChat">New chat</button>') +
        '<div class="chat-grid"><aside class="panel chat-list"><h2 class="label">History</h2>' + (c.convs.length ? '<ul class="items">' + c.convs.map(function (x) { return '<li class="item"><button type="button" class="link-btn' + (x.id === c.cid ? ' on' : '') + '" data-act="novaOpenChat" data-id="' + x.id + '">' + esc(x.title) + '</button></li>'; }).join('') + '</ul>' : J.empty('No conversations yet.')) + '</aside>' +
        '<section class="panel chat-main" aria-label="Conversation">' + '<div class="chat-head">' + orb('mini') + '<span id="novaStatusText" role="status">NOVA: ' + esc(STATES[N.state]) + '</span></div>' +
          '<div class="chat-log" id="novaLog" tabindex="0" aria-live="polite">' + (c.msgs.length ? chatHTML() : J.empty('Try: <q>who am I?</q> · <q>remember that I prefer short replies</q> · <q>what do you remember about me?</q> · <q>what time is it?</q>')) + (c.busy ? '<p class="typing">NOVA is working…</p>' : '') + '</div>' +
          '<form id="novaChatForm" class="chat-form"><label class="sr-only" for="novaMsg">Message to NOVA</label><textarea id="novaMsg" rows="2" maxlength="2000" placeholder="Message NOVA…"' + (c.busy ? ' disabled' : '') + '>' + esc(c.draft) + '</textarea><button type="submit" class="btn primary"' + (c.busy ? ' disabled' : '') + '>Send</button></form>' +
          '<p class="small-text muted">Enter sends, Shift+Enter adds a line. ' + (N.session && N.session.aiProvider === 'claude' ? 'An AI model is connected; it can only write text.' : 'No AI model is connected, so NOVA answers with built-in rules and says so when it cannot answer.') + '</p></section></div>';
    },
    after: function () {
      var f = $('#novaChatForm'), ta = $('#novaMsg'), log = $('#novaLog');
      if (log) log.scrollTop = log.scrollHeight;
      if (!ta) return;
      ta.addEventListener('input', function () { N.chat.draft = ta.value; });
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } });
      f.addEventListener('submit', function (e) { e.preventDefault(); N.send(ta.value); });
      load('conversations', '/api/conversations').then(function (d) { var same = JSON.stringify(d.conversations) === JSON.stringify(N.chat.convs); N.chat.convs = d.conversations; if (!same && J.current() === 'chat' && !N.chat.busy) J.render(false); }).catch(function () {});
    }
  };
  N.send = function (text) {
    text = String(text || '').trim(); var c = N.chat;
    if (!text || c.busy) return Promise.resolve();
    c.msgs.push({ role: 'user', text: text }); c.draft = ''; c.busy = true; N.setState(N.session && N.session.aiProvider === 'claude' ? 'planning' : 'understanding'); J.render(false);
    return api('POST', '/api/chat', { message: text, conversationId: c.cid }).then(function (r) {
      c.cid = r.conversationId; c.busy = false;
      if (r.run) N.runs[r.run.id] = r.run;
      c.msgs.push({ role: 'assistant', text: r.reply, steps: r.steps, handler: r.handler, model: r.model, usage: r.usage, proposal: r.proposal, runId: r.run ? r.run.id : null });
      N.setState(r.status === 'failed' ? 'error' : r.status === 'awaiting_approval' ? 'waiting_approval' : 'completed');
      N.cache.activity = null; N.cache.memories = null; N.cache.usage = null; N.cache.approvals = null; N.cache.tasks = null;
      J.render(false);
      var ta = $('#novaMsg'); if (ta) ta.focus();            // keep the keyboard where the person was typing
      return r;
    }).catch(function (e) { c.busy = false; c.msgs.push({ role: 'assistant', text: e.message, steps: [], handler: 'error' }); N.setState('error'); J.render(false); });
  };
  function setProposal(id, status) { N.chat.msgs.forEach(function (m) { if (m.proposal && m.proposal.id === id) m.proposal.status = status; }); }
  Object.assign(J.actions, {
    novaNewChat: function () { N.chat.cid = null; N.chat.msgs = []; N.setState('idle'); J.render(false); },
    novaOpenChat: function (id) { api('GET', '/api/conversations/' + id).then(function (d) { N.chat.cid = +id; N.chat.msgs = d.messages.map(function (m) { return { role: m.role, text: m.content, steps: [], handler: m.role === 'assistant' ? 'saved' : '' }; }); J.render(false); }).catch(fail); },
    novaApprove: function (id) {
      var done = function (confirmSensitive) { return api('POST', '/api/memories/' + id + '/approve', { confirmSensitive: !!confirmSensitive }).then(function () { setProposal(+id, 'active'); N.cache.memories = null; N.setState('completed'); J.toast('Saved to your Memory Vault.'); J.render(false); }); };
      done(false).catch(function (e) { if (e.code === 'needs_sensitive_confirmation') J.confirm('This looks sensitive. Do you want NOVA to remember it?', 'Yes, remember it', 'Sensitive information').then(function (ok) { if (ok) done(true).catch(fail); }); else fail(e); });
    },
    novaReject: function (id) { api('DELETE', '/api/memories/' + id).then(function () { setProposal(+id, 'rejected'); N.setState('idle'); J.render(false); }).catch(fail); }
  });

  function afterRun(run, ok) {
    N.runs[run.id] = run; N.cache.approvals = null; N.cache.tasks = null; N.cache.activity = null; N.cache.usage = null;
    N.setState(run.status === 'failed' ? 'error' : run.status === 'awaiting_approval' ? 'waiting_approval' : run.status === 'cancelled' ? 'idle' : 'completed');
    J.render(false);
  }
  function approveRun(id, edited) {
    N.setState('executing');
    return api('POST', '/api/approvals/' + id + '/approve', edited ? { editedInput: edited } : {}).then(afterRun).catch(function (e) { N.setState('error'); fail(e); });
  }
  function approvalById(id) { var list = []; Object.keys(N.runs).forEach(function (k) { if (N.runs[k].pendingApproval) list.push(N.runs[k].pendingApproval); }); ((N.cache.approvals || {}).approvals || []).forEach(function (a) { list.push(a); }); return list.filter(function (a) { return a.id === +id; })[0]; }
  Object.assign(J.actions, {
    novaApproveRun: function (id) { approveRun(id); },
    novaRejectRun: function (id) { api('POST', '/api/approvals/' + id + '/reject', {}).then(afterRun).catch(fail); },
    novaCancelRun: function (id) { api('POST', '/api/runs/' + id + '/cancel', {}).then(afterRun).catch(fail); },
    novaUndo: function (id, el) { api('POST', '/api/executions/' + id + '/undo', {}).then(function (r) { J.toast(r.message); var rid = el && el.getAttribute('data-run'); return rid ? api('GET', '/api/runs/' + rid) : null; }).then(function (run) { if (run) afterRun(run); }).catch(fail); },
    novaEditRun: function (id) {
      var a = approvalById(id); if (!a || !EDITABLE[a.tool]) return;
      J.openForm({ title: 'Edit before approving', submit: 'Approve with changes', fields: EDITABLE[a.tool].map(function (f) { return { name: f[0], label: f[1], value: a.input[f[0]] == null ? '' : a.input[f[0]], required: f[0] !== 'due' }; }),
        onSave: function (v) { var out = {}; Object.keys(v).forEach(function (k) { if (v[k] !== '') out[k] = v[k]; }); approveRun(id, out); } });
    }
  });

  /* ---- voice ---- */
  S.voice = {
    render: function () {
      var sr = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      return J.head('Voice', 'Voice Assistant', 'Push to talk, see the words, hear the answer.', '<button type="button" class="btn primary" data-act="talk">' + (sr ? 'Push to talk' : 'Voice not supported here') + '</button>') +
        '<div class="grid-2"><article class="panel center">' + orb('big') + '<p id="novaStatusText" role="status">NOVA: ' + esc(STATES[N.state]) + '</p><p class="live" id="liveLine" aria-live="polite"></p></article>' +
        '<article class="panel"><h2 class="label">How it works today</h2><ul class="plain small-text"><li>Press <b>Push to talk</b> or <kbd>J</kbd>, speak, and the transcript appears in the chat panel.</li><li>Commands that NOVA\'s built-in tools know (tasks, calendar, jobs) run as before. Anything else is sent to NOVA\'s chat on the server, so "who am I?" works by voice.</li><li>Speech recognition is done by your browser\'s own service (Chrome and Edge send audio to their vendor; Firefox cannot listen). Recognition is never perfect: check the transcript.</li><li>Voice is <b>never</b> used to prove who you are. Only the signed-in account does that.</li></ul>' +
          '<p class="tag gold">Upcoming: Phase 5</p><p class="small-text muted">Editing the transcript before sending, language choice, and a dedicated speech provider.</p>' +
          (sr ? '' : '<p class="login-msg">This browser cannot listen. You can still type in NOVA Chat.</p>') + '</article></div>';
    }
  };
  S.email = { render: function () { return J.head('Inbox', 'Smart Email', 'Not built yet.', '') + soon('Phase 4', 'Gmail intelligence', ['Read-only Gmail connection (official Google sign-in)', 'Priority: Critical, Important, Normal, Low Priority, Needs Review, always with a reason', 'Deadlines and requests found in messages, with a link to the original', 'Reply drafts you review and edit. Nothing is sent without separate permission and your approval']); } };
  S.proofloop = { render: function () { return J.head('Signature feature', 'ProofLoop Mission Control', 'Not built yet.', '') + soon('Phase 3', 'Commitments tracked to a verified result', ['A saved state machine: Request Detected → … → Verified → Completed, plus Failed and Cancelled', 'Evidence for every step: a draft is not a sent email, and "sent" is not proof of delivery', 'What you owe, what is owed to you, what is overdue, what is awaiting confirmation']); } };
  S.automation = { render: function () { return J.head('Automation', 'Automation Centre', 'Not built yet.', '') + soon('Phase 5', 'Scheduled work that runs with the browser closed', ['Daily briefing, deadline reminders, pending-reply reminders, follow-ups', 'Run now, enable, disable, history, next run, retries without duplicates']) + '<article class="panel"><h2 class="label">Running today (separate from NOVA)</h2><p class="small-text muted">The GitHub Action that collects jobs every 6 hours is the only scheduled automation. See Connected Apps.</p></article>'; } };
  S.knowledge = { render: function () { return J.head('Knowledge', 'Knowledge Base', 'Not built yet.', '') + soon('Phase 6', 'Your documents and notes, searchable with sources', ['Add notes and files you choose', 'Answers cite the source passage']); } };

  /* ---- tasks and calendar hub ---- */
  S.hub = {
    render: function () {
      var t = J.today(), over = J.overdue().length, due = J.dueToday().length, week = J.dueWeek().length, nt = N.cache.tasks ? N.cache.tasks.tasks : null;
      return J.head('Planner', 'Tasks and Calendar', 'NOVA tasks live in the server database. The Classic tools below still keep their own tasks in this browser.', '<a class="btn primary" href="#chat">Ask NOVA to add a task</a>') +
        '<article class="panel"><h2 class="label">NOVA tasks (server) ' + (nt ? '<span class="n">' + nt.length + '</span>' : '') + '</h2>' +
          (!nt ? J.empty('Loading…') : nt.length ? '<ul class="items">' + nt.map(function (x) { return '<li class="item' + (x.status === 'done' ? ' done' : '') + '"><div class="item-main"><p class="item-title">' + esc(x.title) + '</p><p class="item-meta"><span>' + (x.status === 'done' ? 'Done' : 'Open') + '</span><span>' + (x.due ? 'due ' + esc(x.due) : 'no due date') + '</span><span>' + esc(x.source || '') + '</span></p></div></li>'; }).join('') + '</ul>' : J.empty('No NOVA tasks yet. In Chat, say <q>add a task to call HR by Friday</q>. You approve it first.')) +
          '<p class="small-text muted">To complete or delete one, ask NOVA in Chat (for example <q>mark call HR as done</q>). Each change shows a preview and can usually be undone.</p></article>' +
        '<h2 class="section-title">Classic tools (this browser)</h2><div class="stats">' + tile('Overdue', over, 'tasks', over ? 'red' : '') + tile('Due today', due, J.fmt ? J.fmt(t) : t) + tile('This week', week, 'after today') + tile('Storage', 'Browser', 'moves to the server later') + '</div>' +
        '<div class="btn-row"><a class="btn" href="#tasks">Open Tasks</a><a class="btn" href="#calendar">Open Calendar</a><a class="btn" href="#notes">Notes</a></div>' +
        '<p class="small-text muted">Google and Outlook calendars connect from the browser (Tool settings). Gmail and server-side calendars are upcoming.</p>';
    },
    after: function () { stale('hub', [['tasks', '/api/tasks']]); }
  };

  /* ---- identity ---- */
  S.identity = {
    render: function () {
      var u = N.user, m = N.cache.memories, n = m ? m.memories.filter(function (x) { return x.status === 'active'; }).length : '…';
      return J.head('Identity', 'Personal Identity', 'NOVA knows you from the account you signed in with.', '') +
        '<article class="panel"><h2 class="label">Who NOVA believes you are</h2><dl class="kv"><dt>Account</dt><dd>' + esc(u.email) + '</dd><dt>Display name</dt><dd>' + esc(u.displayName) + '</dd><dt>Member since</dt><dd>' + esc(when(u.createdAt)) + '</dd><dt>Saved memories</dt><dd>' + esc(n) + '</dd><dt>Personalisation</dt><dd>' + (u.personalization ? 'On' : 'Off') + '</dd></dl>' +
          '<p class="small-text muted">Typing a name in chat does not change who you are. Identity comes from the signed-in account.</p></article>' +
        '<form class="panel" id="novaProfileForm" autocomplete="off"><h2 class="label">Edit profile</h2><div class="field"><label for="novaName">Preferred display name</label><input id="novaName" type="text" maxlength="60" value="' + esc(u.displayName) + '" required></div>' +
          '<label class="switch"><span class="txt"><b>Use my saved memories</b><small>When off, NOVA does not use or look up any memory. Your memories are kept.</small></span><input type="checkbox" id="novaPers"' + (u.personalization ? ' checked' : '') + '><span class="knob" aria-hidden="true"></span></label>' +
          '<label class="switch"><span class="txt"><b>Auto-approve low-risk changes</b><small>When on, NOVA may create tasks and notes without asking each time (you can still undo them). Deleting, forgetting and anything that affects another system always asks.</small></span><input type="checkbox" id="novaAuto"' + (u.autoLowRisk ? ' checked' : '') + '><span class="knob" aria-hidden="true"></span></label>' +
          '<div class="btn-row" style="margin-top:14px"><button type="submit" class="btn primary">Save</button></div></form>';
    },
    after: function () {
      stale('identity', [['memories', '/api/memories']]);
      var f = $('#novaProfileForm'); if (!f) return;
      f.addEventListener('submit', function (e) { e.preventDefault(); api('PATCH', '/api/profile', { displayName: $('#novaName').value, personalization: $('#novaPers').checked, autoLowRisk: $('#novaAuto').checked }).then(function (d) { N.user = d.user; J.toast('Profile saved.'); J.render(false); }).catch(fail); });
    }
  };

  /* ---- memory vault ---- */
  var KINDS = [['preference', 'Preference'], ['goal', 'Goal'], ['project', 'Project'], ['contact', 'Contact'], ['priority', 'Priority'], ['app', 'Frequently used app'], ['recurring', 'Recurring task'], ['fact', 'Other fact']];
  function memRow(x) {
    return '<li class="item"><div class="item-main"><p class="item-title">' + esc(x.text) + '</p><p class="item-meta"><span>' + esc((KINDS.filter(function (k) { return k[0] === x.kind; })[0] || [0, x.kind])[1]) + '</span><span>saved ' + esc(when(x.createdAt)) + '</span><span>source: ' + esc(x.source) + '</span>' + (x.lastUsedAt ? '<span>last used ' + esc(ago(x.lastUsedAt)) + '</span>' : '') + (x.sensitive ? J.tag('Sensitive', 'red') : '') + '</p></div><div class="item-actions">' +
      (x.status === 'proposed' ? '<button type="button" class="btn small primary" data-act="novaApprove" data-id="' + x.id + '">Approve</button>' : J.iconBtn('novaEditMem', x.id, 'Correct memory: ' + x.text, 'edit')) + J.iconBtn('novaDelMem', x.id, (x.status === 'proposed' ? 'Reject memory: ' : 'Delete memory: ') + x.text, 'del', 'del') + '</div></li>';
  }
  S.memory = {
    render: function () {
      var d = N.cache.memories, act = d ? d.memories.filter(function (x) { return x.status === 'active'; }) : [], pro = d ? d.memories.filter(function (x) { return x.status === 'proposed'; }) : [];
      return J.head('Memory', 'Memory Vault', 'Only what you approve is remembered. Every item shows when it was saved and where it came from.', '<button type="button" class="btn primary" data-act="novaAddMem">Add a memory</button>') +
        (N.user && !N.user.personalization ? '<article class="panel gold"><p style="margin:0">Personalisation is <b>off</b>: NOVA is not using these memories. Turn it on in Personal Identity.</p></article>' : '') +
        (pro.length ? '<article class="panel gold"><h2 class="label">Waiting for your approval</h2><ul class="items">' + pro.map(memRow).join('') + '</ul></article>' : '') +
        '<article class="panel"><h2 class="label">Saved memories <span class="n">' + act.length + '</span></h2>' + (!d ? J.empty('Loading…') : act.length ? '<ul class="items">' + act.map(memRow).join('') + '</ul>' : J.empty('Nothing saved yet. Add one, or say <q>remember that…</q> in Chat.')) + '</article>' +
        '<p class="small-text muted">NOVA never stores passwords, card numbers or keys. Details such as passport numbers need your explicit confirmation. Only the few memories relevant to a request are looked up for it.</p>';
    },
    after: function () { stale('memory', [['memories', '/api/memories']]); }
  };
  function memForm(x) {
    J.openForm({ title: x ? 'Correct memory' : 'Add a memory', fields: [{ name: 'text', label: 'What should NOVA remember?', type: 'textarea', value: x && x.text, required: true, rows: 3, hint: 'Up to 500 characters.' }, { name: 'kind', label: 'Type', type: 'select', value: x ? x.kind : 'fact', options: KINDS }],
      onSave: function (v) {
        var send = function (conf) { return api(x ? 'PATCH' : 'POST', x ? '/api/memories/' + x.id : '/api/memories', { text: v.text, kind: v.kind, confirmSensitive: conf }).then(function () { N.cache.memories = null; J.toast(x ? 'Memory corrected.' : 'Memory saved.'); load('memories', '/api/memories').then(function () { J.render(false); }); }); };
        send(false).catch(function (e) { if (e.code === 'needs_sensitive_confirmation') J.confirm(e.message, 'Yes, remember it', 'Sensitive information').then(function (ok) { if (ok) send(true).catch(fail); }); else fail(e); });
      } });
  }
  function memById(id) { return ((N.cache.memories || {}).memories || []).filter(function (x) { return x.id === +id; })[0]; }
  Object.assign(J.actions, {
    novaAddMem: function () { memForm(null); }, novaEditMem: function (id) { var x = memById(id); if (x) memForm(x); },
    novaDelMem: function (id) { var x = memById(id); J.confirm('Delete this memory? "' + (x ? x.text : '') + '"', 'Delete', 'Delete memory').then(function (ok) { if (ok) api('DELETE', '/api/memories/' + id).then(function () { return load('memories', '/api/memories'); }).then(function () { J.toast('Deleted.'); J.render(false); }).catch(fail); }); }
  });

  /* ---- usage ---- */
  S.usage = {
    render: function () {
      var u = N.cache.usage;
      if (!u) return J.head('Monitor', 'AI Usage and Cost', 'Real numbers from the server\'s usage ledger.', '') + J.empty('Loading…');
      var rows = u.byHandler.map(function (h) { return '<tr><th scope="row">' + esc(h.handler === 'rules' ? 'Built-in rules (no AI)' : h.handler === 'claude' ? 'AI model' : h.handler === 'none' ? 'No AI model configured (honest fallback)' : h.handler === 'blocked' ? 'Blocked by spending limit' : h.handler) + '</th><td>' + h.calls + '</td><td>' + h.ok + '</td><td>' + h.inputTokens + '</td><td>' + h.outputTokens + '</td><td>' + h.cacheReadTokens + '</td><td>' + Math.round(h.durationMs / Math.max(1, h.calls)) + ' ms</td><td>' + (h.estCostUsd == null ? 'n/a' : '$' + h.estCostUsd.toFixed(4)) + '</td></tr>'; }).join('');
      return J.head('Monitor', 'AI Usage and Cost', 'Real numbers from the server\'s usage ledger for ' + esc(u.month) + '. Nothing here is invented.', '') +
        '<div class="stats">' + tile('AI provider', u.provider === 'claude' ? 'Claude' : 'None', u.model ? 'model ' + u.model : 'rules only: free') + tile('Monthly limit', u.monthlyLimitUsd == null ? 'None' : '$' + u.monthlyLimitUsd, u.monthlyLimitUsd == null ? 'set NOVA_MONTHLY_LIMIT_USD' : 'AI calls stop at the limit') + '</div>' +
        '<article class="panel"><h2 class="label">This month</h2>' + (rows ? '<div class="table-wrap"><table class="cmds"><thead><tr><th scope="col">Handled by</th><th scope="col">Calls</th><th scope="col">Succeeded</th><th scope="col">Input tokens</th><th scope="col">Output tokens</th><th scope="col">Cache-read tokens</th><th scope="col">Avg time</th><th scope="col">Est. cost</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : J.empty('No requests this month yet.')) +
        '<p class="small-text muted">' + esc(u.note) + ' Claude Code (the tool used to build NOVA) and the Claude API (used by a running NOVA) are billed separately.</p></article>';
    },
    after: function () { stale('usage', [['usage', '/api/usage']]); }
  };

  /* ---- connected apps ---- */
  S.connections = {
    render: function () {
      var ai = N.session && N.session.aiProvider === 'claude';
      function row(n, status, tone, note, act) { return '<li><span class="grow"><b>' + esc(n) + '</b><br><span class="small-text muted">' + esc(note) + '</span></span>' + J.tag(status, tone) + (act || '') + '</li>'; }
      return J.head('Integrations', 'Connected Applications', 'Each connection shows its real status and permissions.', '') +
        '<article class="panel"><ul class="sources">' +
        row('NOVA server and database', 'Connected', '', 'SQLite database on the server that runs NOVA. Signed in as ' + (N.user ? N.user.email : '')) +
        row('Claude (AI model)', ai ? 'Configured' : 'Not configured', ai ? '' : 'gold', ai ? 'Text replies only. It cannot act.' : 'Optional and paid: set NOVA_AI_PROVIDER=claude and ANTHROPIC_API_KEY on the server.') +
        row('Google Calendar (browser)', 'Browser-side', 'dim', 'Read-only or two-way, set up in Tool settings. Not yet connected through the server.', ' <a class="btn small" href="#settings">Open</a>') +
        row('Outlook / Microsoft 365 calendar (browser)', 'Browser-side', 'dim', 'Set up in Tool settings.', ' <a class="btn small" href="#settings">Open</a>') +
        row('Gmail', 'Upcoming', 'gold', 'Phase 4. Will start read-only.') +
        row('Job collector (GitHub Action)', 'Separate', 'dim', 'Collects public job listings every 6 hours. See Jobs for you.', ' <a class="btn small" href="#matches">Open</a>') + '</ul></article>';
    }
  };

  /* ---- security and settings ---- */
  S.security = {
    render: function () {
      var ses = N.cache.sessions, au = N.cache.audit;
      return J.head('Protection', 'Security and Settings', 'Your sessions, your audit trail, and your data. You stay in control.', '<button type="button" class="btn" data-act="novaSignOut">Sign out</button>') +
        '<article class="panel"><div class="panel-head"><h2 class="label">Signed-in sessions</h2><button type="button" class="btn small" data-act="novaRevoke">Sign out other devices</button></div>' +
          (ses ? '<ul class="sources">' + ses.sessions.map(function (s) { return '<li><span class="grow"><b>' + (s.current ? 'This session' : 'Another session') + '</b><br><span class="small-text muted">started ' + esc(when(s.createdAt)) + ' · last active ' + esc(ago(s.lastSeenAt)) + ' · expires ' + esc(when(s.expiresAt)) + '</span></span></li>'; }).join('') + '</ul>' : J.empty('Loading…')) +
          '<p class="small-text muted">Sessions end after inactivity and after a maximum time. The cookie is HttpOnly and SameSite, so page scripts cannot read it.</p></article>' +
        '<article class="panel"><h2 class="label">What NOVA is allowed to do</h2>' + (N.cache.tools ? '<div class="table-wrap"><table class="cmds"><thead><tr><th scope="col">Tool</th><th scope="col">Kind</th><th scope="col">Asks you first?</th><th scope="col">Undo?</th></tr></thead><tbody>' + N.cache.tools.tools.map(function (t) { return '<tr><th scope="row">' + esc(t.name) + '<br><small class="muted">' + esc(t.description) + '</small></th><td>' + esc({ read: 'Reads only', write: 'Changes your NOVA data', destructive: 'Deletes', external: 'Affects another system' }[t.risk]) + '</td><td>' + (t.needsApproval ? 'Yes' : 'No') + '</td><td>' + (t.undoable ? 'Yes' : 'No') + '</td></tr>'; }).join('') + '</tbody></table></div>' : J.empty('Loading…')) + '<p class="small-text muted">NOVA can only use tools on this list. The server checks every request, runs nothing that fails validation, and re-reads the result to verify it.</p></article>' +
        '<article class="panel"><h2 class="label">Your data</h2><div class="btn-row"><button type="button" class="btn" data-act="novaExport">Download everything (JSON)</button><button type="button" class="btn danger" data-act="novaDeleteMem">Delete all my memories</button><button type="button" class="btn danger" data-act="novaDeleteAll">Delete my account and all data</button></div>' +
          '<p class="small-text muted">NOVA keeps your data until you delete it. An automatic retention schedule is not built yet.</p></article>' +
        '<article class="panel"><h2 class="label">Audit log (your last 50 events)</h2>' + (au ? (au.entries.length ? '<ul class="mini-list">' + au.entries.map(function (e) { return '<li><span class="when">' + esc(ago(e.at)) + '</span><span class="what">' + esc(e.action.replace(/_/g, ' ')) + '<small>' + esc(e.detail || '') + '</small></span></li>'; }).join('') + '</ul>' : J.empty('Nothing yet.')) : J.empty('Loading…')) +
          '<p class="small-text muted">Tokens, keys and passwords are removed before anything is logged.</p></article>';
    },
    after: function () { stale('security', [['sessions', '/api/sessions'], ['audit', '/api/audit'], ['tools', '/api/tools']]); }
  };
  function typed(title, phrase, run) { J.openForm({ title: title, submit: 'Delete', fields: [{ type: 'html', html: '<p>This cannot be undone. Type <b>DELETE MY DATA</b> to confirm.</p>' }, { name: 'confirm', label: 'Confirmation', required: true }], onSave: function (v) { run(v.confirm); } }); }
  Object.assign(J.actions, {
    novaSignOut: function () { api('POST', '/api/logout', {}).then(function () { N.user = null; location.hash = ''; location.reload(); }).catch(fail); },
    novaRevoke: function () { api('POST', '/api/sessions/revoke-others', {}).then(function (r) { J.toast(r.revoked + ' other session' + (r.revoked === 1 ? '' : 's') + ' signed out.'); return load('sessions', '/api/sessions'); }).then(function () { J.render(false); }).catch(fail); },
    novaExport: function () {
      api('GET', '/api/export').then(function (d) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'nova-export.json'; document.body.appendChild(a); a.click(); a.remove(); J.toast('Export downloaded.'); }).catch(fail);
    },
    novaDeleteMem: function () { typed('Delete all memories', 'DELETE MY DATA', function (c) { api('POST', '/api/data/delete', { scope: 'memories', confirm: c }).then(function () { N.cache.memories = null; J.toast('All memories deleted.'); J.render(false); }).catch(fail); }); },
    novaDeleteAll: function () { typed('Delete my account and all data', 'DELETE MY DATA', function (c) { api('POST', '/api/data/delete', { scope: 'all', confirm: c }).then(function () { N.user = null; location.hash = ''; location.reload(); }).catch(fail); }); }
  });

  /* ================= voice -> NOVA ================= */
  // Anything the built-in NOVA commands do not understand goes to NOVA's server chat (real request, real answer).
  // In server mode, phrases NOVA's built-in actions understand (tasks, notes, forget, memory search) go to the server, where changes need approval.
  J.novaIntent = function (text) { return N.mode === 'server' && !!N.user && !!window.NovaIntents && NovaIntents.matches(text); };
  J.novaAsk = function (text) {
    if (N.mode !== 'server' || !N.user) return null;
    N.setState('understanding');
    return api('POST', '/api/chat', { message: text, conversationId: N.chat.cid }).then(function (r) {
      N.chat.cid = r.conversationId; N.setState(r.status === 'awaiting_approval' ? 'waiting_approval' : r.status === 'failed' ? 'error' : 'completed');
      return r.reply + (r.proposal && r.proposal.status === 'proposed' ? ' Open NOVA Chat or the Memory Vault to approve it.' : '');
    }).catch(function (e) { N.setState('error'); return e.message; });
  };

  /* ================= start ================= */
  function observeVoice() {
    new MutationObserver(function () {
      if (N.chat.busy) return;                                   // a chat request owns the orb while it runs
      var v = voiceState();
      if (v) N.setState(v === 'understanding' && (N.state === 'listening' || N.state === 'transcribing') ? 'transcribing' : v);
      else if (['listening', 'transcribing', 'speaking', 'understanding'].indexOf(N.state) >= 0) N.setState('idle');
    }).observe(document.body, { attributes: true, attributeFilter: ['data-voice'] });
  }
  function start() {
    fetch('/api/session', { credentials: 'same-origin' }).then(function (r) { if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) throw new Error('no server'); return r.json(); })
      .then(function (s) {
        N.mode = 'server'; N.session = s; document.body.classList.add('nova-server');
        document.title = 'NOVA'; var bt = $('.brand-text b'); if (bt) bt.textContent = 'NOVA';
        if (!s.authenticated) { showLogin(); return; }
        N.user = s.user; N.csrf = s.csrf; hideLogin(); buildNav(); observeVoice();
        if (!location.hash || location.hash === '#today') location.hash = 'dashboard'; else J.render(true);
        N.setState('idle');
      })
      .catch(function () { N.mode = 'standalone'; });
  }
  var NOVA_VIEWS = NOVA_NAV.map(function (n) { return n[0]; });
  document.addEventListener('jarvis:rendered', function (e) { document.body.setAttribute('data-group', NOVA_VIEWS.indexOf(e.detail.view) >= 0 ? 'nova' : 'tools'); });
  document.addEventListener('DOMContentLoaded', start);
})();

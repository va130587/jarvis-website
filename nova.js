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
    executing: 'Executing a tool', waiting_approval: 'Waiting for your approval', speaking: 'Speaking', completed: 'Completed', error: 'Something went wrong', focusing: 'Focusing'
  };
  var resetTimer = 0;
  N.setState = function (s, hold) {
    if (!STATES[s]) return;
    if (s === 'idle' && N.focusRunning) s = 'focusing';                    // a running focus session is the resting state
    N.state = s;
    $$('.nova-orb').forEach(function (o) { o.setAttribute('data-state', s); o.setAttribute('aria-label', 'NOVA status: ' + STATES[s]); });
    var t = $('#novaStatusText'); if (t) t.textContent = 'NOVA: ' + STATES[s];
    document.body.setAttribute('data-nova', s);
    clearTimeout(resetTimer);
    if (s === 'completed' || (s === 'error' && !hold)) resetTimer = setTimeout(function () { if (N.state === s) N.setState(voiceState() || (N.focusRunning ? 'focusing' : 'idle')); }, s === 'error' ? 4000 : 1800);
  };
  /* ---- theme: "dark" (Deep Space, default) or "light" (Daylight); boot.js applies it before the first paint ---- */
  N.theme = function () { return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; };
  N.setTheme = function (t) {
    if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('nova.theme', t === 'light' ? 'light' : 'dark'); } catch (e) {}
    $$('meta[name="theme-color"]').forEach(function (m) { m.setAttribute('content', t === 'light' ? '#f5f8fc' : '#03060d'); });
  };
  function voiceState() { var v = document.body.getAttribute('data-voice'); return v === 'listening' ? 'listening' : v === 'speaking' ? 'speaking' : v === 'thinking' ? 'understanding' : null; }
  function orb(size) { return '<div class="nova-orb ' + (size || '') + '" role="img" aria-label="NOVA status: ' + esc(STATES[N.state]) + '" data-state="' + N.state + '"><i class="o-glow"></i><i class="o-ring r1"></i><i class="o-ring r2"></i><i class="o-ring r3"></i><i class="o-core"></i></div>'; }

  /* ================= API ================= */
  var pending = 0;   // requests on their way (N.pending(): the page is quiet when it is 0)
  N.pending = function () { return pending; };
  function api(method, path, body) {
    var o = { method: method, credentials: 'same-origin', headers: {} };
    if (N.csrf) o.headers['X-NOVA-CSRF'] = N.csrf;
    if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    var change = method !== 'GET';
    if (change) changed();
    pending++;
    return fetch(path, o).finally(function () { pending--; if (change) changed(); }).catch(function () {
      var e = new Error(navigator.onLine === false ? 'You are offline. NOVA will reload this when your connection is back.' : 'NOVA could not reach its server. Check that it is running, then try again.'); e.code = 'offline'; e.status = 0; throw e;
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        if (r.status === 401 && N.user) { N.user = null; showLogin('Your session ended. Please sign in again.'); }
        var msg = (j.error && j.error.message) || '';
        if (r.status === 429) msg = 'NOVA is receiving too many requests. Wait ' + (r.headers.get('Retry-After') || '30') + ' seconds, then try again.';
        else if (r.status >= 500 && !msg) msg = 'Something went wrong on the server. Nothing was changed. Try again in a moment.';
        var e = new Error(msg || 'NOVA could not finish that. Nothing was changed. Try again in a moment.'); e.status = r.status; e.code = (j.error && j.error.code) || (r.status === 429 ? 'rate_limited' : r.status >= 500 ? 'server_error' : 'error'); throw e;
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
    week: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4M8 15h3"/>',
    fork: '<path d="M5 5v6a4 4 0 0 0 4 4h10"/><path d="m16 11 4 4-4 4"/><circle cx="5" cy="5" r="1.6"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1.1.9-1.1 1.7M12 16.8v.2"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    replay: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4v4h4M12 8v4.2l2.6 1.6"/>',
    clock: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 3h5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', tool: '<circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.4"/>'
  };
  var NOVA_NAV = [['dashboard', 'Dashboard', 'dash'], ['briefing', 'Daily Briefing', 'sun'], ['chat', 'NOVA Chat', 'chat'], ['voice', 'Voice Assistant', 'mic'], ['email', 'Smart Email', 'mail'], ['hub', 'Tasks and Calendar', 'cal'], ['focus', 'Focus and Planner', 'clock'], ['life', 'Life Tracker', 'heart'], ['weekreview', 'Weekly Review', 'week'], ['journal', 'Decision Journal', 'book'], ['proofloop', 'ProofLoop', 'loop'], ['whatif', 'What if I say yes?', 'fork'], ['insights', 'Weekly Insights', 'cost'], ['replay', 'Day Replay', 'replay'],
    ['automation', 'Automation Centre', 'auto'], ['identity', 'Personal Identity', 'id'], ['memory', 'Memory Vault', 'mem'], ['knowledge', 'Knowledge Base', 'book'], ['usage', 'AI Usage and Cost', 'cost'], ['connections', 'Connected Apps', 'plug'], ['security', 'Security and Settings', 'lock'], ['support', 'Help', 'help']];
  // The sidebar in five groups, by when you need them.
  var NAV_GROUPS = [['Today', ['dashboard', 'briefing', 'chat', 'voice']], ['Work', ['email', 'hub', 'focus', 'proofloop', 'whatif', 'automation']], ['Life', ['life', 'weekreview', 'journal', 'insights', 'replay', 'identity']],
    ['Knowledge', ['knowledge', 'memory']], ['System', ['usage', 'connections', 'security', 'support']]];
  var TOOLS_NAV = [['today', 'Today', 'tool'], ['tasks', 'Tasks', 'tool'], ['calendar', 'Calendar', 'cal'], ['notes', 'Notes', 'book'], ['matches', 'Jobs for you', 'tool'], ['jobs', 'Job finder', 'tool'], ['applications', 'Applications', 'tool'], ['growth', 'Growth', 'cost'], ['review', 'Weekly review', 'cost'], ['profile', 'Job profile', 'id'], ['settings', 'Tool settings', 'tool'], ['help', 'Voice commands', 'mic']];
  function link(v, label, ic, badge) { return '<a href="#' + v + '" data-view="' + v + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + (IC[ic] || IC.tool) + '</svg><span>' + esc(label) + '</span>' + (badge ? '<em class="count soon" aria-hidden="true">Soon</em><span class="sr-only"> (upcoming, not built yet)</span>' : '') + '</a>'; }
  function buildNav() {
    var nav = $('.nav'); if (!nav) return;
    var byId = {}; NOVA_NAV.forEach(function (n) { byId[n[0]] = n; });
    nav.innerHTML = NAV_GROUPS.map(function (g) { return '<p class="nav-group mono">' + g[0] + '</p>' + g[1].map(function (v) { var n = byId[v]; return link(n[0], n[1], n[2], n[3]); }).join(''); }).join('') +
      '<p class="nav-group mono">Classic tools (stored in this browser)</p>' + TOOLS_NAV.map(function (n) { return link(n[0], n[1], n[2]); }).join('') + '<a href="blueprint/"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/></svg><span>Blueprint</span></a>';
    var bn = $('.bottom-nav');
    if (bn) { var more = $('#moreBtn'); $$('a', bn).forEach(function (a) { a.remove(); });
      [['dashboard', 'Home', 'dash'], ['briefing', 'Today', 'sun'], ['chat', 'Chat', 'chat'], ['hub', 'Tasks', 'cal']].forEach(function (n) { more.insertAdjacentHTML('beforebegin', link(n[0], n[1], n[2])); }); }
    var sheet = $('#moreSheet');
    if (sheet) sheet.innerHTML = NOVA_NAV.concat(TOOLS_NAV).filter(function (n) { return ['dashboard', 'briefing', 'chat', 'hub'].indexOf(n[0]) < 0; }).map(function (n) { return '<a href="#' + n[0] + '" data-view="' + n[0] + '">' + esc(n[1]) + (n[3] ? ' (upcoming)' : '') + '</a>'; }).join('') + '<a href="blueprint/">Blueprint</a>';
  }

  /* ================= small shared pieces ================= */
  function soon(phase, what, list) {
    return '<article class="panel upcoming"><p class="tag gold">Upcoming: ' + esc(phase) + '</p><h2 class="label">' + esc(what) + '</h2><p class="muted">This feature is not built yet, so nothing on this page is live. It is listed so you can see what is planned.</p>' +
      (list ? '<ul class="plain">' + list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '</article>';
  }
  // One request per URL at a time: a redraw while a page is still loading shares the request already on its way.
  // Data fetched in the last 2 seconds counts as fresh, so the redraw that shows new data does not immediately ask for it again.
  var inflight = {}, fetchedAt = {}, shownGen = {}, gen = 0;
  // Any change (a POST, PATCH or DELETE) can alter what other pages show, so after it nothing counts as fresh and no
  // request that started earlier is shared or trusted. The data already shown stays on screen until the refetch arrives.
  function changed() { gen++; inflight = {}; fetchedAt = {}; }
  // Opening a page is a new visit: it always asks for fresh data (something may have changed elsewhere: another tab, a
  // scheduled job). Only redraws of the page you are on use the 2-second window. Capture phase: runs before the router draws.
  window.addEventListener('hashchange', function () { fetchedAt = {}; }, true);
  // A page can register its own way of fetching a path (N.fetchers['/api/plan'] = function (path) { ... }), for example to add data from this browser.
  N.fetchers = {};
  function get(path) { var f = N.fetchers[path.split('?')[0]]; return f ? f(path) : api('GET', path); }
  function load(key, path) {
    if (!inflight[path]) { var g = gen, box = inflight; box[path] = get(path).then(function (d) { delete box[path]; if (g === gen) fetchedAt[path] = Date.now(); return { d: d, g: g }; }, function (e) { delete box[path]; throw e; }); }
    return inflight[path].then(function (r) { if (r.g >= (shownGen[key] || 0)) { N.cache[key] = r.d; shownGen[key] = r.g; } return N.cache[key]; });   // an older answer never replaces a newer one
  }
  function fresh(key, path) { return N.cache[key] && fetchedAt[path] && Date.now() - fetchedAt[path] < 2000; }
  // Fetch fresh data for a screen and redraw it only if something actually changed (otherwise every redraw would trigger another fetch).
  function stale(screen, keys) {
    var sig = function (k) { return JSON.stringify(N.cache[k[0]] || null, function (key, v) { return key === 'lastSeenAt' || key === 'generatedAt' || key === 'now' ? undefined : v; }); };   // these change on every fetch, so they must not trigger a redraw
    var before = keys.map(sig);
    if (keys.every(function (k) { return fresh(k[0], k[1]); }) && !N.loadErrors[screen]) return;
    Promise.all(keys.map(function (k) { return load(k[0], k[1]); })).then(function () {
      var changed = keys.some(function (k, i) { return sig(k) !== before[i]; }), hadError = !!N.loadErrors[screen];
      delete N.loadErrors[screen];
      if ((changed || hadError) && J.current() === screen) J.render(false);
    }).catch(function (e) { loadFailed(screen, e); });
  }
  // A page whose data could not be loaded shows a clear message with "Try again" instead of staying on "Loading…".
  // A page that already shows data keeps it and only tells you once.
  N.loadErrors = {};
  function loadFailed(screen, e) {
    if (e && e.status === 401) return;                                     // the sign-in screen is already shown
    N.loadErrors[screen] = e;
    if (J.current() !== screen) return;
    var holders = $$('#main .empty').filter(function (el) { return /^(Loading|Planning)/.test(el.textContent.trim()); });
    if (holders.length) holders.forEach(function (el) { el.outerHTML = errorBox(e); });
    else {                                                                  // part of the page loaded: the message goes on top and stays until it loads
      var old = $('#main > .load-error.top'); if (old) old.remove();
      var main = $('#main'), head = main && main.querySelector('.view-head');
      if (main) (head || main.firstChild) ? (head ? head.insertAdjacentHTML('afterend', errorBox(e, 'top')) : main.insertAdjacentHTML('afterbegin', errorBox(e, 'top'))) : null;
    }
  }
  function errorBox(e, where) {
    var off = e && e.code === 'offline';
    return '<div class="load-error' + (where ? ' ' + where : '') + '" role="alert"><b>' + esc(off ? 'No connection' : e && e.status === 429 ? 'Too many requests' : 'This page could not load') + '</b><p>' + esc(e && e.message ? e.message : 'Try again in a moment.') + '</p>' +
      '<button type="button" class="btn small" data-act="novaRetry">Try again</button></div>';
  }
  window.addEventListener('online', function () { if (N.user) { J.toast('Back online.'); J.render(false); } });
  function tile(label, value, note, tone) { return '<div class="panel stat' + (tone ? ' ' + tone : '') + '"><span><span class="label">' + esc(label) + '</span><b class="num"' + (/^\d+$/.test(String(value)) ? ' data-count="' + value + '"' : '') + '>' + esc(value) + '</b><small>' + esc(note) + '</small></span></div>'; }
  function name() { return N.user ? N.user.displayName : 'there'; }
  J.actions.novaRetry = function () { J.render(false); };
  N.previewCard = previewCard;
  N.h = { orb: orb, when: when, ago: ago, stale: stale, tile: tile, load: load, fail: fail, soon: soon, name: name, STATES: STATES };

  /* ================= screens ================= */
  var S = J.screens;
  Object.assign(J.titles, { life: 'Life Tracker', focus: 'Focus and Planner', insights: 'Weekly Insights', replay: 'Day Replay', briefing: 'Daily Briefing', dashboard: 'Dashboard', chat: 'NOVA Chat', voice: 'Voice Assistant', email: 'Smart Email', hub: 'Tasks and Calendar', proofloop: 'ProofLoop', automation: 'Automation Centre', identity: 'Personal Identity', memory: 'Memory Vault', knowledge: 'Knowledge Base', usage: 'AI Usage and Cost', connections: 'Connected Apps', security: 'Security and Settings', support: 'Help', whatif: 'What if I say yes?', weekreview: 'Weekly Review', journal: 'Decision Journal' });
  /* ---- Promise Orbit: open promises, deadlines and tasks circle the orb; distance = how soon, shape + colour + words = state ---- */
  var OSTATE = { overdue: 'Overdue', waiting: 'Waiting for proof', verified: 'Verified', normal: 'Open' }, OGLYPH = { overdue: '!', waiting: '…', verified: '✓', normal: '' };
  function orbitHTML() {
    var o = N.cache.orbit, sh = o ? o.shown : [], n = sh.length, total = o ? o.total : 0;
    var dots = sh.map(function (it, i) {
      var a = (-90 + i * 360 / n) * Math.PI / 180, r = it.state === 'overdue' ? 0.70 : it.days === null ? 0.92 : 0.72 + 0.20 * Math.min(Math.max(it.days, 0), 14) / 14;
      return '<button type="button" class="odot s-' + it.state + '" style="left:' + (50 + 50 * r * Math.cos(a)).toFixed(2) + '%;top:' + (50 + 50 * r * Math.sin(a)).toFixed(2) + '%" data-act="orbitOpen" data-id="' + it.kind + ':' + it.id + '" data-cap="' + esc(it.label + ' · ' + it.who) + '" aria-label="' + esc(it.label) + '"><span aria-hidden="true">' + OGLYPH[it.state] + '</span></button>';
    }).join('');
    var summary = !o ? 'Looking at what is open…' : total ? total + ' open' + (o.overdue ? ' · ' + o.overdue + ' overdue' : '') : 'Nothing open: a clear orbit.';
    var rows = sh.map(function (it) {
      return '<tr><td><button type="button" class="linklike" data-act="orbitOpen" data-id="' + it.kind + ':' + it.id + '">' + esc(it.title) + '</button><br><small class="muted">' + esc(it.who) + '</small></td><td><span class="ostate s-' + it.state + '">' + OSTATE[it.state] + '</span></td><td>' + esc(it.label.replace(/^.*, (?=[^,]*$)/, '')) + '</td></tr>';
    }).join('');
    return '<div class="orbit-stage"><div class="orbit" role="group" aria-label="Promise orbit: ' + esc(summary) + '">' + dots + '</div><div class="orbit-core">' + orb('big') + '</div>' +
      (o && o.more ? '<span class="chip orbit-more">+' + o.more + ' more</span>' : '') + '</div>' +
      '<p class="orbit-caption" id="orbitCaption" data-default="' + esc(summary) + '">' + esc(summary) + '</p>' +
      (n ? '<details class="orbit-list"><summary>Show as a list</summary><div class="table-wrap" tabindex="0" role="region" aria-label="Open promises, deadlines and tasks"><table class="cmds"><thead><tr><th scope="col">Item</th><th scope="col">State</th><th scope="col">When</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        (o.more ? '<p class="small-text muted">+' + o.more + ' more in <a href="#proofloop">ProofLoop</a> and <a href="#hub">Tasks and Calendar</a>.</p>' : '') + '</details>' : '');
  }
  function orbitWire() {
    var st = $('.orbit-stage'), cap = $('#orbitCaption'); if (!st || !cap) return;
    function show(e) { var d = e.target.closest && e.target.closest('.odot'); cap.textContent = d ? d.getAttribute('data-cap') : cap.getAttribute('data-default'); }
    ['mouseover', 'focusin'].forEach(function (ev) { st.addEventListener(ev, show); });
    ['mouseleave', 'focusout'].forEach(function (ev) { st.addEventListener(ev, function () { cap.textContent = cap.getAttribute('data-default'); }); });
  }
  J.actions.orbitOpen = function (id) {
    var p = String(id).split(':');
    if (p[0] === 'commitment') plDetail(+p[1]); else location.hash = 'hub';
  };
  S.dashboard = {
    render: function () {
      var m = N.cache.memories, u = N.cache.usage, a = N.cache.activity, convs = N.cache.conversations, ap = N.cache.approvals ? N.cache.approvals.approvals : null;
      var active = m ? m.memories.filter(function (x) { return x.status === 'active'; }).length : '…', proposed = (m ? m.memories.filter(function (x) { return x.status === 'proposed'; }).length : 0) + (ap ? ap.length : 0);
      var rules = 0, model = 0; if (u) u.byHandler.forEach(function (h) { if (h.handler === 'rules') rules += h.calls; else if (h.handler === 'claude' || h.handler === 'local-model') model += h.calls; });
      return '<section class="hero nova-hero"><div class="core-stage">' + orbitHTML() + '</div><div>' +
        '<p class="eyebrow">' + esc(J.longDate ? J.longDate(J.today()) : '') + ' · Dubai</p><h1 class="greet">Good ' + (new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening') + ', ' + esc(name()) + '</h1>' +
        '<p class="lead">' + esc((N.daily && N.daily.headline()) || 'From Request to Verified Result.') + '</p><p class="live" id="novaStatusText" role="status">NOVA: ' + esc(STATES[N.state]) + '</p>' +
        '<div class="btn-row"><a class="btn primary" href="#chat">Talk to NOVA</a><a class="btn" href="#briefing">Daily Briefing</a><a class="btn ghost" href="#memory">Memory Vault</a></div></div></section>' +
        (N.demo ? N.demo.banner() : '') + '<div class="stats">' + tile('Saved memories', active, 'approved by you') + tile('Waiting for approval', proposed, proposed ? 'memories and actions' : 'nothing pending', proposed ? 'gold' : '') +
        tile('Replies without AI', rules, 'free rule-based, this month') + tile('Replies from a model', N.session && N.session.aiProvider !== 'local' ? model : 'off', N.session && N.session.aiProvider !== 'local' ? (N.session.aiProvider === 'ollama' ? 'local model, free' : 'this month') : 'no AI model configured') + '</div>' +
        (ap && ap.length ? '<article class="panel gold" id="approvalsPanel"><h2 class="label">Waiting for your approval <span class="n">' + ap.length + '</span></h2>' + ap.map(function (x) { return previewCard({ id: x.runId, pendingApproval: x }); }).join('') + '</article>' : '') +
        (N.daily ? N.daily.dashboardStrip() : '') +
        '<div class="grid-2">' + plPanel() +
        '<article class="panel"><div class="panel-head"><h2 class="label">Recent activity (real)</h2><a class="btn small ghost" href="#chat">Chat</a></div>' +
          (a && a.activity.length ? '<ul class="mini-list">' + a.activity.slice(0, 5).map(function (x) { return '<li><span class="when">' + esc(ago(x.at)) + '</span><span class="what">' + esc(x.request) + '<small>' + esc(x.operation.replace(/_/g, ' ')) + ' · ' + esc(x.handler === 'rules' ? 'built-in rule' : x.handler) + ' · ' + esc(x.status.replace(/_/g, ' ')) + '</small></span></li>'; }).join('') + '</ul>' : J.empty(a ? 'No activity yet. Ask NOVA something in Chat.' : 'Loading…')) + '</article></div>' +
        '<article class="panel"><h2 class="label">What works today</h2><ul class="plain small-text"><li><b>Working:</b> ProofLoop commitments with evidence and receipts, voice with push-to-talk, sign-in, memories you approve, chat with built-in rules, tasks and notes that NOVA can create after you approve (with Undo where possible), activity history, usage ledger, data export and deletion.</li><li><b>Needs setup:</b> Claude answers (needs an API key; paid). Google sign-in (needs a free Google Client ID).</li><li><b>Daily use:</b> a daily briefing, scheduled jobs (Dubai time) with retries and history, notifications (in NOVA, browser, optional phone push), and Smart Email (Gmail read-only, or a labelled demo inbox).</li><li><b>Knowledge:</b> a Knowledge Base that answers from your own documents with the source passage, and Ctrl+K search across everything.</li></ul></article>' +
        (convs ? '' : '');
    },
    after: function () { orbitWire(); stale('dashboard', [['memories', '/api/memories'], ['usage', '/api/usage'], ['activity', '/api/activity'], ['approvals', '/api/approvals'], ['pl', '/api/proofloop/summary'], ['briefing', '/api/briefing'], ['orbit', '/api/orbit'], ['backup', '/api/backup']]); }
  };

  /* ---- chat ---- */
  var EDITABLE = { 'tasks.create': [['title', 'Task title', 'text'], ['due', 'Due date (YYYY-MM-DD, optional)', 'text']], 'notes.create': [['text', 'Note', 'text']], 'memory.add': [['text', 'Memory', 'text']] };
  // "What happens if": facts NOVA looked up in your own data before asking you to approve. null = the check itself failed; undefined = an older request made before this existed.
  function effectsHTML(fx) {
    if (fx === undefined) return 'Not checked for this request.';
    if (fx === null) return 'NOVA could not check what else this affects. Read the changes above carefully.';
    return fx.length ? '<ul class="plain">' + fx.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : 'No other effects found.';
  }
  function previewCard(run) {
    var a = run.pendingApproval; if (!a) return '';
    var p = a.preview;
    return '<section class="preview" role="group" aria-label="Review before NOVA acts"><p class="tag gold">Review before NOVA acts</p><dl class="kv">' +
      '<dt>Proposed action</dt><dd>' + esc(p.action) + '</dd><dt>Why</dt><dd>' + esc(p.reason) + '</dd><dt>Where</dt><dd>' + esc(p.target) + '</dd>' +
      '<dt>What will change</dt><dd>' + (p.changes.length ? '<ul class="plain">' + p.changes.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : 'Nothing') + '</dd>' +
      '<dt>Effects</dt><dd class="fx">' + effectsHTML(p.effects) + '</dd>' +
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
      return '<div class="msg bot"><p class="who mono">NOVA' + (m.badge ? ' <span class="tag dim badge" title="Where this reply was produced">' + esc(m.badge) + '</span>' : '') + '</p><p class="text">' + esc(text) + '</p>' + steps + prop + '</div>';
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
          '<p class="small-text muted">Enter sends, Shift+Enter adds a line. ' + (N.session && N.session.aiProvider === 'claude' ? 'A cloud AI model is connected; it can only propose, and you approve changes.' : N.session && N.session.aiProvider === 'ollama' ? 'A local model (Ollama, free, on your computer) helps NOVA understand everyday phrasing; it can only propose, and you approve changes.' : 'No AI model is connected, so NOVA understands fixed phrasings only and says so when it cannot answer.') + '</p></section></div>';
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
    c.msgs.push({ role: 'user', text: text }); c.draft = ''; c.busy = true; N.setState(N.session && N.session.aiProvider !== 'local' ? 'planning' : 'understanding'); J.render(false);
    return api('POST', '/api/chat', { message: text, conversationId: c.cid }).then(function (r) {
      c.cid = r.conversationId; c.busy = false;
      if (r.run) N.runs[r.run.id] = r.run;
      c.msgs.push({ role: 'assistant', text: r.reply, steps: r.steps, handler: r.handler, model: r.model, usage: r.usage, proposal: r.proposal, runId: r.run ? r.run.id : null, badge: r.badge });
      N.setState(r.status === 'failed' ? 'error' : r.status === 'awaiting_approval' ? 'waiting_approval' : 'completed');
      N.cache.activity = null; N.cache.memories = null; N.cache.usage = null; N.cache.approvals = null; N.cache.tasks = null;
      J.render(false);
      var ta = $('#novaMsg'); if (ta) ta.focus();            // keep the keyboard where the person was typing
      return r;
    }).catch(function (e) { c.busy = false; c.draft = text; c.msgs.push({ role: 'assistant', text: e.message + ' Your message is back in the box below, so you can send it again.', steps: [], handler: 'error' }); N.setState('error'); J.render(false); });
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
    N.runs[run.id] = run; if (N.hubRun && N.hubRun.id === run.id) N.hubRun = run; N.voicePending = null; N.cache.approvals = null; N.cache.tasks = null; N.cache.activity = null; N.cache.usage = null;
    N.setState(run.status === 'failed' ? 'error' : run.status === 'awaiting_approval' ? 'waiting_approval' : run.status === 'cancelled' ? 'idle' : 'completed');
    J.render(false);
  }
  function approveRun(id, edited) {
    N.setState('executing');
    return api('POST', '/api/approvals/' + id + '/approve', edited ? { editedInput: edited } : {}).then(afterRun).catch(function (e) { N.setState('error'); fail(e); });
  }
  function approvalById(id) { var list = []; Object.keys(N.runs).forEach(function (k) { if (N.runs[k].pendingApproval) list.push(N.runs[k].pendingApproval); }); ((N.cache.approvals || {}).approvals || []).forEach(function (a) { list.push(a); }); return list.filter(function (a) { return a.id === +id; })[0]; }
  // Task buttons on Tasks and Calendar: the same approval flow as chat, shown on the page
  function runBlockFor(run) {
    if (run.pendingApproval) return previewCard(run);
    return '<p class="tag ' + (run.status === 'completed' ? '' : 'gold') + '">' + esc(run.status === 'completed' ? 'Done and checked' : run.status.replace(/_/g, ' ')) + '</p><p class="small-text">' + esc(run.result || '') + '</p>';
  }
  function taskAction(tool, id) {
    api('POST', '/api/actions', { tool: tool, id: +id }).then(function (r) { N.runs[r.run.id] = r.run; N.hubRun = r.run; N.setState(r.run.status === 'awaiting_approval' ? 'waiting_approval' : 'completed'); J.render(false); var p = $('#hubPreview'); if (p) p.scrollIntoView({ block: 'nearest' }); }).catch(fail);
  }
  Object.assign(J.actions, {
    novaTaskDone: function (id) { taskAction('tasks.complete', id); },
    novaTaskDelete: function (id) { taskAction('tasks.delete', id); },
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

  /* ---- voice: push-to-talk, editable transcript, language, natural voices, spoken approvals ---- */
  N.voice = { mode: 'toggle', listening: false, transcript: '', interim: '', conf: null, error: null, ctl: null, onlineNote: '' };
  N.voiceLog = [];
  var provider = null;
  function speechProvider() { return provider || (provider = NovaSpeech.createBrowserProvider(window)); }
  function vLang() { return J.data.settings.voiceLang || 'en-GB'; }
  function vSet(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }
  function vPatch() {
    var v = N.voice, t = document.getElementById('vTranscript'), btn = document.getElementById('ptt');
    if (t && document.activeElement !== t) t.value = v.listening ? v.interim : v.transcript;
    if (btn) { btn.setAttribute('aria-pressed', String(v.listening)); btn.textContent = v.listening ? (v.mode === 'hold' ? 'Release to stop' : 'Stop listening') : (v.mode === 'hold' ? 'Hold to talk' : 'Start listening'); btn.classList.toggle('listening', v.listening); }
    vSet('vLive', v.listening ? 'Listening… speak now.' : v.transcript ? 'Check the words below, fix anything wrong, then press Send.' : '');
    var c = document.getElementById('vConf'); if (c) { c.hidden = v.listening || v.conf === null || !v.transcript; c.textContent = v.conf === null ? '' : 'The browser is ' + Math.round(v.conf * 100) + '% sure of these words' + (v.conf < 0.6 ? '. That is low: please read them carefully before sending.' : '. Speech recognition is never perfect, so always check.'); c.className = 'small-text ' + (v.conf !== null && v.conf < 0.6 ? 'red-text' : 'muted'); }
    var er = document.getElementById('vError'); if (er) { er.hidden = !v.error; er.innerHTML = v.error ? '<b>' + esc(v.error.title) + '</b>' + (v.error.steps.length ? '<ul class="plain">' + v.error.steps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') : ''; }
  }
  function vFail(code) { N.voice.error = NovaSpeech.explain(code, { lang: vLang(), firefox: /firefox/i.test(navigator.userAgent) }); }
  function vStart() {
    var v = N.voice; if (v.listening) return;
    v.error = null; v.transcript = ''; v.interim = ''; v.conf = null;
    var p = speechProvider();
    if (!p.supported) { vFail('unsupported'); vPatch(); return; }
    if (navigator.onLine === false) { vFail('offline'); vPatch(); return; }
    if (J.voice) { J.voice.stop(); if (J.voice.isWake()) J.voice.pauseWake(); }          // never listen to NOVA's own voice or run two recognisers
    v.listening = true; N.setState('listening'); vPatch();
    v.ctl = p.start({ lang: vLang(),
      onStart: function () { N.setState('listening'); },
      onInterim: function (t) { v.interim = t; if (t && N.state === 'listening') N.setState('transcribing'); vPatch(); },
      onFinal: function (t, c) { v.transcript = t; v.conf = c; },
      onError: function (code) { vFail(code); },
      onEnd: function (t, c) {
        v.listening = false; v.ctl = null; if (t) { v.transcript = t; v.conf = c; } else if (v.interim && !v.error) v.transcript = v.interim;
        if (!v.transcript && !v.error) vFail('no-speech');
        if (N.state === 'listening' || N.state === 'transcribing') N.setState('idle');
        vPatch(); if (J.voice && J.voice.isWake()) setTimeout(function () { J.voice.resumeWake(); }, 500);
        var tx = document.getElementById('vTranscript'); if (tx && v.transcript) tx.focus();
      } });
  }
  function vStop() { if (N.voice.ctl) N.voice.ctl.stop(); }
  function vSend() {
    var t = document.getElementById('vTranscript'), text = (t ? t.value : N.voice.transcript).trim();
    if (!text) { J.toast('Say or type something first.'); return; }
    N.voice.transcript = ''; N.voice.interim = ''; N.voice.conf = null; N.voice.error = null; vPatch();
    if (J.voice) J.voice.run(text); else J.toast('Voice is not available.');
  }
  document.addEventListener('nova:voicemsg', function (e) {
    N.voiceLog.push({ who: e.detail.who === 'you' ? 'you' : 'nova', text: e.detail.text }); if (N.voiceLog.length > 40) N.voiceLog.shift();
    var box = document.getElementById('vLog'); if (box) { box.innerHTML = vLogHTML(); box.scrollTop = box.scrollHeight; }
  });
  function vLogHTML() { return N.voiceLog.length ? N.voiceLog.map(function (m) { return '<div class="msg ' + (m.who === 'you' ? 'me' : 'bot') + '"><p class="who mono">' + (m.who === 'you' ? esc(name()) : 'NOVA') + '</p><p class="text">' + esc(m.text) + '</p></div>'; }).join('') : J.empty('Your conversation will appear here. Press the button and speak, or type below.'); }
  function voiceReport() {
    var vs = J.voice ? J.voice.voices() : [], r = NovaSpeech.report(vs);
    return !J.voice || !J.voice.supported.speak ? 'This browser cannot speak replies. Text replies still work.' :
      'This browser offers ' + r.total + ' voice' + (r.total === 1 ? '' : 's') + (r.natural.length ? ', ' + r.natural.length + ' of them natural-sounding (' + esc(r.natural.slice(0, 3).join(', ')) + (r.natural.length > 3 ? ', …' : '') + ').' : ', none of them natural-sounding.') +
      (r.hasAndrew ? (r.hasHD ? ' An Andrew HD voice is available.' : ' "Andrew" is available (not an HD variant).') : ' No "Andrew" voice here. Microsoft Edge usually offers "Microsoft Andrew Online (Natural)" (needs internet, free).');
  }
  S.voice = {
    render: function () {
      var v = N.voice, sr = speechProvider().supported, vs = J.voice ? J.voice.voices() : [], cur = J.voice && J.voice.chosenVoice(), st = J.data.settings;
      var opts = vs.filter(function (x) { return /^(en|ar)/i.test(x.lang); }).map(function (x) { return '<option value="' + esc(x.voiceURI) + '"' + (x.voiceURI === st.voiceURI ? ' selected' : '') + '>' + (NovaSpeech.isNatural(x) ? '★ ' : '') + esc(x.name) + ' (' + esc(x.lang) + ')</option>'; }).join('');
      var vp = N.voicePending;
        var heard = '<article class="panel"><h2 class="label">' + (sr ? 'What I heard' : 'Type or paste your request') + '</h2><div class="field"><label for="vTranscript">' + (sr ? 'Your words (edit them if the browser misheard)' : 'Type or paste what you want NOVA to do') + '</label><textarea id="vTranscript" rows="3" maxlength="2000" placeholder="' + (sr ? 'Press the button and speak, or type here' : 'Type or paste your request here') + '"></textarea></div>' +
          '<p id="vConf" class="small-text muted" hidden></p><div id="vError" class="login-msg" role="alert" hidden></div>' +
          '<div class="btn-row"><button type="button" class="btn primary" data-act="vSend">Send to NOVA</button><button type="button" class="btn ghost" data-act="vClear">Clear</button></div>' + (sr ? '' : '<p class="small-text muted">Typing follows the same rules as speaking: changes show a preview and wait for your approval. Typing "approve" only works for small changes that can be undone; anything else needs the Approve button.</p>') + '</article>';
      return J.head('Voice', 'Voice Assistant', 'Push to talk, check the words, send, and hear the answer. Typing always works too.', '') + (sr ? '' : heard) +
        '<div class="grid-2"><article class="panel center">' + orb('big') + '<p id="novaStatusText" role="status">NOVA: ' + esc(STATES[N.state]) + '</p><p class="small-text vbrowser" id="vBrowser">' + esc(NovaSpeech.browser(window).text) + '</p>' +
          '<button type="button" class="btn primary ptt" id="ptt" aria-pressed="false"' + (sr ? '' : ' disabled') + '>' + (v.mode === 'hold' ? 'Hold to talk' : 'Start listening') + '</button>' +
          '<fieldset class="seg-field"><legend class="sr-only">Push-to-talk style</legend><label class="check-chip"><input type="radio" name="vMode" value="toggle"' + (v.mode === 'toggle' ? ' checked' : '') + '>Click to start and stop</label><label class="check-chip"><input type="radio" name="vMode" value="hold"' + (v.mode === 'hold' ? ' checked' : '') + '>Hold to talk (also Space)</label></fieldset>' +
          '<p class="live" id="vLive" aria-live="polite"></p>' + (sr ? '' : '<p class="login-msg" role="alert">This browser cannot listen. Type your request below instead.</p>') + '</article>' +
        '<article class="panel"><h2 class="label">Language and voice</h2>' +
          '<div class="field"><label for="vLang">I am speaking</label><select id="vLang">' + NovaSpeech.LANGS.map(function (l) { return '<option value="' + l[0] + '"' + (vLang() === l[0] ? ' selected' : '') + '>' + esc(l[1]) + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="vVoice">NOVA\'s voice</label><select id="vVoice"><option value="">Automatic (a natural voice if this browser has one)</option>' + opts + '</select></div>' +
          '<p class="small-text muted" id="vVoiceNote">' + voiceReport() + (cur ? ' Using: ' + esc(cur.name) + '.' : '') + '</p>' +
          '<div class="btn-row"><button type="button" class="btn small" data-act="vTest">Test voice</button><button type="button" class="btn small ghost" data-act="vStopSpeak">Stop speaking</button></div>' +
          '<div class="field" style="margin-top:12px"><label for="rate">Speaking speed: <span class="mono" id="rateOut">' + (+st.rate || 1).toFixed(2) + '×</span></label><input id="rate" type="range" min="0.7" max="1.4" step="0.05" value="' + esc(st.rate || 1) + '" data-setting="rate"></div>' +
          '<label class="switch"><span class="txt"><b>Spoken replies</b><small>NOVA reads its answers aloud.</small></span><input type="checkbox" data-setting="voice"' + (st.voice !== false ? ' checked' : '') + '><span class="knob" aria-hidden="true"></span></label>' +
          '<label class="switch"><span class="txt"><b>Approve low-risk changes by voice</b><small>Say "approve" or "reject". Only for small, undoable changes. Deleting, forgetting and anything external always needs a button press.</small></span><input type="checkbox" data-setting="spokenApproval"' + (st.spokenApproval !== false ? ' checked' : '') + '><span class="knob" aria-hidden="true"></span></label></article></div>' + (sr ? heard : '') + (N.mic ? N.mic.panel() : '') +
        (vp ? '<article class="panel gold" id="vPending"><h2 class="label">Waiting for your approval</h2>' + previewCard({ id: vp.runId, pendingApproval: { id: vp.approvalId, tool: vp.tool, preview: vp.preview } }) + '<p class="small-text muted">' + (vp.voiceOk && st.spokenApproval !== false ? 'You can say "approve" or "reject", or use the buttons.' : 'This one needs a button press.') + '</p></article>' : '') +
        '<article class="panel"><h2 class="label">Conversation</h2><div class="chat-log" id="vLog" tabindex="0" aria-live="polite">' + vLogHTML() + '</div></article>' +
        '<article class="panel"><h2 class="label">What to know</h2><ul class="plain small-text"><li>Recognition is done by your browser\'s own service. Chrome and Edge send the audio to their vendor, so they need the internet; Firefox cannot listen. No paid speech service is used.</li><li>It is never perfect. That is why the words appear first, you can correct them, and nothing is sent until you press Send.</li><li>Voice is <b>never</b> used to prove who you are: only your signed-in account does that.</li><li>Wake word ("Hey NOVA") is experimental and is paused while you use push-to-talk.</li></ul></article>';
    },
    after: function () {
      var v = N.voice, ptt = document.getElementById('ptt'), tx = document.getElementById('vTranscript');
      vPatch(); var log = document.getElementById('vLog'); if (log) log.scrollTop = log.scrollHeight;
      if (ptt) {
        ptt.addEventListener('click', function (e) { if (v.mode === 'toggle' && e.detail !== 0 || (v.mode === 'toggle' && e.detail === 0 && !ptt.dataset.kd)) { v.listening ? vStop() : vStart(); } });
        ptt.addEventListener('pointerdown', function () { if (v.mode === 'hold') vStart(); });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { ptt.addEventListener(ev, function () { if (v.mode === 'hold' && v.listening) vStop(); }); });
        ptt.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); ptt.dataset.kd = '1'; if (v.mode === 'hold') vStart(); else (v.listening ? vStop() : vStart()); } });
        ptt.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); delete ptt.dataset.kd; if (v.mode === 'hold' && v.listening) vStop(); } });
      }
      $$('input[name="vMode"]').forEach(function (r) { r.addEventListener('change', function () { v.mode = r.value; vPatch(); }); });
      if (tx) { tx.addEventListener('input', function () { v.transcript = tx.value; });
        tx.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); vSend(); } }); }
      var lang = document.getElementById('vLang'); if (lang) lang.addEventListener('change', function () { J.data.settings.voiceLang = lang.value; J.persist(); if (J.voice) { J.voice.reloadVoices(); } J.render(false); });
      var vs = document.getElementById('vVoice'); if (vs) vs.addEventListener('change', function () { J.data.settings.voiceURI = vs.value; J.persist(); if (J.voice) J.voice.settingsChanged('voiceURI'); J.render(false); });
      if (J.voice && !J.voice.voices().length) setTimeout(function () { if (J.current() === 'voice') { J.voice.reloadVoices(); } }, 600);   // some browsers load their voice list late
    }
  };
  Object.assign(J.actions, {
    vSend: vSend, vClear: function () { N.voice.transcript = ''; N.voice.interim = ''; N.voice.conf = null; N.voice.error = null; vPatch(); var t = document.getElementById('vTranscript'); if (t) { t.value = ''; t.focus(); } },
    vTest: function () { if (J.voice) J.voice.speak('This is how I sound. If you can hear this, speech output is working.'); },
    vStopSpeak: function () { if (J.voice) J.voice.stop(); }
  });
  // Spoken approval: only for a waiting low-risk, undoable action (the server refuses anything else, even if this code were wrong).
  J.novaVoiceApproval = function (text) {
    if (N.mode !== 'server' || !N.user || !N.voicePending || !window.NovaSpeech) return null;
    var d = NovaSpeech.parseApproval(text); if (!d) return null;
    var p = N.voicePending;
    if (d === 'reject') return api('POST', '/api/approvals/' + p.approvalId + '/reject', {}).then(function (run) { afterRun(run); return 'Okay, I did not do it. Nothing was changed.'; }).catch(function (e) { return e.message; });
    if (!p.voiceOk || J.data.settings.spokenApproval === false) return Promise.resolve('I cannot approve that by voice. ' + (p.voiceOk ? 'Spoken approval is switched off in the Voice settings.' : 'It is not a small, undoable change, so it needs a button press in NOVA Chat or on the Dashboard.'));
    N.setState('executing');
    return api('POST', '/api/approvals/' + p.approvalId + '/approve', { via: 'voice' }).then(function (run) { afterRun(run); return run.result || 'Done.'; })
      .catch(function (e) { N.setState('error'); return e.code === 'voice_not_allowed' ? 'That needs a button press, not a spoken approval. Nothing was changed.' : e.message; });
  };

  /* Smart Email, Daily Briefing and Automation Centre live in nova-daily.js */
  /* ---- ProofLoop ---- */
  var PL_LANES = [['Needs your attention', function (c) { return c.overdue || c.status === 'awaiting_approval'; }], ['In progress', function (c) { return ['request_detected', 'request_understood', 'task_prepared', 'executing'].indexOf(c.status) >= 0; }],
    ['Submitted, waiting for confirmation', function (c) { return c.status === 'submitted' || c.status === 'awaiting_confirmation'; }], ['Verified and completed', function (c) { return c.status === 'verified' || c.status === 'completed'; }], ['Failed or cancelled', function (c) { return c.status === 'failed' || c.status === 'cancelled'; }]];
  function plTile(label, n, note, tone) { return tile(label, n, note, tone); }
  function plPanel() {
    var s = N.cache.pl;
    if (!s) return '<article class="panel" id="plPanel"><h2 class="label">ProofLoop</h2>' + J.empty('Loading…') + '</article>';
    return '<article class="panel" id="plPanel"><div class="panel-head"><h2 class="label">ProofLoop: request to verified result</h2><a class="btn small" href="#proofloop">Mission Control</a></div>' +
      '<p class="small-text muted" style="margin:0 0 10px"><b class="gold-text">' + s.iOwe + '</b> you owe · <b class="gold-text">' + s.owedToMe + '</b> owed to you · <b class="' + (s.overdue ? 'red-text' : 'gold-text') + '">' + s.overdue + '</b> overdue · <b class="gold-text">' + s.awaitingConfirmation + '</b> awaiting confirmation · <b class="gold-text">' + s.verified + '</b> verified</p>' +
      (s.attention.length ? '<ul class="mini-list">' + s.attention.slice(0, 4).map(function (c) { return '<li><span class="when">' + esc(c.deadline || 'no date') + '</span><span class="what">' + esc(c.title) + (c.isDemo ? ' <span class="tag sample">Demo</span>' : '') + '<small>' + esc(c.statusLabel) + (c.overdue ? ' · OVERDUE' : '') + ' · ' + (c.direction === 'owed_to_me' ? 'owed to you' : 'you owe') + '</small></span></li>'; }).join('') + '</ul>' : J.empty(s.total ? 'Nothing needs attention.' : 'No commitments yet. Say <q>remind me to send the proposal by Friday</q> in Chat, or load the demo scenarios in Mission Control.')) + '</article>';
  }
  function plCard(c) {
    return '<li class="item' + (c.overdue ? ' late' : '') + '"><div class="item-main"><p class="item-title">' + esc(c.title) + '</p><p class="item-meta"><span class="tag ' + (c.status === 'failed' ? 'red' : c.status === 'verified' || c.status === 'completed' ? '' : 'gold') + '">' + esc(c.statusLabel) + '</span>' + J.tag(c.direction === 'owed_to_me' ? 'Owed to me' : 'I owe', 'dim') +
      (c.counterparty ? '<span>' + esc(c.counterparty) + '</span>' : '') + (c.deadline ? '<span>due ' + esc(c.deadline) + '</span>' : '') + (c.overdue ? J.tag('Overdue', 'red') : '') + (c.isDemo ? J.tag('Demo', 'sample') : '') + '</p></div>' +
      '<div class="item-actions"><button type="button" class="btn small" data-act="plOpen" data-id="' + c.id + '">Open</button></div></li>';
  }
  S.proofloop = {
    render: function () {
      var s = N.cache.pl, d = N.cache.commitments, f = N.plFilter || 'all';
      var list = d ? d.commitments.filter(function (c) { return f === 'all' || (f === 'overdue' ? c.overdue : f === 'i_owe' || f === 'owed_to_me' ? c.direction === f && ['completed', 'failed', 'cancelled'].indexOf(c.status) < 0 : c.status === f); }) : [];
      var seen = {};   // each commitment sits in exactly one lane (the first that fits)
      var chips = [['all', 'All'], ['i_owe', 'I owe'], ['owed_to_me', 'Owed to me'], ['overdue', 'Overdue'], ['awaiting_approval', 'Awaiting approval'], ['awaiting_confirmation', 'Awaiting confirmation'], ['verified', 'Verified']];
      return J.head('Signature feature', 'ProofLoop Mission Control', 'Every commitment, tracked from request to verified result. A draft is not sent, "sent" is not delivered, and nothing is Verified without evidence.', '<a class="btn" href="/verify" target="_blank" rel="noopener">Check a receipt</a><button type="button" class="btn primary" data-act="plAdd">Add a commitment</button>') +
        (s ? '<div class="stats">' + plTile('I owe', s.iOwe, 'open') + plTile('Owed to me', s.owedToMe, 'open') + plTile('Awaiting approval', s.awaitingApproval, 'needs you', s.awaitingApproval ? 'gold' : '') + plTile('Overdue', s.overdue, 'past deadline', s.overdue ? 'red' : '') + plTile('Awaiting confirmation', s.awaitingConfirmation, 'not verified yet') + plTile('Verified', s.verified, 'with evidence') + '</div>' : J.empty('Loading…')) +
        (N.trust ? N.trust.panel() : '') +
        (s && s.demo ? '<article class="panel gold"><p style="margin:0"><span class="tag sample">Demo</span> <b>' + s.demo + ' fictional demo commitments are showing.</b> They use the real state machine and evidence rules, so you can try every state. <span class="btn-row" style="display:inline-flex;margin-left:8px"><button type="button" class="btn small" data-act="plDemoReset">Reset demo</button><button type="button" class="btn small ghost" data-act="plDemoRemove">Remove demo data</button></span></p></article>'
          : s && !s.total ? '<article class="panel"><p style="margin:0">No commitments yet. Say <q>remind me to send the proposal to the client by Friday</q> in <a href="#chat">Chat</a>, add one here, or <button type="button" class="btn small" data-act="plDemoLoad">load 9 demo scenarios</button> (fictional, clearly labelled).</p></article>' : s && !s.demo ? '<p class="small-text muted"><button type="button" class="btn small ghost" data-act="plDemoLoad">Load demo scenarios</button> (fictional examples you can remove again)</p>' : '') +
        '<div class="tabs" role="group" aria-label="Filter commitments">' + chips.map(function (c) { return '<button type="button" class="tab" data-act="plFilter" data-id="' + c[0] + '" aria-pressed="' + (f === c[0]) + '">' + c[1] + '</button>'; }).join('') + '</div>' +
        (!d ? J.empty('Loading…') : PL_LANES.map(function (l) { var rows = list.filter(function (c) { return !seen[c.id] && l[1](c); }); rows.forEach(function (c) { seen[c.id] = 1; }); return rows.length ? '<article class="panel"><h2 class="label">' + esc(l[0]) + ' <span class="n">' + rows.length + '</span></h2><ul class="items">' + rows.map(plCard).join('') + '</ul></article>' : ''; }).join('') || J.empty('Nothing matches this filter.'));
    },
    after: function () { stale('proofloop', [['pl', '/api/proofloop/summary'], ['commitments', '/api/commitments'], ['trust', '/api/proofloop/trust']]); }
  };
  function plReload(openId) {
    return Promise.all([load('pl', '/api/proofloop/summary'), load('commitments', '/api/commitments')]).then(function () { N.cache.approvals = null; J.render(false); if (openId) plDetail(openId); });
  }
  var EVIDENCE_LABEL = { draft: 'Draft (not an action)', submitted: 'Submitted (an action was taken)', acknowledged: 'Acknowledged (not acceptance)', verified: 'Verified (proof the outcome holds)', note: 'Note' };
  function plDetail(id) {
    api('GET', '/api/commitments/' + id).then(function (r) {
      var c = r.commitment;
      var html = '<div class="why"><p class="verdict ' + (c.status === 'failed' ? 'red' : c.status === 'verified' || c.status === 'completed' ? '' : 'gold') + '"><b>' + esc(c.statusLabel) + '.</b> ' + esc(c.reason || '') + (c.overdue ? ' <b>OVERDUE.</b>' : '') + (c.isDemo ? ' <span class="tag sample">Demo (fictional)</span>' : '') + '</p>' +
        '<p class="mono small-text muted">' + (c.direction === 'owed_to_me' ? 'Owed to me' : 'I owe') + (c.counterparty ? ' · ' + esc(c.counterparty) : '') + ' · due ' + esc(c.deadline || 'no date') + (c.followUpAt ? ' · follow up ' + esc(c.followUpAt) : '') + ' · source: ' + esc(c.source.type) + (c.source.ref ? ' (' + esc(c.source.ref) + ')' : '') + '</p>' +
        (c.next.length ? '<h3>Move it forward</h3><div class="btn-row">' + c.next.map(function (n) { return '<button type="button" class="btn small' + (n.to === 'failed' || n.to === 'cancelled' ? ' ghost' : '') + '" data-act="plMove" data-id="' + c.id + '" data-to="' + n.to + '">' + esc(n.label) + '</button>'; }).join('') + '</div><p class="small-text muted">NOVA refuses moves the evidence does not support, and tells you why.</p>' : '<p class="small-text muted">This commitment is finished.</p>') +
        '<h3>Evidence chain</h3>' + (c.evidence.length ? '<ul class="why-list">' + c.evidence.map(function (e) { return '<li class="' + (e.kind === 'verified' ? 'yes' : 'no') + '"><b>' + esc(EVIDENCE_LABEL[e.kind] || e.kind) + '</b>' + (e.kind === 'verified' ? (e.independent ? ' · independent check' : ' · self-reported') : '') + ': ' + esc(e.description) + ' <span class="muted small-text">' + esc(when(e.at)) + '</span></li>'; }).join('') + '</ul>' : '<p class="muted small-text">No evidence yet.</p>') +
        '<div id="plEvForm" class="field-row"><div class="field"><label for="plEvKind">Add evidence</label><select id="plEvKind"><option value="draft">Draft (not an action)</option><option value="submitted">Submitted (an action was taken)</option><option value="acknowledged">Acknowledged (not acceptance)</option><option value="verified">Verified: I confirm it is done</option><option value="note">Note</option></select></div>' +
          '<div class="field"><label for="plEvText">What happened?</label><input id="plEvText" type="text" maxlength="500"></div><button type="button" class="btn small" data-act="plAddEvidence" data-id="' + c.id + '">Add</button></div>' +
        '<h3>Timeline</h3><ol class="plain small-text">' + c.events.map(function (e) { return '<li><b>' + esc(e.toLabel) + '</b> · ' + esc(e.actor) + ' · ' + esc(when(e.at)) + (e.note ? ' · ' + esc(e.note) : '') + '</li>'; }).join('') + '</ol>' +
        (c.executions.length ? '<h3>Tool runs</h3><ul class="plain small-text">' + c.executions.map(function (e) { return '<li>#' + e.id + ' ' + esc(e.tool) + ' · ' + esc(e.status) + (e.evidence ? ' · ' + esc(e.evidence) : '') + (e.error ? ' · ' + esc(e.error) : '') + '</li>'; }).join('') + '</ul>' : '') +
        (c.approvals.length ? '<h3>Approvals</h3><ul class="plain small-text">' + c.approvals.map(function (a) { return '<li>#' + a.id + ' ' + esc(a.tool) + ' · ' + esc(a.status) + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="btn-row"><button type="button" class="btn primary" data-act="plReceipt" data-id="' + c.id + '">Export proof receipt (Markdown)</button><a class="btn" href="/api/commitments/' + c.id + '/receipt?format=html" target="_blank" rel="noopener">Printable receipt</a></div></div>';
      J.openForm({ title: c.title, submit: 'Close', hideCancel: true, noFocus: true, fields: [{ type: 'html', html: html }], onSave: function () {},
        after: function (root) { var t = root.querySelector('#plEvText'); if (t) t.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); root.querySelector('[data-act="plAddEvidence"]').click(); } }); } });
    }).catch(fail);
  }
  Object.assign(J.actions, {
    plOpen: function (id) { plDetail(id); },
    plAddEvidence: function (id) {
      var kind = $('#plEvKind').value, text = $('#plEvText').value.trim();
      if (!text) { J.toast('Describe what happened first.'); $('#plEvText').focus(); return; }
      api('POST', '/api/commitments/' + id + '/evidence', { kind: kind, description: text, refType: kind === 'verified' ? 'self' : undefined }).then(function () { J.closeForm(); J.toast('Evidence added.'); return plReload(id); }).catch(fail);
    },
    plFilter: function (id) { N.plFilter = id; J.render(false); },
    plMove: function (id, el) {
      var to = el.getAttribute('data-to');
      if (to === 'failed' || to === 'cancelled') { J.closeForm(); setTimeout(function () { J.openForm({ title: 'Why is it ' + (to === 'failed' ? 'failed' : 'cancelled') + '?', submit: 'Save', fields: [{ name: 'note', label: 'Reason (required)', required: true }], onSave: function (v) { api('POST', '/api/commitments/' + id + '/transition', { to: to, note: v.note }).then(function () { return plReload(id); }).catch(function (e) { fail(e); plDetail(id); }); } }); }, 60); return; }
      api('POST', '/api/commitments/' + id + '/transition', { to: to, note: '' }).then(function () { J.closeForm(); return plReload(id); }).catch(fail);
    },
    plAdd: function () {
      J.openForm({ title: 'Add a commitment', fields: [{ name: 'title', label: 'What is it?', required: true, placeholder: 'Send the updated proposal' }, { name: 'direction', label: 'Who owes it?', type: 'select', value: 'i_owe', options: [['i_owe', 'I owe it'], ['owed_to_me', 'Someone owes it to me']] }, { name: 'counterparty', label: 'Who with? (optional)', half: true }, { name: 'deadline', label: 'Deadline (YYYY-MM-DD, optional)', half: true }],
        onSave: function (v) { var o = { title: v.title, direction: v.direction }; if (v.counterparty) o.counterparty = v.counterparty; if (v.deadline) o.deadline = v.deadline; api('POST', '/api/commitments', o).then(function (r) { J.toast('Commitment added.'); return plReload(r.commitment.id); }).catch(fail); } });
    },
    plReceipt: function (id) { fetch('/api/commitments/' + id + '/receipt?format=md', { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('Could not create the receipt.'); return r.text(); }).then(function (t) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/markdown' })); a.download = 'proof-receipt-' + id + '.md'; document.body.appendChild(a); a.click(); a.remove(); J.toast('Receipt downloaded.'); }).catch(fail); },
    plDemoLoad: function () { api('POST', '/api/demo/load', {}).then(function (r) { J.toast(r.created ? '9 demo scenarios loaded (fictional).' : 'Demo data is already loaded.'); return plReload(); }).catch(fail); },
    plDemoReset: function () { api('POST', '/api/demo/reset', {}).then(function () { J.toast('Demo reset.'); return plReload(); }).catch(fail); },
    plDemoRemove: function () { J.confirm('Remove all demo (fictional) commitments? Your real ones stay.', 'Remove demo data', 'Remove demo data?').then(function (ok) { if (ok) api('POST', '/api/demo/reset', { reload: false }).then(function () { J.toast('Demo data removed.'); return plReload(); }).catch(fail); }); }
  });
  /* Knowledge Base, the command palette and app install live in nova-plus.js */

  /* ---- tasks and calendar hub ---- */
  S.hub = {
    render: function () {
      var t = J.today(), over = J.overdue().length, due = J.dueToday().length, week = J.dueWeek().length, nt = N.cache.tasks ? N.cache.tasks.tasks : null;
      return J.head('Planner', 'Tasks and Calendar', 'NOVA tasks live in the server database. The Classic tools below still keep their own tasks in this browser.', '<a class="btn primary" href="#chat">Ask NOVA to add a task</a>') +
        '<article class="panel"><h2 class="label">NOVA tasks (server) ' + (nt ? '<span class="n">' + nt.length + '</span>' : '') + '</h2>' +
          (!nt ? J.empty('Loading…') : nt.length ? '<ul class="items">' + nt.map(function (x) { return '<li class="item' + (x.status === 'done' ? ' done' : '') + '"><div class="item-main"><p class="item-title">' + esc(x.title) + '</p><p class="item-meta"><span>' + (x.status === 'done' ? 'Done' : 'Open') + '</span><span>' + (x.due ? 'due ' + esc(x.due) : 'no due date') + '</span><span>' + esc(x.source || '') + '</span></p></div><div class="item-actions">' + (x.status === 'done' ? '' : '<button type="button" class="btn small" data-act="novaTaskDone" data-id="' + x.id + '" aria-label="Mark ' + esc(x.title) + ' as done">Done</button>') + '<button type="button" class="btn small ghost" data-act="novaTaskDelete" data-id="' + x.id + '" aria-label="Delete ' + esc(x.title) + '">Delete</button></div></li>'; }).join('') + '</ul>' + (N.hubRun ? '<div id="hubPreview">' + runBlockFor(N.hubRun) + '</div>' : '') : J.empty('No NOVA tasks yet. In Chat, say <q>add a task to call HR by Friday</q>. You approve it first.')) +
          '<p class="small-text muted">Done and Delete show a preview first; nothing changes until you approve. You can also ask in Chat, for example <q>mark call HR as done</q>.</p></article>' +
        '<h2 class="section-title">Classic tools (this browser)</h2><div class="stats">' + tile('Overdue', over, 'tasks', over ? 'red' : '') + tile('Due today', due, J.fmt ? J.fmt(t) : t) + tile('This week', week, 'after today') + tile('Storage', 'Browser', 'moves to the server later') + '</div>' +
        '<div class="btn-row"><a class="btn" href="#tasks">Open Tasks</a><a class="btn" href="#calendar">Open Calendar</a><a class="btn" href="#notes">Notes</a></div>' +
        '<p class="small-text muted">Google and Outlook calendars connect from the browser (Tool settings). Gmail connects on the Smart Email page.</p>';
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
      var rows = u.byHandler.map(function (h) { return '<tr><th scope="row">' + esc(h.handler === 'rules' ? 'Built-in rules (no AI)' : h.handler === 'claude' ? 'Cloud AI model' : h.handler === 'local-model' ? 'Local model (free)' : h.handler === 'none' ? 'No AI model configured (honest fallback)' : h.handler === 'blocked' ? 'Blocked by spending limit' : h.handler) + '</th><td>' + h.calls + '</td><td>' + h.ok + '</td><td>' + h.inputTokens + '</td><td>' + h.outputTokens + '</td><td>' + h.cacheReadTokens + '</td><td>' + Math.round(h.durationMs / Math.max(1, h.calls)) + ' ms</td><td>' + (h.estCostUsd == null ? 'n/a' : '$' + h.estCostUsd.toFixed(4)) + '</td></tr>'; }).join('');
      return J.head('Monitor', 'AI Usage and Cost', 'Real numbers from the server\'s usage ledger for ' + esc(u.month) + '. Nothing here is invented.', '') +
        '<div class="stats">' + tile('AI provider', u.provider === 'claude' ? 'Claude' : 'None', u.model ? 'model ' + u.model : 'rules only: free') + tile('Monthly limit', u.monthlyLimitUsd == null ? 'None' : '$' + u.monthlyLimitUsd, u.monthlyLimitUsd == null ? 'set NOVA_MONTHLY_LIMIT_USD' : 'AI calls stop at the limit') + '</div>' +
        '<article class="panel"><h2 class="label">This month</h2>' + (rows ? '<div class="table-wrap" tabindex="0" role="region" aria-label="Table (scrolls sideways on small screens)"><table class="cmds"><thead><tr><th scope="col">Handled by</th><th scope="col">Calls</th><th scope="col">Succeeded</th><th scope="col">Input tokens</th><th scope="col">Output tokens</th><th scope="col">Cache-read tokens</th><th scope="col">Avg time</th><th scope="col">Est. cost</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : J.empty('No requests this month yet.')) +
        '<p class="small-text muted">' + esc(u.note) + ' Claude Code (the tool used to build NOVA) and the Claude API (used by a running NOVA) are billed separately.</p></article>';
    },
    after: function () { stale('usage', [['usage', '/api/usage']]); }
  };

  /* ---- connected apps ---- */
  S.connections = {
    render: function () {
      var st = N.cache.aistatus;
      function aiRow() {
        if (!st) return '<li><span class="grow"><b>AI model</b><br><span class="small-text muted">Checking…</span></span></li>';
        var local = st.provider === 'ollama', ok = local ? st.reachable && st.modelPulled : st.provider === 'claude' ? st.configured : false;
        var title = local ? 'Local model (Ollama, free): ' + (st.model || '') : st.provider === 'claude' ? 'Claude (cloud, paid)' : 'AI model';
        var status = local ? (st.reachable ? (st.modelPulled ? 'Ready' : 'Model not downloaded') : 'Not reachable') : st.provider === 'claude' ? (st.configured ? 'Configured' : 'No key') : 'Built-in rules only';
        var note = local ? (ok ? 'Understands everyday phrasing. It only proposes; you approve changes.' : (st.error || 'Ollama is running but the model is missing.')) : st.provider === 'claude' ? 'Text and tool proposals only.' : 'NOVA understands fixed phrasings only. A free local model fixes that.';
        return '<li><span class="grow"><b>' + esc(title) + '</b><br><span class="small-text muted">' + esc(note) + '</span>' + (ok ? '' : '<ol class="small-text" aria-label="Setup checklist">' + (st.setup || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>') + '</span>' + J.tag(status, ok ? '' : 'gold') + '</li>';
      }
      function row(n, status, tone, note, act) { return '<li><span class="grow"><b>' + esc(n) + '</b><br><span class="small-text muted">' + esc(note) + '</span></span>' + J.tag(status, tone) + (act || '') + '</li>'; }
      return J.head('Integrations', 'Connected Applications', 'Each connection shows its real status and permissions.', '') +
        '<article class="panel"><ul class="sources">' +
        row('NOVA server and database', 'Connected', '', 'SQLite database on the server that runs NOVA. Signed in as ' + (N.user ? N.user.email : '')) +
        aiRow() +
        row('Google Calendar (browser)', 'Browser-side', 'dim', 'Read-only or two-way, set up in Tool settings. Not yet connected through the server.', ' <a class="btn small" href="#settings">Open</a>') +
        row('Outlook / Microsoft 365 calendar (browser)', 'Browser-side', 'dim', 'Set up in Tool settings.', ' <a class="btn small" href="#settings">Open</a>') +
        (N.daily ? N.daily.connectionRows() : '') +
        row('Job collector (GitHub Action)', 'Separate', 'dim', 'Collects public job listings every 6 hours. See Jobs for you.', ' <a class="btn small" href="#matches">Open</a>') + '</ul></article>';
    },
    after: function () { stale('connections', [['aistatus', '/api/ai/status'], ['email', '/api/email'], ['notifs', '/api/notifications']]); }
  };

  /* ---- security and settings ---- */
  S.security = {
    render: function () {
      var ses = N.cache.sessions, au = N.cache.audit;
      return J.head('Protection', 'Security and Settings', 'Your sessions, your audit trail, and your data. You stay in control.', '<button type="button" class="btn" data-act="novaSignOut">Sign out</button>') +
        '<article class="panel"><div class="panel-head"><h2 class="label">Signed-in sessions</h2><button type="button" class="btn small" data-act="novaRevoke">Sign out other devices</button></div>' +
          (ses ? '<ul class="sources">' + ses.sessions.map(function (s) { return '<li><span class="grow"><b>' + (s.current ? 'This session' : 'Another session') + '</b><br><span class="small-text muted">started ' + esc(when(s.createdAt)) + ' · last active ' + esc(ago(s.lastSeenAt)) + ' · expires ' + esc(when(s.expiresAt)) + '</span></span></li>'; }).join('') + '</ul>' : J.empty('Loading…')) +
          '<p class="small-text muted">Sessions end after inactivity and after a maximum time. The cookie is HttpOnly and SameSite, so page scripts cannot read it.</p></article>' +
        '<article class="panel"><h2 class="label">What NOVA is allowed to do</h2>' + (N.cache.tools ? '<div class="table-wrap" tabindex="0" role="region" aria-label="Table (scrolls sideways on small screens)"><table class="cmds"><thead><tr><th scope="col">Tool</th><th scope="col">Kind</th><th scope="col">Asks you first?</th><th scope="col">Undo?</th></tr></thead><tbody>' + N.cache.tools.tools.map(function (t) { return '<tr><th scope="row">' + esc(t.name) + '<br><small class="muted">' + esc(t.description) + '</small></th><td>' + esc({ read: 'Reads only', write: 'Changes your NOVA data', destructive: 'Deletes', external: 'Affects another system' }[t.risk]) + '</td><td>' + (t.needsApproval ? 'Yes' : 'No') + '</td><td>' + (t.undoable ? 'Yes' : 'No') + '</td></tr>'; }).join('') + '</tbody></table></div>' : J.empty('Loading…')) + '<p class="small-text muted">NOVA can only use tools on this list. The server checks every request, runs nothing that fails validation, and re-reads the result to verify it.</p></article>' +
        '<article class="panel" id="themePanel"><h2 class="label" id="themeLabel">Appearance</h2><div class="theme-pick" role="radiogroup" aria-labelledby="themeLabel">' +
          [['dark', 'Deep Space', 'Dark, for evenings and focus'], ['light', 'Daylight', 'Light, for bright rooms']].map(function (t) { var on = N.theme() === t[0]; return '<button type="button" class="theme-opt t-' + t[0] + '" role="radio" aria-checked="' + on + '" data-act="novaTheme" data-id="' + t[0] + '"><i aria-hidden="true"></i><b>' + t[1] + '</b><small>' + t[2] + '</small></button>'; }).join('') +
          '</div><p class="small-text muted">Remembered in this browser. Both themes meet the WCAG AA contrast level.</p></article>' +
        (N.access ? N.access.panel() : '') +
        '<article class="panel" id="tourPanel"><h2 class="label">Guided tour</h2><p class="small-text muted">A six-step walk through the orb, the menu, Chat, the Promise Orbit, search and settings.</p><button type="button" class="btn small" data-act="tourStart">Show the tour again</button></article>' +
        '<article class="panel" id="installPanel"><h2 class="label">Install NOVA as an app</h2><p class="small-text muted">' + (N.install && N.install.installed() ? 'You are using the installed app.' : 'Open NOVA from your home screen or dock like any app, in its own window. Free; nothing is sent anywhere. Your data stays on the NOVA server.') + '</p>' +
          (N.install && N.install.can() ? '<button type="button" class="btn small primary" data-act="novaInstall">Install NOVA</button>' : (N.install && N.install.installed() ? '' : '<p class="small-text">In Chrome or Edge: the install icon in the address bar, or menu &gt; "Install NOVA". On iPhone (Safari): Share &gt; "Add to Home Screen". The browser only offers this on https or on this computer (127.0.0.1).</p>')) + '</article>' +
        '<article class="panel"><h2 class="label">Your data</h2><div class="btn-row"><button type="button" class="btn" data-act="novaExport">Download everything (JSON)</button><button type="button" class="btn danger" data-act="novaDeleteMem">Delete all my memories</button><button type="button" class="btn danger" data-act="novaDeleteAll">Delete my account and all data</button></div>' +
          '<p class="small-text muted">NOVA keeps your data until you delete it. An automatic retention schedule is not built yet.</p></article>' +
        (N.data ? N.data.panel() : '') +
        '<article class="panel"><h2 class="label">Audit log (your last 50 events)</h2>' + (au ? (au.entries.length ? '<ul class="mini-list">' + au.entries.map(function (e) { return '<li><span class="when">' + esc(ago(e.at)) + '</span><span class="what">' + esc(e.action.replace(/_/g, ' ')) + '<small>' + esc(e.detail || '') + '</small></span></li>'; }).join('') + '</ul>' : J.empty('Nothing yet.')) : J.empty('Loading…')) +
          '<p class="small-text muted">Tokens, keys and passwords are removed before anything is logged.</p></article>';
    },
    after: function () { stale('security', [['sessions', '/api/sessions'], ['audit', '/api/audit'], ['tools', '/api/tools']]); }
  };
  function typed(title, phrase, run) { J.openForm({ title: title, submit: 'Delete', fields: [{ type: 'html', html: '<p>This cannot be undone. Type <b>DELETE MY DATA</b> to confirm.</p>' }, { name: 'confirm', label: 'Confirmation', required: true }], onSave: function (v) { run(v.confirm); } }); }
  Object.assign(J.actions, {
    novaTheme: function (t) { N.setTheme(t); J.render(false); var b = $('.theme-opt.t-' + t); if (b) b.focus(); J.toast(t === 'light' ? 'Daylight theme on.' : 'Deep Space theme on.'); },
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
  function speakPreview(a, ok) {
    var p = a.preview, first = (p.changes && p.changes[0]) || '';
    return 'I would ' + String(p.action).toLowerCase() + '. ' + first.replace(/^New (?:task|note|memory|commitment): /, '') + '. ' + (p.undoable ? 'You can undo it.' : 'It cannot be undone.') + ' ' +
      (ok && J.data.settings.spokenApproval !== false ? 'Say approve or reject.' : 'This one needs a button press for safety: open NOVA Chat or the Dashboard.');
  }
  J.novaAsk = function (text) {
    if (N.mode !== 'server' || !N.user) return null;
    N.setState('understanding');
    return api('POST', '/api/chat', { message: text, conversationId: N.chat.cid }).then(function (r) {
      N.chat.cid = r.conversationId; if (r.run) N.runs[r.run.id] = r.run;
      N.setState(r.status === 'awaiting_approval' ? 'waiting_approval' : r.status === 'failed' ? 'error' : 'completed');
      N.cache.activity = null; N.cache.approvals = null; N.cache.tasks = null; N.cache.pl = null; N.cache.commitments = null;
      var a = r.run && r.run.pendingApproval; N.voicePending = a ? { approvalId: a.id, runId: r.run.id, tool: a.tool, voiceOk: !!(r.run.approvals.filter(function (x) { return x.id === a.id; })[0] || {}).voiceOk, preview: a.preview } : null;
      if (N.voicePending) return r.reply + ' ' + speakPreview(a, N.voicePending.voiceOk);
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
  function reveal() { document.documentElement.classList.remove('nova-wait'); }   // see boot.js
  function start() {
    fetch('/api/session', { credentials: 'same-origin' }).then(function (r) { if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) throw new Error('no server'); return r.json(); })
      .then(function (s) {
        N.mode = 'server'; N.session = s; document.body.classList.add('nova-server');
        document.title = 'NOVA'; var bt = $('.brand-text b'); if (bt) bt.textContent = 'NOVA';
        if (!s.authenticated) { showLogin(); return; }
        N.user = s.user; N.csrf = s.csrf; hideLogin(); buildNav(); observeVoice(); if (N.daily) N.daily.start();
        document.addEventListener('jarvis:rendered', reveal, { once: true });
        if (!location.hash || location.hash === '#today') location.hash = 'dashboard'; else J.render(true);
        N.setState('idle');
      })
      .catch(function () { N.mode = 'standalone'; var b = $('#staticBanner'); if (b) b.hidden = false; reveal(); });
  }
  var NOVA_VIEWS = NOVA_NAV.map(function (n) { return n[0]; });
  document.addEventListener('jarvis:rendered', function (e) { document.body.setAttribute('data-group', NOVA_VIEWS.indexOf(e.detail.view) >= 0 ? 'nova' : 'tools'); });
  document.addEventListener('DOMContentLoaded', start);
})();

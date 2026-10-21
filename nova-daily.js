/* NOVA daily use (server mode only): Daily Briefing, Smart Email (Gmail read-only or a labelled demo inbox), Automation Centre
   (scheduled jobs with run history) and the notification bell. Every number and list comes from the NOVA server. */
(function () {
  'use strict';
  var J = window.J, N = window.NOVA; if (!J || !N) return;
  var esc = J.esc, $ = J.$, $$ = J.$$, S = J.screens, H = function () { return N.h; };
  var D = N.daily = { unread: 0, lastId: 0, list: [], timer: 0, open: false, emailSel: null, filter: 'important', draft: null, started: false };
  var api = function (m, p, b) { return N.api(m, p, b); };
  var fail = function (e) { J.toast(e && e.message ? e.message : 'Something went wrong.'); };
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function dubaiHour() { return +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', hour12: false }).format(new Date()) % 24; }
  function phase() { var h = dubaiHour(); return h < 5 ? 'night' : h < 11 ? 'dawn' : h < 17 ? 'day' : h < 20 ? 'dusk' : 'night'; }
  function initials(n) { return String(n || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?'; }
  function hue(s) { var h = 0; String(s).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; }
  var PRI = { critical: ['Critical', 'red'], review: ['Check first', 'red'], important: ['Important', 'gold'], normal: ['Normal', ''], low: ['Low priority', 'dim'] };

  /* ================= notification bell ================= */
  function bellHTML() {
    return '<button type="button" class="chip bell" id="novaBell" aria-haspopup="true" aria-expanded="' + D.open + '" aria-controls="novaNotifs" title="Notifications">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>' +
      '<span class="sr-only">Notifications, </span><b class="bell-n" id="novaBellN"' + (D.unread ? '' : ' hidden') + '>' + D.unread + '</b><span class="sr-only">' + (D.unread ? ' unread' : 'none unread') + '</span></button>';
  }
  function panelHTML() {
    return '<div class="notif-head"><b>Notifications</b><span class="grow"></span><button type="button" class="btn small ghost" data-act="dReadAll">Mark all read</button></div>' +
      (D.list.length ? '<ul class="notif-list">' + D.list.map(function (n) {
        return '<li class="' + (n.read ? '' : 'unread') + ' k-' + esc(n.kind) + '"><button type="button" class="notif-item" data-act="dOpenNotif" data-id="' + n.id + '"><b>' + esc(n.title) + '</b><span>' + esc(n.body) + '</span><small class="mono">' + esc(H().ago(n.at)) + (n.push === 'sent' ? ' · sent to phone' : /^failed/.test(n.push || '') ? ' · phone push failed' : '') + '</small></button></li>';
      }).join('') + '</ul>' : '<p class="empty">No notifications yet. Your daily briefing and reminders will appear here.</p>') +
      '<p class="small-text muted notif-foot">' + (N.undo && N.undo.count() !== null ? '<a href="#replay" data-undo-link>' + (N.undo.count() ? 'Changes you can undo (' + N.undo.count() + ')' : 'Changes NOVA made for you') + '</a> · ' : '') + '<a href="#automation">Notification settings</a></p>';
  }
  function mountBell() {
    var host = $('.readouts'); if (!host) return;
    var b = $('#novaBell');
    if (!b) { host.insertAdjacentHTML('afterbegin', bellHTML()); b = $('#novaBell'); b.addEventListener('click', function (e) { e.stopPropagation(); togglePanel(); }); }
    var n = $('#novaBellN'); if (n) { n.hidden = !D.unread; n.textContent = D.unread > 99 ? '99+' : D.unread; }
    b.classList.toggle('has', !!D.unread);
  }
  function togglePanel(force) {
    D.open = force === undefined ? !D.open : force;
    var p = $('#novaNotifs');
    if (D.open) {
      if (!p) { p = document.createElement('div'); p.id = 'novaNotifs'; p.className = 'notif-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Notifications'); document.body.appendChild(p); }
      p.innerHTML = panelHTML(); p.hidden = false;
      H().load('undo', '/api/undo').then(function () { if (D.open) { var q = $('#novaNotifs'), f = q && q.contains(document.activeElement) ? document.activeElement : null, k = f && f.getAttribute('data-act'), id = f && f.getAttribute('data-id'); if (q) { q.innerHTML = panelHTML(); if (f) { var again = k ? q.querySelector('[data-act="' + k + '"][data-id="' + id + '"]') : null; if (again) again.focus(); } } } }).catch(function () { /* the link just does not show */ });
      var first = p.querySelector('button'); if (first) first.focus();
    } else if (p) p.hidden = true;
    var b = $('#novaBell'); if (b) b.setAttribute('aria-expanded', String(D.open));
  }
  document.addEventListener('click', function (e) { if (D.open && !e.target.closest('#novaNotifs, #novaBell')) togglePanel(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && D.open) { togglePanel(false); var b = $('#novaBell'); if (b) b.focus(); } });

  function poll(first) {
    if (!N.user) return Promise.resolve();
    return api('GET', '/api/notifications').then(function (r) {
      var fresh = r.notifications.filter(function (n) { return n.id > D.lastId && !n.read; });
      if (!first && fresh.length) browserPop(fresh);
      D.list = r.notifications; D.unread = r.unread; D.push = r.push;
      D.lastId = Math.max.apply(null, [D.lastId].concat(r.notifications.map(function (n) { return n.id; })));
      mountBell(); if (D.open) { var p = $('#novaNotifs'); if (p) p.innerHTML = panelHTML(); }
      if (fresh.length && J.current() === 'briefing') J.render(false);
    }).catch(function () { /* offline or signed out: try again next time */ });
  }
  // A system pop-up for each new notification, only if you allowed it in the browser and did not switch it off in NOVA.
  function browserPop(list) {
    if (J.data.settings.novaPopups === false || !('Notification' in window) || Notification.permission !== 'granted') return;
    list.slice(0, 3).forEach(function (n) { try { new Notification(n.title, { body: n.body, tag: 'nova-' + n.id }); } catch (e) { /* some browsers only allow this from a service worker */ } });
  }
  D.start = function () {
    if (D.started) return; D.started = true;
    mountBell(); poll(true);
    D.timer = setInterval(function () { if (document.visibilityState !== 'hidden') poll(false); }, J.data.settings.novaPollMs || 30000);
  };
  D.poll = poll;

  /* ================= Daily Briefing ================= */
  function briefingCard(b, opts) {
    opts = opts || {};
    var c = b.counts, load = c.overdue * 3 + c.today * 2 + c.followUps + c.approvals + c.importantEmail;
    var level = load === 0 ? ['Clear', 'ok', 8] : load < 5 ? ['Light', 'ok', 30] : load < 10 ? ['Moderate', 'gold', 60] : ['Heavy', 'red', 90];
    return '<section class="brief-hero theme-dark sky-' + phase() + '" aria-labelledby="briefTitle">' +
      '<div class="sky" aria-hidden="true"><i class="sun"></i><i class="ray"></i></div>' +
      '<div class="brief-top"><div>' + (opts.compact ? '<h2 id="briefTitle" class="label">Today at a glance' + (b.demo ? ' <span class="tag gold">includes demo data</span>' : '') + '</h2>' :   // on the dashboard the hero already greets you
        '<p class="eyebrow">' + esc(b.weekday + ' · ' + b.day) + ' · Dubai' + (b.demo ? ' · <span class="tag gold">includes demo data</span>' : '') + '</p>' +
        '<h2 id="briefTitle" class="brief-greet">' + esc(b.greeting) + '</h2><p class="brief-head">' + esc(b.headline) + '</p>') + '</div>' +
      '<div class="dayload ' + level[1] + '" role="img" aria-label="Day load: ' + level[0] + '"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" class="trk"/><circle cx="18" cy="18" r="15.5" pathLength="100" class="val" style="stroke-dasharray:' + level[2] + ' 100"/></svg><span><b>' + level[0] + '</b><small>day load</small></span></div></div>' +
      (b.focus ? '<a class="focus" href="' + esc(b.focus.link) + '"><span class="label">The one thing</span><b>' + esc(b.focus.text) + '</b><small>' + esc(b.focus.why) + '</small></a>' : '<p class="focus calm"><span class="label">The one thing</span><b>Nothing urgent.</b><small>A good day to get ahead on something you care about.</small></p>') +
      '<div class="brief-chips">' + [['Overdue', c.overdue, 'red'], ['Due today', c.today, ''], ['Follow-ups', c.followUps, 'gold'], ['Approvals', c.approvals, 'gold'], ['Important e-mail', c.importantEmail, ''], ['Done yesterday', c.doneYesterday, 'ok']].map(function (x) {
        return '<span class="bchip ' + (x[1] ? x[2] : 'zero') + '"><b>' + x[1] + '</b> ' + esc(x[0]) + '</span>'; }).join('') + '</div>' +
      (opts.actions === false ? '' : '<div class="btn-row"><button type="button" class="btn primary" data-act="dSpeakBrief">Read it to me</button><a class="btn" href="#briefing">Full briefing</a></div>') + '</section>';
  }
  function sectionsHTML(b) {
    return '<div class="brief-grid">' + b.sections.map(function (s) {
      return '<article class="panel brief-sec ' + esc(s.tone || '') + '"><h3 class="label">' + esc(s.title) + ' <span class="n">' + s.items.length + '</span></h3>' +
        (s.items.length ? '<ul class="brief-list">' + s.items.map(function (i) { return '<li class="' + esc(i.tone) + '"><a href="' + esc(i.link || '#') + '"><b>' + esc(i.text) + '</b>' + (i.sub ? '<small>' + esc(i.sub) + '</small>' : '') + '</a></li>'; }).join('') + '</ul>' : '<p class="empty">' + esc(s.empty || 'Nothing here.') + '</p>') + '</article>';
    }).join('') + '</div>';
  }
  D.headline = function () { var r = N.cache.briefing; return r && r.preview ? r.preview.headline : ''; };
  D.dashboardStrip = function () {
    var r = N.cache.briefing, w = N.cache.backup && N.cache.backup.warning;
    return (w ? '<div class="bk-warn" role="note"><b>Backup:</b> ' + esc(w) + ' <a class="btn small" href="#automation">Open the Automation Centre</a></div>' : '') + (r ? '<div class="dash-brief">' + briefingCard(r.preview, { compact: true }) + '</div>' : '');
  };
  function speakBrief() {
    var r = N.cache.briefing, b = r && (r.briefing && r.briefing.day === r.preview.day ? r.preview : r.preview);
    if (!b) return;
    if (J.voice && J.voice.speak && J.data.settings.voice && 'speechSynthesis' in window) { J.voice.speak(b.spoken); J.toast('Reading your briefing aloud.'); }
    else J.toast('Spoken replies are off or not available in this browser, so here it is: ' + b.spoken);
  }
  S.briefing = {
    render: function () {
      var r = N.cache.briefing;
      if (!r) return J.head('Daily', 'Daily Briefing', 'Loading…', '') + J.empty('Loading your briefing…');
      var b = r.preview, sched = N.cache.schedules && N.cache.schedules.schedules.filter(function (x) { return x.kind === 'briefing'; })[0];
      return J.head('Daily', 'Daily Briefing', 'Built from your tasks, ProofLoop commitments, approvals and e-mail. No AI needed, so it is free and works offline.',
        '<button type="button" class="btn" data-act="dSaveBrief">Save a copy</button>') +
        briefingCard(b, { actions: false }) +
        '<div class="btn-row brief-actions"><button type="button" class="btn primary" data-act="dSpeakBrief">Read it to me</button><button type="button" class="btn" data-act="dRefreshBrief">Refresh</button>' +
        '<span class="small-text muted">' + (sched ? (sched.enabled ? 'Next automatic briefing: ' + esc(sched.nextRunLabel) + '. ' : 'The automatic briefing is off. ') + '<a href="#automation">Change</a>' : '') + '</span></div>' +
        sectionsHTML(b) +
        '<article class="panel"><h2 class="label">Earlier briefings</h2>' + (r.history.length ? '<ol class="timeline">' + r.history.map(function (h) {
          return '<li><span class="mono when">' + esc(H().when(h.at)) + '</span><span><b>' + esc(h.headline) + '</b>' + (h.focus ? '<small>Focus: ' + esc(h.focus) + '</small>' : '') + '</span>' + J.tag(h.trigger === 'schedule' ? 'automatic' : 'saved by you', 'dim') + '</li>'; }).join('') + '</ol>' : '<p class="empty">None yet. The first automatic one arrives at the time set in the Automation Centre, or press "Save a copy".</p>') + '</article>';
    },
    after: function () { H().stale('briefing', [['briefing', '/api/briefing'], ['schedules', '/api/schedules']]); }
  };

  /* ================= Smart Email ================= */
  var FILTERS = [['important', 'Important'], ['critical', 'Critical'], ['needs_reply', 'Needs a reply'], ['deadline', 'Deadlines'], ['review', 'Check first'], ['tracked', 'Tracked'], ['low', 'Low priority'], ['all', 'All']];
  function connPanel(st) {
    if (st.connected) return '<article class="panel conn ok"><div class="conn-row"><span class="dot ok" aria-hidden="true"></span><div class="grow"><b>Gmail connected (read-only)</b><br><span class="small-text muted">' + esc(st.account || '') + ' · last checked ' + esc(st.lastSyncAt ? H().ago(st.lastSyncAt) : 'never') + '. NOVA reads headers and the short preview only, never sends.</span></div>' +
      '<button type="button" class="btn small" data-act="dSync">Check now</button><button type="button" class="btn small ghost" data-act="dDisconnect">Disconnect</button></div></article>';
    if (st.status === 'needs_reconnect') return '<article class="panel conn red"><b>Gmail needs reconnecting.</b><p class="small-text">' + esc(st.lastError || '') + '</p><button type="button" class="btn small primary" data-act="dConnect">Reconnect Gmail (read-only)</button> <button type="button" class="btn small ghost" data-act="dDisconnect">Remove</button></article>';
    return '<article class="panel conn"><div class="conn-row"><span class="dot" aria-hidden="true"></span><div class="grow"><b>Gmail is not connected</b><br><span class="small-text muted">NOVA would ask Google for read-only access only. Tokens are encrypted on the server. Nothing can be sent.</span></div>' +
      (st.canConnect ? '<button type="button" class="btn small primary" data-act="dConnect">Connect Gmail (read-only)</button>' : '') +
      (st.demoCount ? '<button type="button" class="btn small ghost" data-act="dDemoOff">Remove demo inbox</button>' : '<button type="button" class="btn small" data-act="dDemoOn">Try the demo inbox</button>') + '</div>' +
      (st.canConnect ? '' : '<details class="setup"><summary>How to connect your real Gmail (free)</summary><ol class="small-text" aria-label="Setup checklist">' + st.setup.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol></details>') + '</article>';
  }
  function mailRow(e) {
    var p = PRI[e.priority] || PRI.normal, sel = D.emailSel === e.id;
    return '<li class="mail p-' + esc(e.priority) + (sel ? ' sel' : '') + '"><button type="button" class="mail-btn" data-act="dOpenMail" data-id="' + e.id + '" aria-pressed="' + sel + '">' +
      '<span class="avatar" style="--h:' + hue(e.from.addr) + '" aria-hidden="true">' + esc(initials(e.from.name || e.from.addr)) + '</span>' +
      '<span class="mail-main"><span class="mail-top"><b class="from">' + esc(e.from.name || e.from.addr) + '</b>' + J.tag(p[0], p[1]) + (e.isDemo ? J.tag('Demo', 'gold') : '') + (e.commitmentId ? J.tag('In ProofLoop', 'dim') : '') + '<small class="mono when">' + esc(H().ago(e.at)) + '</small></span>' +
      '<span class="subj">' + esc(e.subject || '(no subject)') + '</span><span class="why">' + esc(e.reasons[0] || '') + '</span>' +
      (e.deadline ? '<span class="dl">Deadline: ' + esc(e.deadlineLabel) + '</span>' : '') + '</span></button></li>';
  }
  function mailDetail() {
    var d = N.cache.mail; if (!d || d.email.id !== D.emailSel) return '<article class="panel mail-detail empty-detail"><p class="empty">Pick a message to see why NOVA sorted it this way, write a draft reply or track it in ProofLoop.</p></article>';
    var e = d.email, p = PRI[e.priority] || PRI.normal, dr = d.drafts[0];
    return '<article class="panel mail-detail" aria-label="Message details"><p class="eyebrow">' + esc(e.from.name) + ' &lt;' + esc(e.from.addr) + '&gt;</p><h2 class="mail-subj">' + esc(e.subject || '(no subject)') + '</h2>' +
      '<p>' + J.tag(p[0], p[1]) + (e.isDemo ? ' ' + J.tag('Demo message (fictional)', 'gold') : '') + ' <span class="small-text muted">' + esc(H().when(e.at)) + '</span></p>' +
      '<blockquote class="snippet">' + esc(e.snippet) + '</blockquote>' +
      '<h3 class="label">Why NOVA sorted it this way</h3><ul class="reason-list">' + e.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
      (e.priority === 'review' ? '<p class="login-msg">This may be phishing. NOVA will not draft a reply or track it. Check with the sender another way (for example their official website or phone number).</p>' :
      '<div class="btn-row">' + (dr ? '' : '<button type="button" class="btn small primary" data-act="dDraft" data-id="' + e.id + '">Write a draft reply</button>') +
        (e.commitmentId ? '<a class="btn small" href="#proofloop">Open in ProofLoop</a>' : '<button type="button" class="btn small" data-act="dTrack" data-id="' + e.id + '">' + (e.promise ? 'Track their promise' : 'Track my reply') + ' in ProofLoop</button>') +
        (e.gmailUrl ? '<a class="btn small ghost" href="' + esc(e.gmailUrl) + '" target="_blank" rel="noopener noreferrer">Open in Gmail</a>' : '') + '</div>') +
      (dr ? '<section class="draft" aria-label="Draft reply"><h3 class="label">Draft reply <span class="tag dim">not sent</span></h3><label for="dDraftBody" class="sr-only">Draft text</label><textarea id="dDraftBody" rows="9" maxlength="5000">' + esc(dr.body) + '</textarea>' +
        '<div class="btn-row"><button type="button" class="btn small primary" data-act="dSaveDraft" data-id="' + dr.id + '">Save draft</button><button type="button" class="btn small" data-act="dCopyDraft">Copy</button><button type="button" class="btn small ghost" data-act="dDelDraft" data-id="' + dr.id + '">Delete draft</button>' +
        '<button type="button" class="btn small ghost" data-act="dSendDraft" data-id="' + dr.id + '" aria-describedby="sendNote">Send…</button></div>' +
        '<p class="small-text muted" id="sendNote">Written from a template (no AI). NOVA has read-only Gmail access and cannot send: copy it into Gmail when you are happy with it.</p></section>' : '') +
      '</article>';
  }
  S.email = {
    render: function () {
      var r = N.cache.email;
      if (!r) return J.head('Inbox', 'Smart Email', 'Loading…', '') + J.empty('Loading…');
      var st = r.status, list = r.emails;
      return J.head('Inbox', 'Smart Email', 'Your e-mail sorted by what needs you, with the reason for every decision. Read-only: NOVA never sends.', st.connected ? '<button type="button" class="btn" data-act="dSync">Check now</button>' : '') +
        (D.gmailMsg ? '<p class="gmail-msg ' + (D.gmailMsg.ok ? 'ok' : '') + '" role="status"><span>' + esc(D.gmailMsg.text) + '</span><button type="button" class="btn small ghost" data-act="dGmailMsgOff">Dismiss</button></p>' : '') +
        connPanel(st) +
        (r.counts.all ? '<div class="mail-filters" role="toolbar" aria-label="Filter messages">' + FILTERS.map(function (f) { return '<button type="button" class="chip-btn' + (D.filter === f[0] ? ' on' : '') + '" data-act="dFilter" data-id="' + f[0] + '" aria-pressed="' + (D.filter === f[0]) + '">' + esc(f[1]) + ' <b>' + (r.counts[f[0]] || 0) + '</b></button>'; }).join('') + '</div>' +
          '<div class="mail-grid"><article class="panel mail-list-panel"><h2 class="sr-only">Messages</h2>' + (list.length ? '<ul class="mail-list">' + list.map(mailRow).join('') + '</ul>' : '<p class="empty">No messages match this filter.</p>') + '</article>' + mailDetail() + '</div>'
          : '<article class="panel"><p class="empty">No e-mail yet. ' + (st.connected ? 'Press "Check now".' : 'Connect Gmail (read-only) or try the demo inbox to see how sorting works.') + '</p></article>');
    },
    after: function () {
      H().stale('email', [['email', '/api/email?filter=' + D.filter]]);
      var t = $('#dDraftBody'); if (t) t.addEventListener('input', function () { D.draftDirty = true; });
      var q = new URLSearchParams(location.search).get('gmail');
      if (q) { var MSG = { connected: 'Gmail connected (read-only). Press "Check now" to read your inbox.', denied: 'Gmail was not connected: you cancelled at Google.', scope: 'Google did not grant read access, so nothing was connected.', expired: 'That link expired. Please try again.', signed_out: 'Please sign in to NOVA first.', exchange: 'Google refused the connection. Check the server settings.', network: 'The server could not reach Google.', invalid: 'The answer from Google could not be verified, so nothing was connected.' };
        D.gmailMsg = { text: MSG[q] || 'Gmail: ' + q, ok: q === 'connected' }; J.toast(D.gmailMsg.text); history.replaceState(null, '', location.pathname + location.hash); J.render(false); }
    }
  };
  function reloadEmail() { return api('GET', '/api/email?filter=' + D.filter).then(function (r) { N.cache.email = r; return D.emailSel ? api('GET', '/api/email/' + D.emailSel).then(function (m) { N.cache.mail = m; }) : null; }).then(function () { J.render(false); }).catch(fail); }

  /* ================= Automation Centre ================= */
  var DAYS = [['daily', 'Every day'], ['weekdays', 'Monday to Friday'], ['weekends', 'Saturday and Sunday']];
  var RUN_TONE = { succeeded: 'ok', skipped: 'dim', failed: 'red', retrying: 'gold', running: 'gold', pending: 'dim' };
  function schedCard(s) {
    var l = s.lastRun;
    return '<article class="panel sched' + (s.enabled ? '' : ' off') + '" data-kind="' + esc(s.kind) + '"><div class="sched-head"><h3 class="label">' + esc(s.name) + '</h3>' +
      '<label class="switch mini"><span class="sr-only">' + esc(s.name) + ' on</span><input type="checkbox" data-sched="' + s.id + '" data-f="enabled"' + (s.enabled ? ' checked' : '') + '><span class="knob" aria-hidden="true"></span></label></div>' +
      '<p class="small-text muted">' + esc(s.description) + '</p>' +
      '<div class="sched-row"><div class="field"><label for="t' + s.id + '">Time (Dubai)</label><input id="t' + s.id + '" type="time" value="' + esc(s.time) + '" data-sched="' + s.id + '" data-f="time"></div>' +
      '<div class="field"><label for="d' + s.id + '">Days</label><select id="d' + s.id + '" data-sched="' + s.id + '" data-f="days">' + DAYS.map(function (d) { return '<option value="' + d[0] + '"' + (s.days === d[0] ? ' selected' : '') + '>' + d[1] + '</option>'; }).join('') + (DAYS.some(function (d) { return d[0] === s.days; }) ? '' : '<option selected value="' + esc(s.days) + '">' + esc(s.daysLabel) + '</option>') + '</select></div></div>' +
      '<dl class="kv small-text"><dt>Next run</dt><dd>' + esc(s.nextRunLabel) + '</dd><dt>Last run</dt><dd>' + (l ? J.tag(l.status, RUN_TONE[l.status]) + ' ' + esc(H().ago(l.finishedAt || l.startedAt || Date.now())) + (l.summary ? '<br><span class="muted">' + esc(l.summary) + '</span>' : '') + (l.error ? '<br><span class="red-text">' + esc(l.error) + '</span>' : '') : 'never') + '</dd></dl>' +
      '<button type="button" class="btn small" data-act="dRunNow" data-id="' + s.id + '">Run now</button></article>';
  }
  function channelsHTML() {
    var perm = 'Notification' in window ? Notification.permission : 'unsupported', push = D.push || {};
    return '<article class="panel"><h2 class="label">How NOVA reaches you</h2><ul class="sources">' +
      '<li><span class="grow"><b>In NOVA (the bell)</b><br><span class="small-text muted">Always on. Every notification is kept here.</span></span>' + J.tag('On', 'ok') + '</li>' +
      '<li><span class="grow"><b>Browser pop-ups</b><br><span class="small-text muted">' + (perm === 'granted' ? 'Allowed. Pop-ups appear while a NOVA tab is open.' : perm === 'denied' ? 'Blocked in this browser. Allow notifications for this site in the browser settings.' : perm === 'unsupported' ? 'This browser does not support notifications.' : 'Not allowed yet.') + '</span></span>' +
        (perm === 'default' ? '<button type="button" class="btn small" data-act="dAskPerm">Allow pop-ups</button>' : J.tag(perm === 'granted' ? (J.data.settings.novaPopups === false ? 'Off in NOVA' : 'On') : perm === 'denied' ? 'Blocked' : 'Unavailable', perm === 'granted' && J.data.settings.novaPopups !== false ? 'ok' : 'dim')) + '</li>' +
      '<li><span class="grow"><b>Phone push (ntfy, free)</b><br><span class="small-text muted">' + (push.ntfy ? 'Configured on the server. The topic name stays secret and is never shown here.' : 'Off. Install the free ntfy app, subscribe to a long random topic name, then set NOVA_NTFY_TOPIC on the server and restart. Anyone who knows the topic can read the messages, so keep it secret.') + '</span></span>' + J.tag(push.ntfy ? 'On' : 'Off', push.ntfy ? 'ok' : 'dim') + '</li></ul>' +
      '<label class="switch"><span class="txt"><b>Show browser pop-ups</b><small>Only if the browser allows them.</small></span><input type="checkbox" data-setting="novaPopups"' + (J.data.settings.novaPopups !== false ? ' checked' : '') + '><span class="knob" aria-hidden="true"></span></label>' +
      '<div class="btn-row"><button type="button" class="btn small" data-act="dTestNotif">Send a test notification</button></div></article>';
  }
  /* backups: the latest one in plain words, a restore test that never touches the live data, and what to keep safe */
  var BK = { busy: false, result: null, error: '' };
  function backupHTML() {
    var b = N.cache.backup; if (!b) return '<article class="panel" id="bkPanel"><h2 class="label">Backups</h2>' + J.empty('Loading…') + '</article>';
    if (!b.available) return '<article class="panel" id="bkPanel"><h2 class="label">Backups</h2><p class="small-text muted">' + esc(b.reason) + '</p></article>';
    var l = b.last, head;
    if (!l) head = '<p><b>No backup yet.</b> The Backup job saves one every night at 03:30 (Dubai). To make one now, press "Run now" on the Backup job above.</p>';
    else head = '<ul class="sources"><li><span class="grow"><b>Latest backup</b><br><span class="small-text">' + esc(H().when(l.createdAt)) + ' (' + (l.ageDays === 0 ? 'today' : l.ageDays === 1 ? 'yesterday' : l.ageDays + ' days ago') + ') · ' + esc(l.size) + ' · ' + b.count + ' kept of up to ' + b.keep + '</span>' + (l.problem ? '<br><span class="small-text">Problem: ' + esc(l.problem) + '.</span>' : '') + '</span>' + J.tag(l.integrity === 'ok' ? 'Checked, good' : 'Damaged', l.integrity === 'ok' ? 'ok' : 'warn') + '</li></ul>';
    var res = '';
    if (BK.busy) res = J.empty('Loading…');
    else if (BK.error) res = '<div class="load-error" role="alert"><b>The test could not run</b><p>' + esc(BK.error) + '</p></div>';
    else if (BK.result) {
      var t = BK.result, yours = t.yours ? Object.keys(t.yours).filter(function (k) { return t.yours[k]; }).map(function (k) { return t.yours[k] + ' ' + k; }).join(', ') : '';
      res = '<div class="bk-result ' + (t.ok ? 'ok' : 'bad') + '" role="status"><b>' + (t.ok ? 'This backup works.' : 'This backup did not pass.') + '</b> ' + esc(t.message) + (t.ok ? ' Your items in it: ' + esc(yours || 'none yet') + '.' : '') + '</div>';
    }
    return '<article class="panel" id="bkPanel"><h2 class="label">Backups</h2>' + head + '<div class="btn-row"><button type="button" class="btn" data-act="bkTest"' + (BK.busy || !l ? ' disabled' : '') + '>Test my latest backup</button></div>' + res +
      '<ul class="small-text bk-advice">' + b.advice.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></article>';
  }
  S.automation = {
    render: function () {
      var r = N.cache.schedules;
      if (!r) return J.head('Automation', 'Automation Centre', 'Loading…', '') + J.empty('Loading…');
      return J.head('Automation', 'Automation Centre', 'Jobs that run on the NOVA server at a Dubai time, even with this page closed. Each run is recorded; failed runs are retried, never duplicated.', '') +
        '<div class="sched-grid">' + r.schedules.map(schedCard).join('') + '</div>' + backupHTML() + channelsHTML() +
        '<article class="panel"><h2 class="label">Run history</h2>' + (r.runs.length ? '<div class="table-wrap" tabindex="0" role="region" aria-label="Run history (scrolls sideways)"><table class="cmds runs"><caption class="sr-only">Recent runs</caption><thead><tr><th scope="col">Job</th><th scope="col">When</th><th scope="col">How</th><th scope="col">Result</th><th scope="col">Attempts</th><th scope="col">Details</th></tr></thead><tbody>' +
          r.runs.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td class="mono">' + esc(H().when(x.startedAt || x.finishedAt)) + '</td><td>' + esc(x.trigger === 'manual' ? 'Run now' : 'Scheduled') + (x.missed ? ' <span class="small-text muted">(' + plural(x.missed, 'missed run') + ' merged)</span>' : '') + '</td><td>' + J.tag(x.status, RUN_TONE[x.status]) + '</td><td>' + x.attempts + '</td><td class="small-text">' + esc(x.error || x.summary || '') + (x.status === 'retrying' && x.nextAttemptAt ? ' Next try ' + esc(H().when(x.nextAttemptAt)) + '.' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="empty">No runs yet. Press "Run now" on a job to try it.</p>') +
        '<p class="small-text muted">Scheduler: ' + (r.scheduler.running ? 'running, checks every ' + r.scheduler.intervalSeconds + ' s' : 'not running in this server process (NOVA_SCHEDULER=off or a test server). "Run now" still works.') + ' · ' + esc(r.scheduler.timeZone) + '</p></article>';
    },
    after: function () {
      H().stale('automation', [['schedules', '/api/schedules'], ['notifs', '/api/notifications'], ['backup', '/api/backup']]);
      $$('[data-sched]').forEach(function (el) {
        el.addEventListener('change', function () {
          var f = el.getAttribute('data-f'), body = {}; body[f] = f === 'enabled' ? el.checked : el.value;
          api('PATCH', '/api/schedules/' + el.getAttribute('data-sched'), body).then(function (r) { J.toast(r.schedule.name + ': ' + (r.schedule.enabled ? 'next run ' + r.schedule.nextRunLabel : 'off')); return H().load('schedules', '/api/schedules'); }).then(function () { J.render(false); }).catch(function (e) { fail(e); J.render(false); });
        });
      });
    }
  };

  /* ================= connected apps rows ================= */
  D.connectionRows = function () {
    var e = N.cache.email && N.cache.email.status, n = N.cache.notifs;
    function row(t, status, tone, note, act) { return '<li><span class="grow"><b>' + esc(t) + '</b><br><span class="small-text muted">' + esc(note) + '</span></span>' + J.tag(status, tone) + (act || '') + '</li>'; }
    return row('Gmail (read-only)', !e ? 'Checking…' : e.connected ? 'Connected' : e.status === 'needs_reconnect' ? 'Needs reconnect' : e.demoCount ? 'Demo inbox' : 'Not connected', e && e.connected ? 'ok' : e && e.status === 'needs_reconnect' ? 'red' : 'dim',
        e ? (e.connected ? (e.account || '') + ' · scope: ' + e.scope + ' · sending: not available' : e.canConnect ? 'Ready to connect. NOVA asks only for read access.' : 'Needs setup: ' + e.setup.length + ' step' + (e.setup.length === 1 ? '' : 's') + ' (see Smart Email).') : '', ' <a class="btn small" href="#email">Open</a>') +
      row('Phone push (ntfy)', n ? (n.push.ntfy ? 'On' : 'Off') : 'Checking…', n && n.push.ntfy ? 'ok' : 'dim', n && n.push.ntfy ? 'Notifications are also pushed to your ntfy topic.' : 'Optional and free. Set NOVA_NTFY_TOPIC on the server.', ' <a class="btn small" href="#automation">Open</a>');
  };

  /* ================= actions ================= */
  Object.assign(J.actions, {
    dGmailMsgOff: function () { D.gmailMsg = null; J.render(false); },
    dReadAll: function () { api('POST', '/api/notifications/read-all', {}).then(function () { return poll(true); }).catch(fail); },
    dOpenNotif: function (id) {
      var n = D.list.filter(function (x) { return String(x.id) === String(id); })[0];
      api('POST', '/api/notifications/' + id + '/read', {}).then(function () { return poll(true); }).catch(function () {});
      togglePanel(false); if (n && n.link) location.hash = n.link.replace(/^#/, '');
    },
    dSpeakBrief: speakBrief,
    dRefreshBrief: function () { H().load('briefing', '/api/briefing').then(function () { J.render(false); J.toast('Briefing refreshed.'); }).catch(fail); },
    dSaveBrief: function () { api('POST', '/api/briefing', {}).then(function () { return H().load('briefing', '/api/briefing'); }).then(function () { J.render(false); J.toast('Saved a copy of today\'s briefing.'); }).catch(fail); },
    dFilter: function (f) { D.filter = f; N.cache.email = null; J.render(false); },
    dOpenMail: function (id) { D.emailSel = +id; api('GET', '/api/email/' + id).then(function (m) { N.cache.mail = m; J.render(false); var d = $('.mail-detail'); if (d && window.innerWidth < 900) d.scrollIntoView({ block: 'start' }); }).catch(fail); },
    dDemoOn: function () { api('POST', '/api/email/demo', {}).then(function (r) { J.toast('Loaded ' + r.added + ' demo messages (fictional).'); D.filter = 'important'; reloadEmail(); }).catch(fail); },
    dDemoOff: function () { api('POST', '/api/email/demo/remove', {}).then(function (r) { J.toast('Removed ' + r.removed + ' demo messages.'); D.emailSel = null; reloadEmail(); }).catch(fail); },
    dConnect: function () { api('POST', '/api/gmail/connect', {}).then(function (r) { location.href = r.url; }).catch(fail); },
    dDisconnect: function () {
      J.confirm('NOVA deletes its Gmail tokens and asks Google to revoke them. Messages already copied stay until you delete your data in Security.', 'Disconnect', 'Disconnect Gmail?').then(function (ok) { if (ok) disconnect(); });
    },
    dSync: function () { J.toast('Checking Gmail…'); api('POST', '/api/email/sync', {}).then(function (r) { J.toast('Read ' + plural(r.fetched, 'new message') + '.'); reloadEmail(); }).catch(function (e) { fail(e); reloadEmail(); }); },
    dDraft: function (id) { api('POST', '/api/email/' + id + '/draft', {}).then(function (r) { J.toast(r.note); return api('GET', '/api/email/' + id); }).then(function (m) { N.cache.mail = m; J.render(false); var t = $('#dDraftBody'); if (t) t.focus(); }).catch(fail); },
    dSaveDraft: function (id) { var t = $('#dDraftBody'); api('PATCH', '/api/email/drafts/' + id, { body: t ? t.value : '' }).then(function () { D.draftDirty = false; J.toast('Draft saved in NOVA. It has not been sent.'); }).catch(fail); },
    dCopyDraft: function () { var t = $('#dDraftBody'); if (!t) return; (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(function () { J.toast('Copied. Paste it into Gmail to send it yourself.'); }).catch(function () { t.select(); J.toast('Select all and copy, then paste into Gmail.'); }); },
    dDelDraft: function (id) { api('DELETE', '/api/email/drafts/' + id).then(function () { return api('GET', '/api/email/' + D.emailSel); }).then(function (m) { N.cache.mail = m; J.render(false); }).catch(fail); },
    dSendDraft: function (id) { api('POST', '/api/email/drafts/' + id + '/send', {}).catch(function (e) { J.toast(e.message); }); },
    dTrack: function (id) { api('POST', '/api/email/' + id + '/track', {}).then(function (r) { J.toast(r.direction === 'owed_to_me' ? 'Tracking their promise in ProofLoop (owed to you).' : 'Tracking your reply in ProofLoop.'); N.cache.pl = null; return reloadEmail(); }).catch(fail); },
    bkTest: function () {
      if (BK.busy) return; BK.busy = true; BK.error = ''; BK.result = null; J.render(false);
      api('POST', '/api/backup/test', {}).then(function (r) { BK.result = r; }).catch(function (e) { BK.error = e.message; }).then(function () {
        BK.busy = false; J.render(false); var b = $('button[data-act="bkTest"]'); if (b) b.focus({ preventScroll: true });
      });
    },
    dRunNow: function (id) { J.toast('Running…'); api('POST', '/api/schedules/' + id + '/run', {}).then(function (r) { J.toast(r.run.name + ': ' + r.run.status + (r.run.summary ? ', ' + r.run.summary : r.run.error ? ', ' + r.run.error : '')); return Promise.all([H().load('schedules', '/api/schedules'), poll(false)]); }).then(function () { J.render(false); }).catch(fail); },
    dAskPerm: function () { if (!('Notification' in window)) return; Promise.resolve(Notification.requestPermission()).then(function () { J.render(false); }); },
    dTestNotif: function () { api('POST', '/api/notifications/test', {}).then(function (r) { J.toast(r.notification ? 'Test sent' + (r.notification.push === 'sent' ? ' (also to your phone).' : r.notification.push && /^failed/.test(r.notification.push) ? '. Phone push failed: ' + r.notification.push.replace('failed: ', '') + '.' : '.') : 'Sent.'); return poll(false); }).catch(fail); }
  });
  function disconnect() { api('POST', '/api/gmail/disconnect', {}).then(function (r) { J.toast('Gmail disconnected' + (r.revokedAtGoogle ? ' and access revoked at Google.' : '. Tokens deleted.')); reloadEmail(); }).catch(fail); }
})();

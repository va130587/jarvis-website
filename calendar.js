/* NOVA calendar: Google Calendar (Google Identity Services + Calendar API v3), Outlook / Microsoft 365
   (MSAL.js + Microsoft Graph), .ics import / export, week and month views, sync, reminders, clashes and free time.
   Everything runs in the browser. Calendar data stays in this browser; access tokens are never saved to disk. */
(function () {
  'use strict';

  var J = window.J, ICS = window.NovaICS;
  var esc = J.esc, $ = J.$, $$ = J.$$, ui = J.ui;

  var GIS_SRC = 'https://accounts.google.com/gsi/client';
  var MSAL_SRC = 'vendor/msal-browser-4.30.0.min.js';
  var G_API = 'https://www.googleapis.com/calendar/v3';
  var MS_API = 'https://graph.microsoft.com/v1.0';
  var G_READ = 'https://www.googleapis.com/auth/calendar.readonly';
  var G_WRITE = 'https://www.googleapis.com/auth/calendar.events';
  var ORIGINS = ['https://va130587.github.io', 'http://localhost:8000'];
  var PALETTE = ['#4fd8ff', '#f5c46a', '#a78bfa', '#5fe3a1', '#ff8fa3', '#ffa94d', '#7cc4ff', '#e879f9'];
  var NAMES = { google: 'Google Calendar', microsoft: 'Outlook', ics: 'Calendar file' };
  var SYNC_EVERY = 15 * 60e3;
  var WINDOW_BACK = 30, WINDOW_AHEAD = 180; // days of events kept from connected calendars

  /* ================= settings ================= */
  function provDefaults() {
    return { clientId: '', mode: 'read', connected: false, account: '', calendars: [], lastSync: 0, lastError: '', push: { tasks: true, interviews: true, deadlines: true, edits: true }, pushed: {} };
  }
  function cfg() {
    var c = J.data.cal || (J.data.cal = {});
    // Fill in missing settings in place, so references to these objects stay valid.
    ['google', 'microsoft'].forEach(function (p) {
      var d = provDefaults(), o = c[p] || (c[p] = {});
      Object.keys(d).forEach(function (k) { if (o[k] === undefined) o[k] = d[k]; });
      Object.keys(d.push).forEach(function (k) { if (o.push[k] === undefined) o.push[k] = d.push[k]; });
    });
    if (!Array.isArray(c.ics)) c.ics = [];
    if (c.reminderMins == null) c.reminderMins = 15;
    c.workStart = c.workStart || '09:00';
    c.workEnd = c.workEnd || '18:00';
    if (!Array.isArray(c.workDays)) c.workDays = [1, 2, 3, 4, 5];
    if (!c.reminded || typeof c.reminded !== 'object') c.reminded = {};
    if (!Array.isArray(J.data.extEvents)) J.data.extEvents = [];
    return c;
  }
  function P(prov) { return NAMES[prov] || 'Calendar'; }

  /* ================= errors with plain-English fixes ================= */
  function redirectUri() { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'redirect.html'; }
  function originNote() { return ORIGINS.indexOf(location.origin) >= 0 ? '' : ' You are opening NOVA from ' + location.origin + ', so add that address too.'; }
  var MSG = {
    'not-connected': function (p) { return P(p) + ' is not connected. Open Settings → Calendar connections and click Connect.'; },
    'no-client-id': function (p) { return 'Paste your ' + (p === 'google' ? 'Google OAuth Client ID' : 'Microsoft Application (client) ID') + ' in Settings → Calendar connections first. The setup guide there shows how to get one for free.'; },
    'bad-client-id': function (p) { return p === 'google' ? 'That does not look like a Google Client ID. It should end with ".apps.googleusercontent.com".' : 'That does not look like a Microsoft Application (client) ID. It looks like 1a2b3c4d-1234-5678-9abc-1234567890ab.'; },
    'expired': function (p) { return 'Your ' + P(p) + ' sign-in has expired. Click Reconnect. Your NOVA data is safe.'; },
    'permission': function (p) { return P(p) + ' did not give NOVA permission for that. To let NOVA add or change events, choose "Two-way" and reconnect, then accept every permission.'; },
    'denied': function (p) { return 'You declined the ' + P(p) + ' permission request, so NOVA cannot read your calendar. Click Connect to try again.'; },
    'api-disabled': function () { return 'The Google Calendar API is not turned on in your Google Cloud project. Follow step 2 of the setup guide, then reconnect.'; },
    'offline': function (p) { return 'You are offline. NOVA will sync ' + P(p) + ' when you are back online. Your data is safe.'; },
    'popup-blocked': function () { return 'Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.'; },
    'popup-closed': function (p) { return p === 'google'
      ? 'The Google sign-in window closed before finishing. If Google showed "origin_mismatch" or "invalid_client", check your Client ID and that ' + location.origin + ' is listed under Authorised JavaScript origins.' + originNote()
      : 'The Microsoft sign-in window closed before finishing. Click Connect to try again.'; },
    'bad-client': function (p) { return p === 'google'
      ? 'Google rejected the Client ID. Check you copied the whole Client ID, that it is a "Web application" client, and that ' + location.origin + ' is an Authorised JavaScript origin.' + originNote()
      : 'Microsoft could not find that Application (client) ID. Copy it again from Azure → App registrations → Overview.'; },
    'redirect': function () { return 'Microsoft says the sign-in address is not registered. In Azure → App registrations → Authentication, add this Single-page application redirect URI: ' + redirectUri(); },
    'spa': function () { return 'In Azure, the redirect URI must be under "Single-page application" (not "Web"). Move it there in App registrations → Authentication, then try again.'; },
    'not-found': function (p) { return 'That event no longer exists in ' + P(p) + '. NOVA will refresh your calendar.'; },
    'read-only': function () { return 'This event is read-only here. Change it in the original calendar app.'; },
    'unknown': function (p, d) { return P(p) + ' error: ' + (d || 'something went wrong') + '. Try again in a moment.'; }
  };
  function calErr(code, prov, detail) {
    var e = new Error((MSG[code] || MSG.unknown)(prov, detail));
    e.code = code; e.prov = prov;
    return e;
  }
  function offline() { return navigator.onLine === false; }

  /* ================= script loading ================= */
  var scripts = {};
  function loadScript(src) {
    if (scripts[src]) return scripts[src];
    scripts[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { delete scripts[src]; reject(calErr(offline() ? 'offline' : 'unknown', src.indexOf('google') >= 0 ? 'google' : 'microsoft', 'could not load the sign-in library')); };
      document.head.appendChild(s);
    });
    return scripts[src];
  }

  /* ================= Google ================= */
  var G = { token: '', exp: 0, scope: '', needsReconnect: false };
  (function restore() {
    try { var s = JSON.parse(sessionStorage.getItem('jarvis.gtoken') || 'null'); if (s && s.exp > Date.now() + 60e3) { G.token = s.token; G.exp = s.exp; G.scope = s.scope; } } catch (e) { /* none */ }
  })();
  function gScopes() { return cfg().google.mode === 'two-way' ? [G_READ, G_WRITE] : [G_READ]; }
  function gTokenValid() { return G.token && G.exp > Date.now() + 30e3; }
  function gAuth(prompt) {
    var c = cfg().google;
    if (!c.clientId) return Promise.reject(calErr('no-client-id', 'google'));
    if (offline()) return Promise.reject(calErr('offline', 'google'));
    return loadScript(GIS_SRC).then(function () {
      return new Promise(function (resolve, reject) {
        var needed = gScopes();
        var tc = window.google.accounts.oauth2.initTokenClient({
          client_id: c.clientId, scope: needed.join(' '), include_granted_scopes: true,
          callback: function (r) {
            if (r.error) {
              return reject(calErr(r.error === 'access_denied' ? 'denied' : /invalid_client|unauthorized_client|origin/.test(r.error) ? 'bad-client' : 'unknown', 'google', r.error_description || r.error));
            }
            if (!window.google.accounts.oauth2.hasGrantedAllScopes.apply(null, [r].concat(needed))) {
              // e.g. two-way was requested but only read access was ticked
              G.token = ''; return reject(calErr(needed.length > 1 ? 'permission' : 'denied', 'google'));
            }
            G.token = r.access_token; G.exp = Date.now() + ((+r.expires_in || 3600) - 60) * 1000; G.scope = r.scope; G.needsReconnect = false;
            try { sessionStorage.setItem('jarvis.gtoken', JSON.stringify({ token: G.token, exp: G.exp, scope: G.scope })); } catch (e) { /* private mode */ }
            resolve(G.token);
          },
          error_callback: function (e) { reject(calErr(e && e.type === 'popup_failed_to_open' ? 'popup-blocked' : 'popup-closed', 'google')); }
        });
        tc.requestAccessToken({ prompt: prompt == null ? '' : prompt });
      });
    });
  }
  function gFetch(path, opts) {
    opts = opts || {};
    if (offline()) return Promise.reject(calErr('offline', 'google'));
    if (!gTokenValid()) { G.needsReconnect = true; return Promise.reject(calErr('expired', 'google')); }
    return fetch(G_API + path, { method: opts.method || 'GET', headers: { Authorization: 'Bearer ' + G.token, 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .catch(function () { throw calErr(offline() ? 'offline' : 'unknown', 'google', 'could not reach Google'); })
      .then(function (r) {
        if (r.status === 204) return null;
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (r.ok) return body;
          var reason = body && body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason;
          if (r.status === 401) { G.token = ''; G.needsReconnect = true; try { sessionStorage.removeItem('jarvis.gtoken'); } catch (e) { /* ignore */ } throw calErr('expired', 'google'); }
          if (r.status === 403) throw calErr(reason === 'accessNotConfigured' ? 'api-disabled' : 'permission', 'google');
          if (r.status === 404 || r.status === 410) throw calErr('not-found', 'google');
          throw calErr('unknown', 'google', body && body.error && body.error.message);
        });
      });
  }
  function gEventToExt(e, cal) {
    var o = { src: 'google', calId: cal.id, id: e.id, title: e.summary || '(No title)', location: e.location || '', url: e.htmlLink || '', writable: !!cal.writable,
      jarvisId: e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.jarvisId || '' };
    if (e.start && e.start.date) { o.allDay = true; o.date = e.start.date; o.endDate = (e.end && e.end.date) || ICS.addDaysIso(e.start.date, 1); o.start = ICS.dubaiTs(o.date, '00:00'); o.end = ICS.dubaiTs(o.endDate, '00:00'); }
    else { o.allDay = false; o.start = Date.parse(e.start && e.start.dateTime); o.end = Date.parse(e.end && e.end.dateTime) || o.start; }
    o.key = 'google:' + cal.id + ':' + e.id;
    return isNaN(o.start) ? null : o;
  }
  function gSync() {
    var c = cfg().google;
    return gFetch('/users/me/calendarList').then(function (list) {
      var old = {};
      c.calendars.forEach(function (x) { old[x.id] = x; });
      c.calendars = (list.items || []).filter(function (x) { return !x.deleted; }).map(function (x, i) {
        var o = old[x.id];
        if (x.primary) c.account = x.id;
        return { id: x.id, name: x.summaryOverride || x.summary || x.id, color: o ? o.color : (x.backgroundColor || PALETTE[i % PALETTE.length]), show: o ? o.show : (x.primary || x.selected !== false), primary: !!x.primary, writable: x.accessRole === 'owner' || x.accessRole === 'writer' };
      });
      var from = new Date(Date.now() - WINDOW_BACK * 864e5).toISOString(), to = new Date(Date.now() + WINDOW_AHEAD * 864e5).toISOString();
      var shown = c.calendars.filter(function (x) { return x.show; });
      return Promise.all(shown.map(function (cal) {
        return gFetch('/calendars/' + encodeURIComponent(cal.id) + '/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=' + encodeURIComponent(from) + '&timeMax=' + encodeURIComponent(to))
          .then(function (r) { return (r.items || []).filter(function (e) { return e.status !== 'cancelled'; }).map(function (e) { return gEventToExt(e, cal); }).filter(Boolean); });
      }));
    }).then(function (lists) {
      var evs = [].concat.apply([], lists);
      // Recover links between NOVA tasks and events NOVA created earlier (for example after importing a backup).
      evs.forEach(function (e) { if (e.jarvisId && !c.pushed[e.jarvisId] && J.byId(J.data.tasks, e.jarvisId)) c.pushed[e.jarvisId] = { id: e.id, sig: '', title: e.title }; });
      J.data.extEvents = J.data.extEvents.filter(function (e) { return e.src !== 'google'; }).concat(evs);
      return evs.length;
    });
  }
  function gBody(t) {
    var ev = taskTimes(t), b = { summary: J.taskPhrase(t), description: 'Added by NOVA' + (t.person ? ' · ' + t.person : ''), extendedProperties: { private: { jarvisId: t.id } } };
    if (ev.allDay) { b.start = { date: ev.date }; b.end = { date: ev.endDate }; }
    else { b.start = { dateTime: local(ev.start), timeZone: J.TZ }; b.end = { dateTime: local(ev.end), timeZone: J.TZ }; }
    return b;
  }
  function gExtBody(e) {
    return e.allDay ? { summary: e.title, start: { date: e.date }, end: { date: e.endDate } } : { summary: e.title, start: { dateTime: local(e.start), timeZone: J.TZ }, end: { dateTime: local(e.end), timeZone: J.TZ } };
  }
  function local(ts) { var p = ICS.dubaiParts(ts); return p.date + 'T' + p.time + ':00'; }

  /* ================= Microsoft ================= */
  var M = { app: null, appClient: '', account: null, needsReconnect: false };
  function msScopes() { return [cfg().microsoft.mode === 'two-way' ? 'Calendars.ReadWrite' : 'Calendars.Read', 'User.Read']; }
  function msMapErr(e) {
    var s = String((e && (e.errorCode + ' ' + e.message)) || e);
    if (e && e.code && MSG[e.code]) return e;
    if (/user_cancelled|popup.*closed|window closed/i.test(s)) return calErr('popup-closed', 'microsoft');
    if (/popup_window_error|empty_window_error|blocked/i.test(s)) return calErr('popup-blocked', 'microsoft');
    if (/AADSTS700016|unauthorized_client|invalid_client|application.*not found/i.test(s)) return calErr('bad-client', 'microsoft');
    if (/AADSTS50011|redirect.?uri/i.test(s)) return calErr('redirect', 'microsoft');
    if (/AADSTS9002326|9002327|cross-origin token redemption|single-page application/i.test(s)) return calErr('spa', 'microsoft');
    if (/AADSTS65004|consent_required|access_denied|declined/i.test(s)) return calErr('denied', 'microsoft');
    if (/interaction_required|login_required|InteractionRequired|no_account|no_tokens/i.test(s)) return calErr('expired', 'microsoft');
    if (offline() || /network|fetch/i.test(s)) return calErr('offline', 'microsoft');
    return calErr('unknown', 'microsoft', (e && e.message) || s);
  }
  function msApp() {
    var c = cfg().microsoft;
    if (!c.clientId) return Promise.reject(calErr('no-client-id', 'microsoft'));
    if (M.app && M.appClient === c.clientId) return Promise.resolve(M.app);
    return loadScript(MSAL_SRC).then(function () {
      var app = new window.msal.PublicClientApplication({
        auth: { clientId: c.clientId, authority: 'https://login.microsoftonline.com/common', redirectUri: redirectUri() },
        cache: { cacheLocation: 'localStorage' }
      });
      return Promise.resolve(app.initialize()).then(function () {
        M.app = app; M.appClient = c.clientId;
        M.account = app.getAllAccounts()[0] || null;
        return app;
      });
    });
  }
  function msLogin() {
    if (offline()) return Promise.reject(calErr('offline', 'microsoft'));
    return msApp().then(function (app) { return app.loginPopup({ scopes: msScopes(), prompt: 'select_account' }); })
      .then(function (r) { M.account = r.account; M.needsReconnect = false; cfg().microsoft.account = r.account && r.account.username || ''; return r.accessToken; })
      .catch(function (e) { throw msMapErr(e); });
  }
  function msToken(interactive) {
    return msApp().then(function (app) {
      if (!M.account) throw calErr(interactive ? 'not-connected' : 'expired', 'microsoft');
      return Promise.resolve(app.acquireTokenSilent({ scopes: msScopes(), account: M.account })).then(function (r) { M.needsReconnect = false; return r.accessToken; }, function (e) {
        if (!interactive) { M.needsReconnect = true; throw msMapErr(e).code === 'offline' ? msMapErr(e) : calErr('expired', 'microsoft'); }
        return app.acquireTokenPopup({ scopes: msScopes(), account: M.account }).then(function (r) { M.needsReconnect = false; return r.accessToken; });
      });
    }).catch(function (e) { throw msMapErr(e); });
  }
  function msFetch(path, opts, interactive) {
    opts = opts || {};
    if (offline()) return Promise.reject(calErr('offline', 'microsoft'));
    return msToken(interactive).then(function (token) {
      var headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'outlook.timezone="UTC"' };
      return fetch(/^https:/.test(path) ? path : MS_API + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
        .catch(function () { throw calErr(offline() ? 'offline' : 'unknown', 'microsoft', 'could not reach Microsoft'); });
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (r.ok) return body;
        if (r.status === 401) { M.needsReconnect = true; throw calErr('expired', 'microsoft'); }
        if (r.status === 403) throw calErr('permission', 'microsoft');
        if (r.status === 404) throw calErr('not-found', 'microsoft');
        throw calErr('unknown', 'microsoft', body && body.error && body.error.message);
      });
    });
  }
  function msTime(x) { return x && x.dateTime ? Date.parse(String(x.dateTime).slice(0, 19) + 'Z') : NaN; }
  function msEventToExt(e, cal) {
    if (e.isCancelled) return null;
    var o = { src: 'microsoft', calId: cal.id, id: e.id, title: e.subject || '(No title)', location: e.location && e.location.displayName || '', url: e.webLink || '', writable: !!cal.writable };
    if (e.isAllDay) { o.allDay = true; o.date = String(e.start.dateTime).slice(0, 10); o.endDate = String(e.end.dateTime).slice(0, 10); if (o.endDate <= o.date) o.endDate = ICS.addDaysIso(o.date, 1); o.start = ICS.dubaiTs(o.date, '00:00'); o.end = ICS.dubaiTs(o.endDate, '00:00'); }
    else { o.allDay = false; o.start = msTime(e.start); o.end = msTime(e.end) || o.start; }
    o.key = 'microsoft:' + cal.id + ':' + e.id;
    return isNaN(o.start) ? null : o;
  }
  function msSync() {
    var c = cfg().microsoft;
    return msFetch('/me/calendars?$select=id,name,hexColor,canEdit,isDefaultCalendar').then(function (list) {
      var old = {};
      c.calendars.forEach(function (x) { old[x.id] = x; });
      c.calendars = (list.value || []).map(function (x, i) {
        var o = old[x.id];
        return { id: x.id, name: x.name, color: o ? o.color : (x.hexColor || PALETTE[(i + 2) % PALETTE.length]), show: o ? o.show : true, primary: !!x.isDefaultCalendar, writable: x.canEdit !== false };
      });
      var from = new Date(Date.now() - WINDOW_BACK * 864e5).toISOString(), to = new Date(Date.now() + WINDOW_AHEAD * 864e5).toISOString();
      return Promise.all(c.calendars.filter(function (x) { return x.show; }).map(function (cal) {
        var out = [];
        function page(url, n) {
          return msFetch(url).then(function (r) {
            (r.value || []).forEach(function (e) { var x = msEventToExt(e, cal); if (x) out.push(x); });
            return r['@odata.nextLink'] && n < 5 ? page(r['@odata.nextLink'], n + 1) : out;
          });
        }
        return page('/me/calendars/' + encodeURIComponent(cal.id) + '/calendarView?startDateTime=' + encodeURIComponent(from) + '&endDateTime=' + encodeURIComponent(to) + '&$top=500&$select=id,subject,start,end,isAllDay,location,webLink,isCancelled', 0);
      }));
    }).then(function (lists) {
      var evs = [].concat.apply([], lists);
      J.data.extEvents = J.data.extEvents.filter(function (e) { return e.src !== 'microsoft'; }).concat(evs);
      return evs.length;
    });
  }
  var MS_TZ = 'Arabian Standard Time'; // Windows name for Asia/Dubai, used by Microsoft Graph
  function msBody(t) {
    var ev = taskTimes(t), b = { subject: J.taskPhrase(t), body: { contentType: 'text', content: 'Added by NOVA' + (t.person ? ' · ' + t.person : '') } };
    if (ev.allDay) { b.isAllDay = true; b.start = { dateTime: ev.date + 'T00:00:00', timeZone: MS_TZ }; b.end = { dateTime: ev.endDate + 'T00:00:00', timeZone: MS_TZ }; }
    else { b.isAllDay = false; b.start = { dateTime: local(ev.start), timeZone: MS_TZ }; b.end = { dateTime: local(ev.end), timeZone: MS_TZ }; }
    return b;
  }
  function msExtBody(e) {
    return e.allDay ? { subject: e.title, isAllDay: true, start: { dateTime: e.date + 'T00:00:00', timeZone: MS_TZ }, end: { dateTime: e.endDate + 'T00:00:00', timeZone: MS_TZ } }
      : { subject: e.title, isAllDay: false, start: { dateTime: local(e.start), timeZone: MS_TZ }, end: { dateTime: local(e.end), timeZone: MS_TZ } };
  }

  /* ================= provider-neutral operations ================= */
  var API = {
    google: {
      create: function (body) { return gFetch('/calendars/primary/events', { method: 'POST', body: body }); },
      update: function (id, body, calId) { return gFetch('/calendars/' + encodeURIComponent(calId || 'primary') + '/events/' + encodeURIComponent(id), { method: 'PATCH', body: body }); },
      remove: function (id, calId) { return gFetch('/calendars/' + encodeURIComponent(calId || 'primary') + '/events/' + encodeURIComponent(id), { method: 'DELETE' }); },
      taskBody: gBody, extBody: gExtBody
    },
    microsoft: {
      create: function (body) { return msFetch('/me/events', { method: 'POST', body: body }); },
      update: function (id, body) { return msFetch('/me/events/' + encodeURIComponent(id), { method: 'PATCH', body: body }); },
      remove: function (id) { return msFetch('/me/events/' + encodeURIComponent(id), { method: 'DELETE' }); },
      taskBody: msBody, extBody: msExtBody
    }
  };
  var syncing = {};
  function ensureToken(prov, interactive) {
    var c = cfg()[prov];
    if (!c.connected) return Promise.reject(calErr('not-connected', prov));
    if (prov === 'google') {
      if (gTokenValid()) return Promise.resolve();
      if (interactive) return gAuth('');
      G.needsReconnect = true;
      return Promise.reject(calErr('expired', 'google'));
    }
    return msToken(interactive).then(function () {});
  }
  function sync(prov, opts) {
    opts = opts || {};
    var c = cfg()[prov];
    if (!c.connected) return Promise.reject(calErr('not-connected', prov));
    if (syncing[prov]) return syncing[prov];
    syncing[prov] = ensureToken(prov, opts.interactive)
      .then(function () { return prov === 'google' ? gSync() : msSync(); })
      .then(function (n) { delete syncing[prov]; c.lastSync = Date.now(); c.lastError = ''; J.commit(); return n; },
        function (e) { delete syncing[prov]; c.lastError = e.message; J.persist(); refresh(); throw e; });
    refresh();
    return syncing[prov];
  }
  function connected() { var c = cfg(); return ['google', 'microsoft'].filter(function (p) { return c[p].connected; }); }
  function syncAll(opts) {
    var list = connected(), ok = [], failed = [];
    return Promise.all(list.map(function (p) {
      return sync(p, opts).then(function (n) { ok.push({ prov: p, count: n }); }, function (e) { failed.push({ prov: p, message: e.message, code: e.code }); });
    })).then(function () { return { ok: ok, failed: failed, providers: list }; });
  }
  function connect(prov) {
    var c = cfg()[prov];
    var check = prov === 'google' ? /^[0-9]+-[a-z0-9_]+\.apps\.googleusercontent\.com$/i : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!c.clientId) return Promise.reject(calErr('no-client-id', prov));
    if (!check.test(c.clientId)) return Promise.reject(calErr('bad-client-id', prov));
    var start = prov === 'google' ? gAuth(c.connected ? '' : 'consent') : (M.account && c.connected ? msToken(true) : msLogin());
    return start.then(function () {
      c.connected = true; c.lastError = '';
      J.persist();
      return sync(prov, { interactive: false });
    }).then(function (n) { return n; }, function (e) { c.lastError = e.message; J.persist(); refresh(); throw e; });
  }
  function disconnect(prov) {
    var c = cfg()[prov];
    var done = function () {
      c.connected = false; c.account = ''; c.calendars = []; c.pushed = {}; c.lastSync = 0; c.lastError = '';
      J.data.extEvents = J.data.extEvents.filter(function (e) { return e.src !== prov; });
      J.commit();
    };
    if (prov === 'google') {
      var tok = G.token;
      G.token = ''; G.exp = 0; G.needsReconnect = false;
      try { sessionStorage.removeItem('jarvis.gtoken'); } catch (e) { /* ignore */ }
      if (tok && window.google && window.google.accounts) { try { window.google.accounts.oauth2.revoke(tok, function () {}); } catch (e) { /* ignore */ } }
      done();
      return Promise.resolve();
    }
    var clear = M.app && M.app.clearCache ? Promise.resolve(M.app.clearCache()).catch(function () {}) : Promise.resolve();
    return clear.then(function () {
      try { Object.keys(localStorage).forEach(function (k) { if (/^msal\.|login\.windows\.net|login\.microsoftonline\.com/.test(k)) localStorage.removeItem(k); }); } catch (e) { /* ignore */ }
      M.account = null; M.needsReconnect = false;
      done();
    });
  }
  function needsReconnect(prov) {
    var c = cfg()[prov];
    if (!c.connected) return false;
    return prov === 'google' ? (G.needsReconnect || !gTokenValid()) : M.needsReconnect;
  }

  /* ================= two-way: the outbox (always confirmed before sending) ================= */
  var DUR = { interview: 60, task: 30 };
  function taskTimes(t) {
    // Application deadlines are whole-day events (their 9 am time is only for the reminder).
    if (!t.time || t.kind === 'deadline') return { allDay: true, date: t.due, endDate: ICS.addDaysIso(t.due, 1), start: ICS.dubaiTs(t.due, '00:00'), end: ICS.dubaiTs(ICS.addDaysIso(t.due, 1), '00:00') };
    var s = ICS.dubaiTs(t.due, t.time);
    return { allDay: false, start: s, end: s + (DUR[t.kind] || DUR.task) * 60e3, date: t.due };
  }
  function pushable(t, c) {
    if (t.status === 'done' || !t.due) return false;
    var k = t.kind || 'task';
    if (k === 'interview') return c.push.interviews;
    if (k === 'deadline') return c.push.deadlines;
    return c.push.tasks && !!t.time;
  }
  function sig(t) { return [J.taskPhrase(t), t.due, t.time, t.kind || 'task'].join('|'); }
  function outbox(prov) {
    var c = cfg()[prov], ops = [];
    if (!c.connected || c.mode !== 'two-way') return ops;
    J.data.tasks.forEach(function (t) {
      var p = c.pushed[t.id];
      if (!pushable(t, c)) return;
      if (!p) ops.push({ prov: prov, op: 'create', task: t });
      else if (p.sig && p.sig !== sig(t) && c.push.edits) ops.push({ prov: prov, op: 'update', task: t, eventId: p.id });
    });
    if (c.push.edits) Object.keys(c.pushed).forEach(function (id) { if (!J.byId(J.data.tasks, id)) ops.push({ prov: prov, op: 'delete', taskId: id, eventId: c.pushed[id].id, title: c.pushed[id].title }); });
    return ops;
  }
  function allOps() { return outbox('google').concat(outbox('microsoft')); }
  function opLine(o) {
    var t = o.task;
    if (o.op === 'delete') return '−  Remove "' + o.title + '"';
    return (o.op === 'create' ? '+  Add "' : '~  Update "') + J.taskPhrase(t) + '", ' + J.dueLabel(t.due, t.time);
  }
  function applyOp(o) {
    var c = cfg()[o.prov], api = API[o.prov];
    if (o.op === 'create') return api.create(api.taskBody(o.task)).then(function (ev) { c.pushed[o.task.id] = { id: ev.id, sig: sig(o.task), title: J.taskPhrase(o.task) }; });
    if (o.op === 'update') return api.update(o.eventId, api.taskBody(o.task)).then(function () { c.pushed[o.task.id] = { id: o.eventId, sig: sig(o.task), title: J.taskPhrase(o.task) }; }, function (e) {
      if (e.code === 'not-found') { delete c.pushed[o.task.id]; return; } throw e; });
    return api.remove(o.eventId).then(function () { delete c.pushed[o.taskId]; }, function (e) { if (e.code === 'not-found') { delete c.pushed[o.taskId]; return; } throw e; });
  }
  function sendOps(ops, interactive) {
    var done = 0, provs = {};
    ops.forEach(function (o) { provs[o.prov] = 1; });
    return Object.keys(provs).reduce(function (p, prov) { return p.then(function () { return ensureToken(prov, interactive); }); }, Promise.resolve())
      .then(function () {
        return ops.reduce(function (p, o) { return p.then(function () { return applyOp(o).then(function () { done++; J.persist(); }); }); }, Promise.resolve());
      })
      .then(function () { return Promise.all(Object.keys(provs).map(function (p) { return sync(p).catch(function () {}); })); })
      .then(function () { J.commit(); return done; }, function (e) { J.commit(); e.done = done; throw e; });
  }
  function reviewOutbox() {
    var ops = allOps();
    if (!ops.length) { J.toast('Nothing to send. Your calendars are up to date.'); return Promise.resolve(0); }
    var provs = ops.map(function (o) { return P(o.prov); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' and ');
    return J.confirm(ops.map(opLine).join('\n'), 'Send ' + J.plural(ops.length, 'change'), 'Send to ' + provs + '?').then(function (ok) {
      if (!ok) return 0;
      return sendOps(ops, true).then(function (n) { J.toast('Sent ' + J.plural(n, 'change') + ' to ' + provs + '.'); return n; }, function (e) { J.toast(e.message); });
    });
  }

  /* ================= unified view of everything on the calendar ================= */
  function calInfo(e) {
    var c = cfg(), list = e.src === 'ics' ? c.ics : (c[e.src] && c[e.src].calendars) || [];
    return list.filter(function (x) { return x.id === e.calId; })[0] || null;
  }
  function pushedIds() {
    var c = cfg(), ids = {};
    ['google', 'microsoft'].forEach(function (p) { Object.keys(c[p].pushed).forEach(function (k) { ids[c[p].pushed[k].id] = 1; }); });
    return ids;
  }
  function visibleExt() {
    var ids = pushedIds();
    return J.data.extEvents.filter(function (e) { var ci = calInfo(e); return ci && ci.show !== false && !ids[e.id] && !(e.jarvisId && J.byId(J.data.tasks, e.jarvisId)); });
  }
  function hm(ts) { return ICS.dubaiParts(ts).time; }
  function day(ts) { return ICS.dubaiParts(ts).date; }
  // Items for each date in [from, to] (inclusive, YYYY-MM-DD). Returns { 'YYYY-MM-DD': [item…] }.
  function itemsByDay(from, to) {
    var t = J.today(), out = {}, d;
    for (d = from; d <= to; d = J.addDays(d, 1)) out[d] = [];
    function add(date, it) { if (out[date]) out[date].push(it); }
    J.data.tasks.forEach(function (x) {
      if (!x.due || !out[x.due]) return;
      var kind = x.kind || 'task', s = x.time ? ICS.dubaiTs(x.due, x.time) : null;
      add(x.due, { key: 'task:' + x.id, kind: kind, title: J.taskPhrase(x), date: x.due, time: x.time || '', allDay: !x.time, startTs: s, endTs: s ? s + (DUR[kind] || DUR.task) * 60e3 : null,
        source: 'NOVA', ref: { type: 'task', id: x.id }, late: x.status !== 'done' && x.due < t, done: x.status === 'done' });
    });
    J.data.apps.forEach(function (a) {
      if (a.deadline && out[a.deadline] && !J.data.tasks.some(function (x) { return x.appId === a.id && x.kind === 'deadline' && x.due === a.deadline; }))
        add(a.deadline, { key: 'app:' + a.id, kind: 'deadline', title: 'Deadline: ' + a.title + ' at ' + a.company, date: a.deadline, time: '', allDay: true, source: 'NOVA', ref: { type: 'app', id: a.id } });
    });
    visibleExt().forEach(function (e) {
      var ci = calInfo(e) || {}, base = { kind: 'event', title: e.title, color: ci.color, source: ci.name || P(e.src), ref: { type: 'ext', key: e.key }, location: e.location };
      if (e.allDay) {
        for (d = e.date < from ? from : e.date; d < e.endDate && d <= to; d = J.addDays(d, 1)) add(d, Object.assign({}, base, { key: e.key + '@' + d, date: d, time: '', allDay: true, multi: e.endDate > J.addDays(e.date, 1) }));
        return;
      }
      var sd = day(e.start), ed = day(Math.max(e.start, e.end - 1));
      for (d = sd < from ? from : sd; d <= ed && d <= to; d = J.addDays(d, 1)) {
        var first = d === sd;
        add(d, Object.assign({}, base, { key: e.key + '@' + d, date: d, time: first ? hm(e.start) : '00:00', endTime: d === ed ? hm(e.end) : '24:00', allDay: false, startTs: e.start, endTs: e.end, cont: !first }));
      }
    });
    Object.keys(out).forEach(function (k) { out[k].sort(function (a, b) { return (a.allDay ? '0' : '1' + a.time).localeCompare(b.allDay ? '0' : '1' + b.time); }); });
    return out;
  }
  function timeRange(it) {
    if (it.allDay) return it.kind === 'deadline' ? 'Deadline' : 'All day';
    if (it.cont) return 'Until ' + J.fmtTime(it.endTime);
    return J.fmtTime(it.time) + (it.endTime && it.endTime !== it.time ? ' – ' + (it.endTime === '24:00' ? 'midnight' : J.fmtTime(it.endTime)) : '');
  }
  // Busy periods: timed events and timed NOVA tasks that are not done.
  function busy(date, excludeTaskId) {
    var list = itemsByDay(date, date)[date] || [];
    return list.filter(function (it) { return !it.allDay && !it.done && it.startTs != null && !(it.ref.type === 'task' && it.ref.id === excludeTaskId); });
  }
  function clashes(date, time, durMin, excludeTaskId) {
    if (!date || !time) return [];
    var s = ICS.dubaiTs(date, time), e = s + (durMin || 30) * 60e3;
    return busy(date, excludeTaskId).filter(function (it) { return it.startTs < e && it.endTs > s; });
  }
  function clashText(date, time, excludeTaskId, kind) {
    var c = clashes(date, time, DUR[kind] || DUR.task, excludeTaskId);
    if (!c.length) return '';
    return 'Heads up: you already have "' + c[0].title + '" at ' + J.fmtTime(c[0].cont ? '00:00' : c[0].time) + (c.length > 1 ? ' and ' + J.plural(c.length - 1, 'other item') : '') + '.';
  }
  function freeSlots(date) {
    var c = cfg(), startHM = c.workStart, endHM = c.workEnd;
    var s = ICS.dubaiTs(date, startHM), e = ICS.dubaiTs(date, endHM);
    if (date === J.today()) s = Math.max(s, Math.ceil(Date.now() / 900e3) * 900e3);
    var b = busy(date).map(function (it) { return [Math.max(it.startTs, s), Math.min(it.endTs, e)]; }).filter(function (x) { return x[1] > x[0]; }).sort(function (a, z) { return a[0] - z[0]; });
    var slots = [], cur = s;
    b.forEach(function (x) { if (x[0] - cur >= 30 * 60e3) slots.push([cur, x[0]]); cur = Math.max(cur, x[1]); });
    if (e - cur >= 30 * 60e3) slots.push([cur, e]);
    return { workday: c.workDays.indexOf(J.dow(date)) >= 0, slots: slots.map(function (x) { return { from: hm(x[0]), to: hm(x[1]) }; }), start: startHM, end: endHM };
  }
  function upcoming(days) {
    var from = J.today(), map = itemsByDay(from, J.addDays(from, days || 14)), now = Date.now(), list = [];
    Object.keys(map).sort().forEach(function (d) { map[d].forEach(function (it) { if (!it.allDay && !it.done && !it.cont && it.startTs != null && it.endTs > now) list.push(it); }); });
    return list.sort(function (a, b) { return a.startTs - b.startTs; });
  }
  function next() { return upcoming(14).filter(function (it) { return it.startTs >= Date.now() - 5 * 60e3; })[0] || null; }

  /* ================= event reminders (spoken) ================= */
  function checkEventReminders() {
    var c = cfg(), mins = +c.reminderMins || 0, now = Date.now(), changed = false;
    if (!mins) return;
    visibleExt().forEach(function (e) {
      if (e.allDay || c.reminded[e.key + e.start]) return;
      var at = e.start - mins * 60e3;
      if (now >= at && now < e.start) {
        c.reminded[e.key + e.start] = now; changed = true;
        var left = Math.max(1, Math.round((e.start - now) / 60e3));
        var text = 'Reminder: ' + e.title + ' at ' + J.fmtTime(hm(e.start)) + ', in ' + J.plural(left, 'minute') + '.';
        J.toast(text);
        if (J.voice) J.voice.announce(text);
        if (J.data.settings.notify && 'Notification' in window && Notification.permission === 'granted') {
          try { new Notification('NOVA: ' + e.title, { body: J.fmtTime(hm(e.start)) + ' · ' + ((calInfo(e) || {}).name || P(e.src)), tag: 'nova-ev-' + e.key }); } catch (err) { /* needs a service worker on some phones */ }
        }
      }
    });
    Object.keys(c.reminded).forEach(function (k) { if (now - c.reminded[k] > 3 * 864e5) { delete c.reminded[k]; changed = true; } });
    if (changed) J.persist();
  }

  /* ================= .ics import and export ================= */
  function importIcs(text, fileName) {
    var c = cfg(), r = ICS.parse(text, { from: Date.now() - 60 * 864e5, to: Date.now() + 365 * 864e5 });
    var name = (r.name || String(fileName || 'Calendar').replace(/\.ics$/i, '')).slice(0, 60);
    var src = c.ics.filter(function (x) { return x.name === name; })[0];
    if (!src) { src = { id: J.uid(), name: name, color: PALETTE[(c.ics.length + 3) % PALETTE.length], show: true }; c.ics.push(src); }
    src.importedAt = Date.now(); src.count = r.events.length;
    J.data.extEvents = J.data.extEvents.filter(function (e) { return !(e.src === 'ics' && e.calId === src.id); }).concat(r.events.map(function (e) {
      return { key: 'ics:' + src.id + ':' + e.uid + ':' + e.start, src: 'ics', calId: src.id, id: e.uid + ':' + e.start, title: e.title, location: e.location, url: e.url, allDay: e.allDay, start: e.start, end: e.end, date: e.date, endDate: e.endDate, writable: false };
    }));
    J.commit();
    return { name: name, count: r.events.length, warnings: r.warnings };
  }
  function exportItems() {
    var items = [];
    J.data.tasks.forEach(function (t) {
      if (!t.due || t.status === 'done') return;
      var tt = taskTimes(t);
      items.push({ uid: t.id + '@jarvis', title: J.taskPhrase(t), description: (t.kind === 'interview' ? 'Interview' : t.kind === 'deadline' ? 'Application deadline' : 'Task') + ' from NOVA' + (t.person ? ' · ' + t.person : ''), allDay: tt.allDay, date: tt.date, endDate: tt.endDate, start: tt.start, end: tt.end, categories: t.kind || 'task' });
    });
    J.data.apps.forEach(function (a) {
      if (a.deadline && a.stage !== 'saved' && a.stage !== 'rejected' && a.stage !== 'offer') return;
      if (a.deadline && !J.data.tasks.some(function (x) { return x.appId === a.id && x.kind === 'deadline'; }))
        items.push({ uid: a.id + '-deadline@jarvis', title: 'Application deadline: ' + a.title + ' at ' + a.company, allDay: true, date: a.deadline, endDate: ICS.addDaysIso(a.deadline, 1), categories: 'deadline' });
    });
    return items;
  }
  function exportIcs() {
    var items = exportItems();
    download('nova-calendar-' + J.today() + '.ics', ICS.build(items, { name: 'NOVA' }));
    return items.length;
  }
  function download(name, text) {
    var blob = new Blob([text], { type: 'text/calendar;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  }

  /* ================= small helpers for the UI ================= */
  function refresh() { if (J.current() === 'calendar' || J.current() === 'settings' || J.current() === 'today') J.render(false); updateChip(); }
  function lastSynced(prov) { var c = cfg()[prov]; return c.lastSync ? 'Last synced ' + J.ago(c.lastSync) : 'Not synced yet'; }
  function updateChip() {
    var chip = $('#calChip');
    if (!chip) return;
    var need = connected().filter(needsReconnect), ops = allOps();
    if (need.length) { chip.hidden = false; chip.className = 'chip warn'; chip.textContent = 'Reconnect ' + P(need[0]); chip.setAttribute('data-act', 'calReconnect'); chip.setAttribute('data-id', need[0]); }
    else if (ops.length) { chip.hidden = false; chip.className = 'chip gold'; chip.textContent = J.plural(ops.length, 'change') + ' to send'; chip.setAttribute('data-act', 'calOutbox'); chip.removeAttribute('data-id'); }
    else chip.hidden = true;
  }
  function itemAct(it) {
    if (it.ref.type === 'task') return 'data-act="editTask" data-id="' + esc(it.ref.id) + '"';
    if (it.ref.type === 'app') return 'data-act="openApp" data-id="' + esc(it.ref.id) + '"';
    return 'data-act="calEvent" data-id="' + esc(it.ref.key) + '"';
  }
  function itemClass(it) { return 'ev ' + (it.kind === 'event' ? 'ext' : esc(it.kind)) + (it.late ? ' late' : '') + (it.done ? ' done' : ''); }
  function itemStyle(it) { return it.color ? ' style="--evc:' + esc(it.color) + '"' : ''; }
  function sourcesLegend() {
    var c = cfg(), rows = [];
    ['google', 'microsoft'].forEach(function (p) { if (c[p].connected) c[p].calendars.forEach(function (x) { rows.push({ prov: p, cal: x }); }); });
    c.ics.forEach(function (x) { rows.push({ prov: 'ics', cal: x }); });
    if (!rows.length) return '';
    return '<div class="cal-sources" role="group" aria-label="Calendars to show">' + rows.map(function (r) {
      return '<button type="button" class="cal-src" data-act="calToggle" data-id="' + esc(r.prov + '|' + r.cal.id) + '" aria-pressed="' + (r.cal.show !== false) + '" title="' + esc(P(r.prov)) + '"><i style="background:' + esc(r.cal.color) + '"></i>' + esc(r.cal.name) + '</button>';
    }).join('') + '</div>';
  }
  function statusBar() {
    var c = cfg(), parts = [];
    ['google', 'microsoft'].forEach(function (p) {
      if (!c[p].connected) return;
      var need = needsReconnect(p);
      parts.push('<span class="cal-status' + (need || c[p].lastError ? ' warn' : '') + '"><b>' + P(p) + '</b> ' + (syncing[p] ? 'Syncing…' : esc(need ? 'Sign-in expired' : lastSynced(p))) +
        (need ? ' <button type="button" class="btn small" data-act="calReconnect" data-id="' + p + '">Reconnect</button>' : '') + '</span>');
    });
    if (!parts.length) parts.push('<span class="cal-status">No online calendar connected. <a href="#settings" data-act="calGoSettings">Connect Google or Outlook</a>, or import an .ics file.</span>');
    return '<div class="cal-bar">' + parts.join('') +
      '<span class="btn-row">' + (connected().length ? '<button type="button" class="btn small" data-act="calSync"' + (Object.keys(syncing).length ? ' disabled' : '') + '>Sync now</button>' : '') +
      '<button type="button" class="btn small ghost" data-act="calImport">Import .ics</button><button type="button" class="btn small ghost" data-act="calExport">Export .ics</button></span></div>';
  }
  function outboxBanner() {
    var ops = allOps();
    if (!ops.length) return '';
    return '<div class="outbox" role="status"><span><b>' + J.plural(ops.length, 'change') + '</b> waiting to be sent to your online calendar. NOVA never changes your calendar without asking.</span><button type="button" class="btn small gold" data-act="calOutbox">Review &amp; send</button></div>';
  }

  /* ================= CALENDAR screen (week + month) ================= */
  ui.calView = ui.calView || 'week';
  ui.calMonth = ui.calMonth || 0;
  var WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  J.weekEvents = function (offset) {
    var ws = J.addDays(J.weekStart(J.today()), (offset || 0) * 7), we = J.addDays(ws, 6), map = itemsByDay(ws, we), days = [], events = {};
    for (var d = ws; d <= we; d = J.addDays(d, 1)) { days.push(d); events[d] = map[d].map(function (it) { return { kind: it.kind, time: it.allDay ? '' : it.time, text: it.title, id: it.ref.id, late: it.late, done: it.done, item: it }; }); }
    return { days: days, events: events };
  };
  function monthStart(offset) {
    var t = J.today(), y = +t.slice(0, 4), m = +t.slice(5, 7) - 1 + offset;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + (m < 9 ? '0' : '') + (m + 1) + '-01';
  }
  J.screens.calendar = {
    render: function () {
      var t = J.today(), view = ui.calView, title, body;
      var nav = '<div class="segs" role="group" aria-label="View">' + J.seg('calView', 'week', view, 'Week') + J.seg('calView', 'month', view, 'Month') + '</div>' +
        '<button type="button" class="btn small ghost" data-act="calMove" data-id="-1" aria-label="Previous ' + view + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + J.ICON.left + '</svg></button>' +
        '<button type="button" class="btn small" data-act="calMove" data-id="0">' + (view === 'week' ? 'This week' : 'This month') + '</button>' +
        '<button type="button" class="btn small ghost" data-act="calMove" data-id="1" aria-label="Next ' + view + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + J.ICON.right + '</svg></button>';
      if (view === 'month') {
        var ms = monthStart(ui.calMonth), gs = J.weekStart(ms), ge = J.addDays(gs, 41), map = itemsByDay(gs, ge), month = ms.slice(0, 7);
        title = J.fmt(ms, { weekday: undefined, day: undefined, month: 'long', year: 'numeric' });
        var cells = [];
        for (var d = gs; d <= ge; d = J.addDays(d, 1)) cells.push(d);
        body = '<div class="month" role="grid" aria-label="' + esc(title) + '"><div class="month-head" role="row">' + WD.map(function (w, i) { return '<span role="columnheader" class="' + (i > 4 ? 'we' : '') + '">' + w + '</span>'; }).join('') + '</div>' +
          '<div class="month-grid">' + cells.map(function (dd) {
            var its = map[dd], out = dd.slice(0, 7) !== month;
            return '<div role="gridcell" class="mcell' + (out ? ' out' : '') + (J.isWeekend(dd) ? ' weekend' : '') + (dd === t ? ' today' : '') + '">' +
              '<button type="button" class="mday" data-act="calDay" data-id="' + dd + '" aria-label="' + esc(J.longDate(dd) + ', ' + J.plural(its.length, 'item')) + '">' + (+dd.slice(8)) + '</button>' +
              its.slice(0, 3).map(function (it) { return '<button type="button" class="mev ' + itemClass(it).replace(/^ev /, '') + '"' + itemStyle(it) + ' ' + itemAct(it) + ' title="' + esc(timeRange(it) + ' · ' + it.title) + '">' + (it.allDay ? '' : '<b>' + esc(J.fmtTime(it.cont ? '00:00' : it.time)) + '</b> ') + esc(it.title) + '</button>'; }).join('') +
              (its.length > 3 ? '<button type="button" class="mmore" data-act="calDay" data-id="' + dd + '">+' + (its.length - 3) + ' more</button>' : '') + '</div>';
          }).join('') + '</div></div>';
      } else {
        var ws = J.addDays(J.weekStart(t), ui.calOffset * 7), we = J.addDays(ws, 6), wmap = itemsByDay(ws, we), days = [];
        for (var x = ws; x <= we; x = J.addDays(x, 1)) days.push(x);
        title = J.fmt(ws, { weekday: undefined }) + ' – ' + J.fmt(we, { weekday: undefined, year: 'numeric' });
        body = '<div class="week">' + days.map(function (dd) {
          return '<section class="day' + (J.isWeekend(dd) ? ' weekend' : '') + (dd === t ? ' today' : '') + '" aria-label="' + esc(J.longDate(dd)) + '">' +
            '<div class="day-head"><b>' + esc(J.fmt(dd, { day: undefined, month: undefined })) + '</b>' + (dd === t ? '<span class="day-tag">Today</span>' : J.isWeekend(dd) ? '<span class="day-tag">Weekend</span>' : '') + '<span class="dn">' + J.fmt(dd, { weekday: undefined, month: undefined }) + '</span></div>' +
            wmap[dd].map(function (it) {
              return '<button type="button" class="' + itemClass(it) + '"' + itemStyle(it) + ' ' + itemAct(it) + '><small>' + esc(timeRange(it)) + (it.kind === 'event' ? ' · ' + esc(it.source) : '') + '</small>' + esc(it.title) + '</button>';
            }).join('') +
            '<button type="button" class="day-add" data-act="addOnDay" data-id="' + dd + '" aria-label="Add task on ' + esc(J.longDate(dd)) + '">+ Add</button></section>';
        }).join('') + '</div>';
      }
      return J.head('Schedule', 'Calendar', esc(title) + '. Work week Monday to Friday; Saturday and Sunday are the UAE weekend.', nav) +
        statusBar() + outboxBanner() + sourcesLegend() +
        '<div class="legend" aria-hidden="true"><span><i></i>Task</span><span><i class="g"></i>Deadline or interview</span><span><i class="r"></i>Overdue</span><span><i class="x"></i>Calendar event (calendar colour)</span></div>' +
        body;
    }
  };
  J.actions.calMove = function (id) {
    var n = +id;
    if (ui.calView === 'month') ui.calMonth = n === 0 ? 0 : ui.calMonth + n;
    else ui.calOffset = n === 0 ? 0 : ui.calOffset + n;
    J.render(false);
  };

  /* ================= dialogs ================= */
  function extByKey(key) { return J.data.extEvents.filter(function (e) { return e.key === key; })[0] || null; }
  function canWrite(e) { return (e.src === 'google' || e.src === 'microsoft') && cfg()[e.src].connected && cfg()[e.src].mode === 'two-way' && e.writable; }
  function whenText(e) {
    if (e.allDay) {
      var last = J.addDays(e.endDate, -1);
      return last === e.date ? J.longDate(e.date) + ' · All day' : J.fmt(e.date) + ' – ' + J.fmt(last) + ' · All day';
    }
    var sd = day(e.start), ed = day(Math.max(e.start, e.end - 1));
    return J.longDate(sd) + ' · ' + J.fmtTime(hm(e.start)) + ' – ' + (ed !== sd ? J.fmt(ed) + ', ' : '') + J.fmtTime(hm(e.end));
  }
  function eventDialog(key) {
    var e = extByKey(key);
    if (!e) return;
    var ci = calInfo(e) || {}, writable = canWrite(e);
    var info = '<div class="ev-info"><p><span class="dot" style="background:' + esc(ci.color || '#4fd8ff') + '"></span>' + esc(ci.name || P(e.src)) + ' · ' + esc(P(e.src)) + '</p>' +
      '<p class="mono">' + esc(whenText(e)) + '</p>' + (e.location ? '<p>' + esc(e.location) + '</p>' : '') +
      '<p class="btn-row">' + (e.url && /^https:\/\//.test(e.url) ? '<a class="btn small ghost" href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">Open in ' + esc(P(e.src)) + ' ↗</a>' : '') +
      (writable ? '<button type="button" class="btn small danger" data-act="calDelEvent" data-id="' + esc(e.key) + '">Delete event</button>' : '') + '</p>' +
      (!writable ? '<p class="small-text muted">' + (e.src === 'ics' ? 'Imported from a calendar file, so it is read-only here. Change it in the original calendar app.' : 'Read-only. Choose "Two-way" in Settings → Calendar connections to edit events from NOVA.') + '</p>' : '') + '</div>';
    var fields = [{ type: 'html', html: info }];
    if (writable) {
      fields.push({ name: 'title', label: 'Title', value: e.title, required: true });
      fields.push({ name: 'date', label: 'Date', type: 'date', value: e.allDay ? e.date : day(e.start), required: true, half: true });
      if (!e.allDay) {
        fields.push({ name: 'start', label: 'Start', type: 'time', value: hm(e.start), required: true, half: true });
        fields.push({ name: 'end', label: 'End', type: 'time', value: hm(e.end), required: true, half: true });
      }
    }
    J.openForm({
      title: e.title, submit: writable ? 'Save changes' : 'Close', noFocus: !writable, hideCancel: !writable,
      fields: fields,
      validate: function (v) { if (writable && !e.allDay && v.end <= v.start) return 'The end time must be after the start time.'; },
      onSave: function (v) {
        if (!writable) return;
        var upd = Object.assign({}, e, { title: v.title });
        if (e.allDay) { var len = J.diff(e.date, e.endDate); upd.date = v.date; upd.endDate = J.addDays(v.date, len); upd.start = ICS.dubaiTs(upd.date, '00:00'); upd.end = ICS.dubaiTs(upd.endDate, '00:00'); }
        else { upd.start = ICS.dubaiTs(v.date, v.start); upd.end = ICS.dubaiTs(v.date, v.end); }
        updateExt(e, upd, true);
      }
    });
  }
  function updateExt(e, upd, ask) {
    var go = function () {
      return ensureToken(e.src, true).then(function () { return API[e.src].update(e.id, API[e.src].extBody(upd), e.calId); })
        .then(function () { Object.assign(e, upd); J.commit(); J.toast('Updated in ' + P(e.src) + '.'); return true; },
          function (err) { J.toast(err.message); if (err.code === 'not-found') sync(e.src).catch(function () {}); return false; });
    };
    if (!ask) return go();
    return J.confirm('Update "' + upd.title + '" in ' + P(e.src) + ' to ' + whenText(upd) + '?', 'Update event', 'Change ' + P(e.src) + '?').then(function (ok) { return ok ? go() : false; });
  }
  function deleteExt(e, ask) {
    var go = function () {
      return ensureToken(e.src, true).then(function () { return API[e.src].remove(e.id, e.calId); }).catch(function (err) { if (err.code !== 'not-found') throw err; })
        .then(function () { J.data.extEvents = J.data.extEvents.filter(function (x) { return x.key !== e.key; }); J.commit(); J.toast('Deleted from ' + P(e.src) + '.'); return true; },
          function (err) { J.toast(err.message); return false; });
    };
    if (!ask) return go();
    return J.confirm('Delete "' + e.title + '" (' + whenText(e) + ') from ' + P(e.src) + '? This cannot be undone.', 'Delete event', 'Delete from ' + P(e.src) + '?').then(function (ok) { return ok ? go() : false; });
  }
  function dayDialog(date) {
    var its = itemsByDay(date, date)[date];
    J.openForm({
      title: J.longDate(date), submit: 'Add task on this day', noFocus: true,
      fields: [{ type: 'html', html: its.length ? '<ul class="day-list">' + its.map(function (it) { return '<li><button type="button" class="' + itemClass(it) + '"' + itemStyle(it) + ' ' + itemAct(it) + '><small>' + esc(timeRange(it)) + ' · ' + esc(it.source) + '</small>' + esc(it.title) + '</button></li>'; }).join('') + '</ul>' : J.empty('Nothing on this day.') }],
      onSave: function () { setTimeout(function () { J.taskForm(null, { due: date }); }, 50); }
    });
  }
  function addToCalendarDialog(taskId) {
    var t = J.byId(J.data.tasks, taskId);
    if (!t || !t.due) return;
    var tt = taskTimes(t), it = { title: J.taskPhrase(t), description: 'From NOVA', allDay: tt.allDay, date: tt.date, endDate: tt.endDate, start: tt.start, end: tt.end };
    J.openForm({
      title: 'Add to your calendar', submit: 'Done', noFocus: true, hideCancel: true,
      fields: [{ type: 'html', html: '<p class="muted small-text" style="margin:0 0 12px">"' + esc(it.title) + '", ' + esc(J.dueLabel(t.due, t.time)) + '. These open your calendar with the event filled in; you press Save there.</p>' +
        '<div class="site-grid">' +
          '<a class="site-btn" href="' + esc(ICS.googleLink(it)) + '" target="_blank" rel="noopener noreferrer"><b>Google Calendar ↗</b><small>Opens a new event</small></a>' +
          '<a class="site-btn" href="' + esc(ICS.outlookLink(it, 'live')) + '" target="_blank" rel="noopener noreferrer"><b>Outlook ↗</b><small>Outlook.com (personal)</small></a>' +
          '<a class="site-btn" href="' + esc(ICS.outlookLink(it, 'office')) + '" target="_blank" rel="noopener noreferrer"><b>Microsoft 365 ↗</b><small>Work or school account</small></a>' +
          '<button type="button" class="site-btn" data-act="calTaskIcs" data-id="' + esc(t.id) + '"><b>Download .ics</b><small>Apple Calendar and others</small></button>' +
        '</div>' }],
      onSave: function () {}
    });
  }

  /* ================= SETTINGS panel ================= */
  function guide(prov) {
    if (prov === 'google') {
      return '<details class="guide"><summary>Setup guide: get your free Google Client ID (about 10 minutes, once)</summary><ol>' +
        '<li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">Google Cloud Console ↗</a> and sign in with your Gmail. Create a new project, for example "NOVA". It is free; you do not need a card.</li>' +
        '<li>Turn on the calendar: go to <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener noreferrer">APIs &amp; Services → Library → Google Calendar API ↗</a> and click <b>Enable</b>.</li>' +
        '<li>Set up the consent screen: <b>APIs &amp; Services → OAuth consent screen</b> (also called "Google Auth Platform"). Choose <b>External</b>, give the app a name (NOVA) and your email. Leave it in <b>Testing</b> mode and add your own Gmail under <b>Test users</b> (Audience).</li>' +
        '<li>Create the ID: <b>APIs &amp; Services → Credentials → Create credentials → OAuth client ID</b>. Choose <b>Web application</b>.</li>' +
        '<li>Under <b>Authorised JavaScript origins</b>, add these two addresses exactly (no slash at the end):<pre class="template">https://va130587.github.io\nhttp://localhost:8000</pre>' + (originNote() ? '<span class="gold-text">' + esc(originNote()) + '</span>' : '') + ' Leave "redirect URIs" empty.</li>' +
        '<li>Click <b>Create</b>, copy the <b>Client ID</b> (it ends with ".apps.googleusercontent.com"), paste it above and click <b>Save</b>, then <b>Connect</b>.</li>' +
        '<li>Google will warn that the app is not verified. That is normal for your own testing app: click <b>Continue</b>.</li></ol>' +
        '<p class="small-text muted">The Client ID is not a secret and costs nothing. NOVA never sees your Google password.</p></details>';
    }
    return '<details class="guide"><summary>Setup guide: get your free Microsoft Application ID (about 10 minutes, once)</summary><ol>' +
      '<li>Open <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer">Microsoft Entra → App registrations ↗</a> (or portal.azure.com → App registrations) and sign in. A free account is enough.</li>' +
      '<li>Click <b>New registration</b>. Name: NOVA. Supported accounts: <b>Accounts in any organizational directory and personal Microsoft accounts</b>.</li>' +
      '<li>Redirect URI: choose <b>Single-page application (SPA)</b> and enter:<pre class="template">' + esc(redirectUri()) + '</pre>Also add these under Authentication → Single-page application:<pre class="template">https://va130587.github.io/jarvis-website/redirect.html\nhttp://localhost:8000/redirect.html</pre></li>' +
      '<li>Click <b>Register</b>. Copy the <b>Application (client) ID</b> from the Overview page, paste it above, click <b>Save</b>, then <b>Connect</b>.</li>' +
      '<li>Permissions are requested when you connect: <b>Calendars.Read</b> (read only) or <b>Calendars.ReadWrite</b> (two-way), plus <b>User.Read</b> for your name.</li></ol>' +
      '<p class="small-text muted">Microsoft does not let websites revoke a sign-in. After disconnecting, you can also remove NOVA at account.live.com/consent (personal) or myapps.microsoft.com (work).</p></details>';
  }
  // Unsaved text typed into a Client ID box survives screen updates.
  var drafts = {};
  document.addEventListener('input', function (ev) {
    var id = ev.target.id;
    if (id === 'gClientId') drafts.google = ev.target.value;
    if (id === 'mClientId') drafts.microsoft = ev.target.value;
  });
  function provCard(prov) {
    var c = cfg()[prov], need = needsReconnect(prov), id = prov === 'google' ? 'g' : 'm';
    var idValue = drafts[prov] != null ? drafts[prov] : c.clientId;
    var status = !c.connected ? J.tag('Not connected', 'dim') : need ? J.tag('Reconnect needed', 'red') : J.tag('Connected');
    var see = c.mode === 'two-way'
      ? 'NOVA can see your calendars and events, and can add, change or delete events, but only after you confirm each change.'
      : 'NOVA can see your calendars and events. It cannot change anything.';
    return '<article class="panel cal-card" id="cal-' + prov + '">' +
      '<div class="panel-head"><h3>' + P(prov) + (prov === 'microsoft' ? ' / Microsoft 365' : '') + '</h3>' + status + '</div>' +
      (c.connected ? '<p class="small-text">' + (c.account ? 'Signed in as <b>' + esc(c.account) + '</b> · ' : '') + esc(syncing[prov] ? 'Syncing…' : lastSynced(prov)) + '</p>' : '') +
      (c.lastError ? '<p class="cal-error" role="alert">' + esc(c.lastError) + '</p>' : '') +
      '<form class="row" data-form="calClient" data-prov="' + prov + '" autocomplete="off"><div class="field grow" style="margin:0"><label for="' + id + 'ClientId">' + (prov === 'google' ? 'OAuth Client ID' : 'Application (client) ID') + '</label>' +
        '<input id="' + id + 'ClientId" type="text" value="' + esc(idValue) + '" placeholder="' + (prov === 'google' ? '1234567890-abc123.apps.googleusercontent.com' : '1a2b3c4d-1234-5678-9abc-1234567890ab') + '" spellcheck="false"></div><button type="submit" class="btn small">Save</button></form>' +
      '<fieldset class="access"><legend class="flabel">Access</legend>' +
        '<label class="radio"><input type="radio" name="' + id + 'Mode" value="read" data-calmode="' + prov + '"' + (c.mode !== 'two-way' ? ' checked' : '') + '> Read only</label>' +
        '<label class="radio"><input type="radio" name="' + id + 'Mode" value="two-way" data-calmode="' + prov + '"' + (c.mode === 'two-way' ? ' checked' : '') + '> Two-way</label>' +
        '<p class="small-text muted">' + esc(see) + '</p></fieldset>' +
      (c.mode === 'two-way' ? '<div class="push-opts">' +
        sw(prov, 'tasks', 'Send tasks that have a date and time') + sw(prov, 'interviews', 'Send interviews') + sw(prov, 'deadlines', 'Send application deadlines (all-day)') + sw(prov, 'edits', 'Send edits and deletions of those items') + '</div>' : '') +
      (c.connected && c.calendars.length ? '<div class="cal-list"><p class="flabel">Calendars to show</p>' + c.calendars.map(function (x) {
        return '<div class="cal-row"><label class="cbox"><input type="checkbox" data-calshow="' + esc(prov + '|' + x.id) + '"' + (x.show !== false ? ' checked' : '') + '> ' + esc(x.name) + '</label>' + (x.writable ? '' : J.tag('Read-only', 'dim')) +
          '<label class="sr-only" for="col_' + esc(x.id) + '">Colour for ' + esc(x.name) + '</label><input type="color" id="col_' + esc(x.id) + '" value="' + esc(/^#[0-9a-f]{6}$/i.test(x.color) ? x.color : '#4fd8ff') + '" data-calcolor="' + esc(prov + '|' + x.id) + '"></div>';
      }).join('') + '</div>' : '') +
      '<div class="btn-row">' + (!c.connected ? '<button type="button" class="btn primary" data-act="calConnect" data-id="' + prov + '">Connect ' + P(prov) + '</button>'
        : (need ? '<button type="button" class="btn gold" data-act="calReconnect" data-id="' + prov + '">Reconnect</button>' : '') + '<button type="button" class="btn small" data-act="calSyncOne" data-id="' + prov + '">Sync now</button><button type="button" class="btn small danger" data-act="calDisconnect" data-id="' + prov + '">Disconnect</button>') + '</div>' +
      guide(prov) + '</article>';
  }
  function sw(prov, key, label) {
    return '<label class="cbox"><input type="checkbox" data-calpush="' + prov + '|' + key + '"' + (cfg()[prov].push[key] ? ' checked' : '') + '> ' + esc(label) + '</label>';
  }
  J.calSettingsHTML = function () {
    var c = cfg(), days = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
    return '<h2 class="section-title" id="calendar-settings">Calendar connections</h2>' +
      '<p class="small-text muted" style="margin:-4px 0 14px">Your calendar data stays in this browser. NOVA talks directly to Google or Microsoft from your browser; there is no NOVA server. Sign-in tokens are kept only in memory (and this tab\'s session) and are never saved in backups.</p>' +
      outboxBanner() +
      '<div class="grid-2">' + provCard('google') + provCard('microsoft') + '</div>' +
      '<div class="grid-2">' +
        '<article class="panel"><h3>Calendar files (.ics)</h3><p class="small-text muted">No setup needed. Import a file exported from Google, Outlook, Apple Calendar or a university timetable. Imported events are read-only.</p>' +
          (c.ics.length ? '<ul class="sources">' + c.ics.map(function (x) {
            return '<li><label class="cbox grow"><input type="checkbox" data-calshow="' + esc('ics|' + x.id) + '"' + (x.show !== false ? ' checked' : '') + '> ' + esc(x.name) + ' <span class="muted small-text">(' + J.plural(x.count || 0, 'event') + ', ' + esc(J.ago(x.importedAt)) + ')</span></label>' +
              '<label class="sr-only" for="col_' + esc(x.id) + '">Colour for ' + esc(x.name) + '</label><input type="color" id="col_' + esc(x.id) + '" value="' + esc(x.color) + '" data-calcolor="' + esc('ics|' + x.id) + '">' +
              J.iconBtn('calRemoveIcs', x.id, 'Remove ' + x.name, 'del', 'del') + '</li>';
          }).join('') + '</ul>' : '') +
          '<div class="btn-row" style="margin-top:12px"><button type="button" class="btn" data-act="calImport">Import .ics file</button><button type="button" class="btn" data-act="calExport">Export NOVA tasks as .ics</button></div></article>' +
        '<article class="panel"><h3>Reminders and working hours</h3>' +
          '<div class="field"><label for="calRemind">Spoken reminder before calendar events</label><select id="calRemind" data-calset="reminderMins">' +
            [[0, 'Off'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before']].map(function (o) { return '<option value="' + o[0] + '"' + (+c.reminderMins === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
          '<div class="row"><div class="field" style="margin:0"><label for="workStart">Working hours start</label><input id="workStart" type="time" value="' + esc(c.workStart) + '" data-calset="workStart"></div>' +
          '<div class="field" style="margin:0"><label for="workEnd">End</label><input id="workEnd" type="time" value="' + esc(c.workEnd) + '" data-calset="workEnd"></div></div>' +
          '<fieldset class="field" style="border:0;padding:0;margin:14px 0 0"><legend class="flabel" style="padding:0;margin-bottom:8px">Working days (used for "when am I free")</legend><div class="checks">' +
            days.map(function (d) { return '<label class="check-chip"><input type="checkbox" data-calday="' + d[0] + '"' + (c.workDays.indexOf(d[0]) >= 0 ? ' checked' : '') + '>' + d[1] + '</label>'; }).join('') + '</div></fieldset>' +
        '</article>' +
      '</div>';
  };
  J.forms.calClient = function (form) {
    var prov = form.getAttribute('data-prov'), c = cfg()[prov], v = $('input', form).value.trim();
    var check = prov === 'google' ? /^[0-9]+-[a-z0-9_]+\.apps\.googleusercontent\.com$/i : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (v && !check.test(v)) { J.toast(MSG['bad-client-id'](prov)); return; }
    if (v !== c.clientId && c.connected) { J.toast('Disconnect first to change the Client ID.'); return; }
    c.clientId = v; M.app = null; delete drafts[prov];
    J.commit();
    J.toast(v ? 'Client ID saved. Now click Connect.' : 'Client ID removed.');
  };

  /* ================= actions ================= */
  function report(p) { return p.then(null, function (e) { J.toast(e.message); }); }
  Object.assign(J.actions, {
    calConnect: function (prov) {
      var inp = $('#' + (prov === 'google' ? 'g' : 'm') + 'ClientId'), c = cfg()[prov];
      if (inp && inp.value.trim() && inp.value.trim() !== c.clientId && !c.connected) { c.clientId = inp.value.trim(); M.app = null; J.persist(); }
      delete drafts[prov];
      report(connect(prov).then(function (n) { J.toast(P(prov) + ' connected. ' + J.plural(n, 'event') + ' loaded.'); }));
    },
    calReconnect: function (prov) { report(sync(prov, { interactive: true }).then(function () { J.toast(P(prov) + ' reconnected and synced.'); })); },
    calSyncOne: function (prov) { report(sync(prov, { interactive: true }).then(function (n) { J.toast(P(prov) + ' synced: ' + J.plural(n, 'event') + '.'); })); },
    calSync: function () {
      syncAll({ interactive: true }).then(function (r) {
        if (!r.providers.length) { J.toast('No online calendar is connected.'); return; }
        J.toast(r.failed.length ? r.failed[0].message : 'Calendar synced.');
        if (allOps().length) reviewOutbox();
      });
    },
    calDisconnect: function (prov) {
      J.confirm('Disconnect ' + P(prov) + '? NOVA will ' + (prov === 'google' ? 'revoke its access and ' : 'sign out and ') + 'remove the synced events from this browser. Events in ' + P(prov) + ' itself are not touched.', 'Disconnect', 'Disconnect ' + P(prov) + '?').then(function (ok) {
        if (ok) disconnect(prov).then(function () { J.toast(P(prov) + ' disconnected.'); });
      });
    },
    calOutbox: function () { reviewOutbox(); },
    calImport: function () { $('#icsFile').click(); },
    calExport: function () { var n = exportIcs(); J.toast(n ? 'Exported ' + J.plural(n, 'item') + ' as an .ics file.' : 'Nothing to export yet. Add tasks with dates first.'); },
    calTaskIcs: function (id) {
      var t = J.byId(J.data.tasks, id); if (!t) return;
      var tt = taskTimes(t);
      download(J.taskPhrase(t).replace(/[^\w\- ]+/g, '').slice(0, 40).trim().replace(/\s+/g, '-') + '.ics', ICS.build([{ uid: t.id + '@jarvis', title: J.taskPhrase(t), allDay: tt.allDay, date: tt.date, endDate: tt.endDate, start: tt.start, end: tt.end }], { name: 'NOVA' }));
    },
    calRemoveIcs: function (id) {
      var c = cfg(), src = J.byId(c.ics, id); if (!src) return;
      J.snapshot();
      c.ics = c.ics.filter(function (x) { return x.id !== id; });
      J.data.extEvents = J.data.extEvents.filter(function (e) { return !(e.src === 'ics' && e.calId === id); });
      J.commit(); J.toast('Removed ' + src.name + '.', true);
    },
    calToggle: function (id) { toggleShow(id); },
    calEvent: function (key) { eventDialog(key); },
    calDelEvent: function (key) { var e = extByKey(key); if (e) { J.closeForm(); deleteExt(e, true); } },
    calDay: function (date) { dayDialog(date); },
    calAdd: function (id) { addToCalendarDialog(id); },
    calGoSettings: function () { J.go('settings'); setTimeout(function () { var el = document.getElementById('calendar-settings'); if (el) el.scrollIntoView(); }, 300); }
  });
  function toggleShow(id, val) {
    var parts = id.split('|'), prov = parts[0], calId = parts.slice(1).join('|'), c = cfg();
    var list = prov === 'ics' ? c.ics : c[prov].calendars, cal = list.filter(function (x) { return x.id === calId; })[0];
    if (!cal) return;
    cal.show = val == null ? cal.show === false : !!val;
    J.commit();
    // A calendar that was hidden during the last sync has no events yet: fetch them.
    if (cal.show && prov !== 'ics' && !J.data.extEvents.some(function (e) { return e.src === prov && e.calId === calId; })) sync(prov).catch(function () {});
  }
  document.addEventListener('change', function (ev) {
    var el = ev.target, k, c = cfg();
    if ((k = el.getAttribute('data-calshow'))) toggleShow(k, el.checked);
    else if ((k = el.getAttribute('data-calcolor'))) {
      var p = k.split('|'), list = p[0] === 'ics' ? c.ics : c[p[0]].calendars, cal = list.filter(function (x) { return x.id === p.slice(1).join('|'); })[0];
      if (cal) { cal.color = el.value; J.commit(); }
    } else if ((k = el.getAttribute('data-calpush'))) {
      var q = k.split('|'); c[q[0]].push[q[1]] = el.checked; J.commit();
    } else if ((k = el.getAttribute('data-calmode'))) {
      var prov = k, before = c[prov].mode;
      c[prov].mode = el.value;
      J.persist();
      if (c[prov].connected && el.value !== before) {
        // New permissions need a fresh sign-in (this click allows the pop-up).
        if (prov === 'microsoft') M.needsReconnect = false;
        (prov === 'google' ? gAuth(el.value === 'two-way' ? 'consent' : '') : msLogin()).then(function () {
          J.toast(el.value === 'two-way' ? 'Two-way sync is on. Changes are always shown to you before they are sent.' : 'Read-only access.');
          J.commit();
        }, function (e) { c[prov].mode = before; J.commit(); J.toast(e.message); });
      } else J.commit();
    } else if ((k = el.getAttribute('data-calset'))) {
      c[k] = k === 'reminderMins' ? +el.value : el.value;
      if (k === 'workEnd' && c.workEnd <= c.workStart) { J.toast('The end of the working day must be after the start.'); c.workEnd = '18:00'; }
      J.commit();
    } else if ((k = el.getAttribute('data-calday'))) {
      var dnum = +k;
      c.workDays = el.checked ? c.workDays.concat([dnum]).filter(function (v, i, a) { return a.indexOf(v) === i; }) : c.workDays.filter(function (v) { return v !== dnum; });
      J.persist();
    }
  });
  // Hidden file picker for .ics import.
  var picker = document.createElement('input');
  picker.type = 'file'; picker.id = 'icsFile'; picker.accept = '.ics,text/calendar'; picker.multiple = true; picker.hidden = true;
  document.body.appendChild(picker);
  picker.addEventListener('change', function () {
    var files = Array.prototype.slice.call(picker.files || []);
    picker.value = '';
    files.forEach(function (f) {
      var r = new FileReader();
      r.onload = function () {
        try { var res = importIcs(r.result, f.name); J.toast('Imported ' + J.plural(res.count, 'event') + ' from ' + res.name + '.'); }
        catch (e) { J.toast(f.name + ': ' + e.message); }
      };
      r.onerror = function () { J.toast('Could not read ' + f.name + '.'); };
      r.readAsText(f);
    });
  });

  /* ================= timers ================= */
  var started = false;
  function start() {
    if (started) return;
    started = true;
    cfg();
    // Microsoft can renew silently; Google needs a click if its token from this tab has expired.
    function auto() { if (connected().length) syncAll({ interactive: false }).then(refresh); }
    setTimeout(auto, 1200);
    setInterval(function () { if (!document.hidden) auto(); }, SYNC_EVERY);
    setInterval(checkEventReminders, 15000);
    setTimeout(checkEventReminders, 2000);
    window.addEventListener('online', auto);
    document.addEventListener('jarvis:rendered', updateChip);
    updateChip();
  }
  document.addEventListener('DOMContentLoaded', start);

  /* ================= voice commands ================= */
  var CAL_WORDS = /\b(meeting|event|appointment|call|interview|lecture|class|session|calendar)\b/;
  function whenIt(it) { return it.allDay ? J.when(it.date) + ' (all day)' : J.when(it.date, it.cont ? '00:00' : it.time); }
  function twoWayProvs() { var c = cfg(); return connected().filter(function (p) { return c[p].mode === 'two-way'; }); }
  function provList(list) { return J.joinList(list.map(P)); }
  function candidates(days) {
    var from = J.today(), map = itemsByDay(from, J.addDays(from, days || 30)), out = [], seen = {}, now = Date.now();
    Object.keys(map).sort().forEach(function (d) {
      map[d].forEach(function (it) {
        if (it.done || it.cont || seen[it.ref.key || it.ref.id]) return;
        if (!it.allDay && it.endTs < now) return;
        seen[it.ref.key || it.ref.id] = 1; out.push(it);
      });
    });
    return out;
  }
  // Pushes one NOVA task straight away (the person already said yes).
  function pushTask(taskId) {
    var ops = allOps().filter(function (o) { return (o.task && o.task.id === taskId) || o.taskId === taskId; });
    if (!ops.length) return Promise.resolve('');
    var provs = ops.map(function (o) { return o.prov; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    return sendOps(ops, false).then(function () { return ' ' + provList(provs) + ' updated too.'; }, function (e) { return ' I saved it in NOVA, but ' + e.message; });
  }
  function rangeFor(t) {
    var td = J.today();
    if (/\bnext week\b/.test(t)) { var nw = J.addDays(J.weekStart(td), 7); return { from: nw, to: J.addDays(nw, 6), label: 'next week' }; }
    if (/\b(this week|the week|rest of the week)\b/.test(t)) return { from: td, to: J.addDays(J.weekStart(td), 6), label: 'this week' };
    var pd = J.parseDate(t), d = pd ? pd.date : td;
    return { from: d, to: d, label: J.when(d), single: true };
  }
  J.calVoice = function (t, orig) {
    var m;
    if (/^(?:delete|remove|erase|cancel|mark|add|create|new) (?:the |a |an |another )?(?:task|todo|to-do|reminder|note|win)\b/.test(t)) return null;

    /* sync */
    if (/^(?:sync|refresh|update|reload|resync)(?: my| the| all)? ?(?:calendars?|google calendar|outlook(?: calendar)?|events)?(?: now)?$/.test(t) && /calendar|outlook|events|^sync/.test(t)) {
      if (!connected().length) return 'No online calendar is connected. Open Settings, Calendar connections, to connect Google or Outlook.';
      return syncAll({ interactive: false }).then(function (r) {
        if (r.failed.length && !r.ok.length) return r.failed[0].message;
        var n = candidates(7).filter(function (it) { return it.kind === 'event'; }).length;
        return 'Synced ' + provList(r.ok.map(function (x) { return x.prov; })) + '. You have ' + J.plural(n, 'event') + ' in the next 7 days.' + (r.failed.length ? ' ' + r.failed[0].message : '') +
          (allOps().length ? ' ' + J.plural(allOps().length, 'change') + ' from NOVA ' + (allOps().length === 1 ? 'is' : 'are') + ' waiting for you to review on the Calendar screen.' : '');
      });
    }

    /* next meeting */
    if ((m = t.match(/\bnext (meeting|event|appointment|call|interview|class|lecture)\b|what's next on my (calendar|schedule)/))) {
      var wantIv = m[1] === 'interview', list = upcoming(14).filter(function (it) { return !wantIv || it.kind === 'interview' || /interview/i.test(it.title); });
      if (!list.length) return wantIv ? 'You have no interviews in the next two weeks.' : 'Nothing is on your calendar in the next two weeks.';
      var nx = list[0];
      return 'Your next ' + (wantIv ? 'interview' : 'event') + ' is ' + nx.title + ', ' + whenIt(nx) + (nx.kind === 'event' ? ', in ' + nx.source : '') + '.';
    }

    /* am I free at … */
    if ((m = t.match(/^(?:am i|are we|will i be|is my calendar) (free|available|busy|clear|booked)\b(.*)$/))) {
      var tm = J.parseTime(m[2]), dt = J.parseDate(m[2]), date = dt ? dt.date : (tm && tm.date) || J.today();
      if (!tm || tm.soft) return freeReply(date);
      var cl = clashes(date, tm.time, 60);
      var whenTxt = J.fmtTime(tm.time) + (date === J.today() ? ' today' : ' ' + (J.when(date)));
      if (!cl.length) return 'Yes, you\'re free at ' + whenTxt + '.';
      return 'No. At ' + whenTxt + ' you have ' + J.joinList(cl.slice(0, 2).map(function (it) { return it.title + ' (' + timeRange(it).replace(/ – /, ' to ') + ')'; })) + '.';
    }

    /* when am I free */
    if (/\b(when am i (free|available)|free time|free slots?|when can i (meet|schedule|book))\b/.test(t)) {
      var d0 = J.parseDate(t), dd = d0 ? d0.date : J.today();
      if (!d0 && J.nowHM() >= cfg().workEnd) dd = J.addDays(dd, 1);
      return freeReply(dd);
    }

    /* add an interview / meeting */
    if ((m = orig.match(/^(?:please\s+)?(?:add|schedule|book|create|set up|put|arrange|make)(?:\s+(?:an?|the|my))?\s+(interview|meeting|event|appointment|call|class|lecture|session)\b\s*(.*)$/i))) {
      return addEvent(m[1].toLowerCase(), m[2]);
    }

    /* move */
    if ((m = t.match(/^(?:move|reschedule|shift|push|change|postpone|bring forward)(?: my| the)? (.+?) (?:to|until|till) (.+)$/))) {
      return moveItem(m[1], m[2]);
    }

    /* cancel */
    if ((m = t.match(/^(?:cancel|delete|remove|call off|drop)(?: my| the)? (.+)$/))) {
      var q = m[1], hit = J.best(candidates(30), q, function (it) { return it.title; });
      if (!hit) return CAL_WORDS.test(q) ? 'I couldn\'t find an upcoming event matching "' + q + '".' : null;
      return cancelItem(hit);
    }
    /* what's on my calendar */
    if (/\b(calendar|schedule|agenda)\b/.test(t) && !/^(open|show the|go to|switch to)\b/.test(t) || /^what do i have\b/.test(t) || /what's on (?:this|my|the) week/.test(t)) {
      var r = rangeFor(t), map = itemsByDay(r.from, r.to), items = [], now = Date.now();
      Object.keys(map).sort().forEach(function (d) { map[d].forEach(function (it) { if (!it.done && !it.cont && (it.allDay || it.endTs > now || d > J.today())) items.push(it); }); });
      if (!items.length) return 'Your calendar is clear ' + r.label + '.';
      var shown = items.slice(0, 4).map(function (it) { return it.title + ', ' + (r.single ? (it.allDay ? 'all day' : 'at ' + J.fmtTime(it.time)) : whenIt(it)); });
      return J.plural(items.length, 'item') + ' ' + r.label + ': ' + shown.join('; ') + (items.length > 4 ? '; and ' + (items.length - 4) + ' more' : '') + '.';
    }

    return null;
  };
  function freeReply(date) {
    var f = freeSlots(date), name = date === J.today() ? 'Today' : J.when(date);
    if (!f.workday) {
      var n = (itemsByDay(date, date)[date] || []).filter(function (it) { return !it.done; }).length;
      return name + ' is outside your working days' + (n ? ', and you have ' + J.plural(n, 'item') + ' on your calendar.' : ', and your calendar is clear.');
    }
    if (!f.slots.length) return name + ' is fully booked between ' + J.fmtTime(f.start) + ' and ' + J.fmtTime(f.end) + '.';
    var slots = f.slots.map(function (s) { return J.fmtTime(s.from) + ' to ' + J.fmtTime(s.to); });
    return (date === J.today() ? 'Today' : 'On ' + J.when(date)) + ' you\'re free ' + J.joinList(slots) + '.';
  }
  function addEvent(kindWord, rest) {
    var tm = J.parseTime(rest), restNoTime = tm ? (rest.slice(0, tm.start) + ' ' + rest.slice(tm.end)) : rest;
    var dt = J.parseDate(restNoTime), clean = dt ? (restNoTime.slice(0, dt.start) + ' ' + restNoTime.slice(dt.end)) : restNoTime;
    clean = clean.replace(/\s+/g, ' ').replace(/\s+(?:at|on|for)\s*$/i, '').trim();
    var title = J.cap((kindWord + ' ' + clean).trim()).replace(/\bwith ([a-z])/g, function (x, c) { return 'with ' + c.toUpperCase(); });
    var date = dt ? dt.date : tm && tm.date;
    if (!date && !tm) return { text: 'When is the ' + kindWord + '?', ask: function (ans) { return addEvent(kindWord, clean + ' ' + ans); } };
    if (!tm) return { text: 'What time is the ' + kindWord + '?', ask: function (ans) { return addEvent(kindWord, clean + ' ' + J.when(date) + ' ' + ans); } };
    if (!date) date = tm.time > J.nowHM() ? J.today() : J.addDays(J.today(), 1);
    var kind = kindWord === 'interview' ? 'interview' : 'task';
    var provs = twoWayProvs().filter(function (p) { var c = cfg()[p]; return kind === 'interview' ? c.push.interviews : c.push.tasks; });
    var note = clashText(date, tm.time, null, kind);
    return {
      text: 'Add "' + title + '" ' + (J.when(date, tm.time)) + (provs.length ? ' to NOVA and ' + provList(provs) : '') + '? ' + (note ? note + ' ' : '') + 'Say yes or no.',
      confirm: function () {
        var task = J.addTask({ title: title, due: date, time: tm.time, kind: kind, priority: kind === 'interview' ? 'high' : 'medium' });
        return pushTask(task.id).then(function (extra) { return 'Done. ' + title + ' is on your calendar ' + (J.when(date, tm.time)) + '.' + extra; });
      }
    };
  }
  function moveItem(sel, target) {
    var list = candidates(14), it = null, stm = J.parseTime(sel), sdt = J.parseDate(sel);
    if (stm && !stm.soft) {
      var onDay = list.filter(function (x) { return !x.allDay && x.time === stm.time && (!sdt || x.date === sdt.date); });
      var titled = J.best(onDay, sel.replace(/\b(at )?\d.*?(am|pm)\b/, ''), function (x) { return x.title; }, 0.3);
      it = titled || onDay.filter(function (x) { return x.date === J.today(); })[0] || onDay[0] || null;
    }
    if (!it) it = J.best(list, sel, function (x) { return x.title; });
    if (!it) return 'I couldn\'t find "' + sel + '" on your calendar in the next two weeks.';
    var ext = it.ref.type === 'ext' ? extByKey(it.ref.key) : null, task = it.ref.type === 'task' ? J.byId(J.data.tasks, it.ref.id) : null;
    if (it.ref.type === 'app') return 'That is an application deadline. Change it in Applications.';
    if (ext && !canWrite(ext)) return '"' + it.title + '" is read-only for NOVA. ' + (ext.src === 'ics' ? 'It came from an imported file, so change it in the original calendar.' : 'Turn on two-way access in Settings, Calendar connections, to move events.');
    var ttm = J.parseTime(target), tdt = J.parseDate(target);
    if (!ttm && !tdt) return 'To when? For example: move it to 4 pm, or to Monday at 10 am.';
    var newDate = tdt ? tdt.date : it.date, newTime = ttm ? ttm.time : it.time;
    var from = whenIt(it), to = it.allDay && !ttm ? (J.when(newDate)) : (J.when(newDate, newTime));
    var note = newTime ? clashText(newDate, newTime, task && task.id, task && task.kind) : '';
    if (note && ext) note = note.indexOf('"' + ext.title + '"') >= 0 ? '' : note;
    return {
      text: 'Move "' + it.title + '" from ' + from + ' to ' + to + '?' + (ext ? ' This changes it in ' + P(ext.src) + '.' : '') + (note ? ' ' + note : '') + ' Say yes or no.',
      confirm: function () {
        if (ext) {
          var upd = Object.assign({}, ext), dur = ext.end - ext.start;
          if (ext.allDay && !ttm) { var len = J.diff(ext.date, ext.endDate); upd.date = newDate; upd.endDate = J.addDays(newDate, len); upd.start = ICS.dubaiTs(newDate, '00:00'); upd.end = ICS.dubaiTs(upd.endDate, '00:00'); }
          else { upd.allDay = false; delete upd.date; delete upd.endDate; upd.start = ICS.dubaiTs(newDate, newTime); upd.end = upd.start + (ext.allDay ? 3600e3 : dur); }
          return updateExt(ext, upd, false).then(function (ok) { return ok ? 'Moved "' + it.title + '" to ' + to + ' in ' + P(ext.src) + '.' : 'I couldn\'t move it. ' + (J.lastToast || ''); });
        }
        task.due = newDate; task.time = newTime || ''; task.reminded = false;
        J.commit();
        return pushTask(task.id).then(function (extra) { return 'Moved "' + it.title + '" to ' + to + '.' + extra; });
      }
    };
  }
  function cancelItem(it) {
    var ext = it.ref.type === 'ext' ? extByKey(it.ref.key) : null, task = it.ref.type === 'task' ? J.byId(J.data.tasks, it.ref.id) : null;
    if (it.ref.type === 'app') return 'That is an application deadline. Change it in Applications.';
    if (ext && !canWrite(ext)) return '"' + it.title + '" is read-only for NOVA, so I can\'t cancel it. ' + (ext.src === 'ics' ? 'It came from an imported file.' : 'Turn on two-way access in Settings to manage events.');
    return {
      text: 'Cancel "' + it.title + '" ' + whenIt(it) + '?' + (ext ? ' This deletes it from ' + P(ext.src) + '.' : '') + ' Say yes or no.',
      confirm: function () {
        if (ext) return deleteExt(ext, false).then(function (ok) { return ok ? 'Cancelled "' + it.title + '". It is removed from ' + P(ext.src) + '.' : 'I couldn\'t cancel it. ' + (J.lastToast || ''); });
        J.removeTask(task.id);
        return pushTask(task.id).then(function (extra) { return 'Cancelled "' + it.title + '".' + extra; });
      }
    };
  }

  J.cal = {
    cfg: cfg, connect: connect, disconnect: disconnect, sync: sync, syncAll: syncAll, needsReconnect: needsReconnect, connected: connected,
    outbox: allOps, reviewOutbox: reviewOutbox, sendOps: sendOps, applyOp: applyOp,
    itemsByDay: itemsByDay, upcoming: upcoming, next: next, clashes: clashes, clashText: clashText, freeSlots: freeSlots, timeRange: timeRange,
    importIcs: importIcs, exportItems: exportItems, exportIcs: exportIcs, extByKey: extByKey, updateExt: updateExt, deleteExt: deleteExt, canWrite: canWrite,
    checkEventReminders: checkEventReminders, taskTimes: taskTimes, ensureToken: ensureToken, api: API, errors: MSG, redirectUri: redirectUri, names: NAMES
  };
  J.clashNote = clashText;
})();

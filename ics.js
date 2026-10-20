/* NOVA calendar files: read and write .ics (iCalendar) files, plus "Add to Google / Outlook" links.
   Works in the browser (window.NovaICS) and in Node (module.exports) so it can be unit-tested.
   All NOVA times are Asia/Dubai (UTC+4, no daylight saving). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NovaICS = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DUBAI = 'Asia/Dubai';
  // Common Windows time-zone names used by Outlook / Exchange exports.
  var WINDOWS_TZ = {
    'arabian standard time': 'Asia/Dubai', 'arabic standard time': 'Asia/Baghdad', 'arab standard time': 'Asia/Riyadh',
    'gmt standard time': 'Europe/London', 'greenwich standard time': 'Atlantic/Reykjavik', 'utc': 'UTC', 'coordinated universal time': 'UTC',
    'w. europe standard time': 'Europe/Berlin', 'romance standard time': 'Europe/Paris', 'central europe standard time': 'Europe/Budapest',
    'india standard time': 'Asia/Kolkata', 'pakistan standard time': 'Asia/Karachi', 'egypt standard time': 'Africa/Cairo',
    'eastern standard time': 'America/New_York', 'central standard time': 'America/Chicago', 'mountain standard time': 'America/Denver',
    'pacific standard time': 'America/Los_Angeles', 'singapore standard time': 'Asia/Singapore', 'china standard time': 'Asia/Shanghai',
    'tokyo standard time': 'Asia/Tokyo', 'aus eastern standard time': 'Australia/Sydney', 'russian standard time': 'Europe/Moscow',
    'turkey standard time': 'Europe/Istanbul', 'iran standard time': 'Asia/Tehran', 'nepal standard time': 'Asia/Kathmandu',
    'bangladesh standard time': 'Asia/Dhaka', 'sri lanka standard time': 'Asia/Colombo', 'south africa standard time': 'Africa/Johannesburg'
  };

  /* ---------------- time-zone maths ---------------- */
  var fmtCache = {};
  function tzName(tz) {
    if (!tz) return DUBAI;
    var t = String(tz).replace(/^"|"$/g, '').replace(/^\/+/, '').trim();
    // Some exporters prefix the IANA name with a vendor path, e.g. "/mozilla.org/20050126_1/Asia/Dubai".
    var m = t.match(/([A-Za-z_]+\/[A-Za-z_+\-]+(?:\/[A-Za-z_+\-]+)?)$/);
    if (WINDOWS_TZ[t.toLowerCase()]) return WINDOWS_TZ[t.toLowerCase()];
    if (validTz(t)) return t;
    if (m && validTz(m[1])) return m[1];
    return DUBAI;
  }
  function validTz(tz) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
  }
  function partsIn(ts, tz) {
    var f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    var o = {};
    f.formatToParts(new Date(ts)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  }
  function offsetMin(ts, tz) {
    if (tz === 'UTC') return 0;
    if (tz === DUBAI) return 240;
    var p = partsIn(ts, tz);
    return (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000) / 60000;
  }
  // Wall-clock time in a zone -> UTC timestamp (handles daylight saving).
  function zonedToUtc(y, mo, d, h, mi, s, tz) {
    var guess = Date.UTC(y, mo - 1, d, h || 0, mi || 0, s || 0);
    var off = offsetMin(guess, tz), ts = guess - off * 60000, off2 = offsetMin(ts, tz);
    if (off2 !== off) ts = guess - off2 * 60000;
    return ts;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(y, mo, d) { var dt = new Date(Date.UTC(y, mo - 1, d, 12)); return dt.toISOString().slice(0, 10); }
  function addDaysIso(iso, n) { var dt = new Date(iso + 'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); }
  // Dubai helpers used by the app.
  function dubaiTs(dateIso, hm) {
    var p = dateIso.split('-'), t = (hm || '00:00').split(':');
    return Date.UTC(+p[0], +p[1] - 1, +p[2], +t[0], +t[1]) - 4 * 3600e3;
  }
  function dubaiParts(ts) {
    var d = new Date(ts + 4 * 3600e3);
    return { date: d.toISOString().slice(0, 10), time: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) };
  }

  /* ---------------- reading .ics ---------------- */
  function unfold(text) {
    return String(text || '').replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  }
  function parseLine(line) {
    var inQ = false, i, colon = -1;
    for (i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === ':' && !inQ) { colon = i; break; }
    }
    if (colon < 0) return null;
    var head = line.slice(0, colon), value = line.slice(colon + 1);
    var bits = [], cur = '', q = false;
    for (i = 0; i < head.length; i++) {
      var ch = head[i];
      if (ch === '"') q = !q;
      if (ch === ';' && !q) { bits.push(cur); cur = ''; } else cur += ch;
    }
    bits.push(cur);
    var params = {};
    bits.slice(1).forEach(function (b) { var eq = b.indexOf('='); if (eq > 0) params[b.slice(0, eq).toUpperCase()] = b.slice(eq + 1).replace(/^"|"$/g, ''); });
    return { name: bits[0].toUpperCase(), params: params, value: value };
  }
  function unescapeText(v) {
    return String(v).replace(/\\\\/g, '\u0000').replace(/\\[nN]/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\u0000/g, '\\');
  }
  // Returns { ts, allDay, date } for a DTSTART / DTEND / RECURRENCE-ID / EXDATE value.
  function parseDateValue(value, params, defaultTz) {
    var v = String(value).trim();
    var m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (params.VALUE === 'DATE' || m[4] === undefined) {
      var date = isoDate(y, mo, d);
      return { allDay: true, date: date, ts: dubaiTs(date, '00:00'), wall: { y: y, mo: mo, d: d, h: 0, mi: 0, s: 0 }, tz: DUBAI };
    }
    var h = +m[4], mi = +m[5], s = +(m[6] || 0);
    if (m[7]) return { allDay: false, ts: Date.UTC(y, mo - 1, d, h, mi, s), wall: { y: y, mo: mo, d: d, h: h, mi: mi, s: s }, tz: 'UTC' };
    var tz = tzName(params.TZID || defaultTz);
    return { allDay: false, ts: zonedToUtc(y, mo, d, h, mi, s, tz), wall: { y: y, mo: mo, d: d, h: h, mi: mi, s: s }, tz: tz };
  }
  function parseDuration(v) {
    var m = String(v || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (!m) return 0;
    var ms = ((+m[2] || 0) * 7 * 86400 + (+m[3] || 0) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
    return m[1] === '-' ? -ms : ms;
  }
  var BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  function parseRule(v) {
    var r = {};
    String(v).split(';').forEach(function (kv) { var p = kv.split('='); if (p[0]) r[p[0].toUpperCase()] = p[1]; });
    return r;
  }
  // Expand a recurring event inside [from, to]. Works on wall-clock time so daylight saving is respected.
  function expand(ev, rule, from, to, exdates) {
    var out = [], freq = rule.FREQ, interval = Math.max(1, +rule.INTERVAL || 1), count = rule.COUNT ? +rule.COUNT : Infinity;
    var until = rule.UNTIL ? parseDateValue(rule.UNTIL, {}, ev.tz) : null;
    var untilTs = until ? (until.allDay ? until.ts + 86400e3 - 1 : until.ts) : Infinity;
    var w = ev.wall, dur = ev.end - ev.start;
    var days = rule.BYDAY ? rule.BYDAY.split(',').map(function (x) { return BYDAY[x.replace(/^[+-]?\d+/, '').toUpperCase()]; }).filter(function (x) { return x !== undefined; }) : null;
    var monthDays = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null;
    var n = 0, guard = 0;
    function emit(y, mo, d) {
      var start = ev.allDay ? dubaiTs(isoDate(y, mo, d), '00:00') : zonedToUtc(y, mo, d, w.h, w.mi, w.s, ev.tz);
      if (start < ev.start) return true;
      if (start > untilTs || n >= count) return false;
      n++;
      var key = ev.allDay ? isoDate(y, mo, d) : String(start);
      if (start + dur >= from && start <= to && !exdates[key] && !exdates[isoDate(y, mo, d)]) {
        out.push(Object.assign({}, ev, { start: start, end: start + dur, date: ev.allDay ? isoDate(y, mo, d) : undefined, endDate: ev.allDay ? addDaysIso(isoDate(y, mo, d), Math.round(dur / 864e5)) : undefined, recurrenceTs: start }));
      }
      return start <= to;
    }
    var base = new Date(Date.UTC(w.y, w.mo - 1, w.d, 12));
    if (freq === 'DAILY') {
      for (var i = 0; guard++ < 5000; i += interval) {
        var dd = new Date(base); dd.setUTCDate(dd.getUTCDate() + i);
        if (days && days.indexOf(dd.getUTCDay()) < 0) continue;
        if (!emit(dd.getUTCFullYear(), dd.getUTCMonth() + 1, dd.getUTCDate())) break;
      }
    } else if (freq === 'WEEKLY') {
      var wd = days && days.length ? days.slice().sort() : [base.getUTCDay()];
      var wkStart = new Date(base); wkStart.setUTCDate(wkStart.getUTCDate() - wkStart.getUTCDay()); // Sunday of the first week
      var stop = false;
      for (var wk = 0; !stop && guard++ < 3000; wk += interval) {
        for (var k = 0; k < wd.length; k++) {
          var dt = new Date(wkStart); dt.setUTCDate(dt.getUTCDate() + wk * 7 + wd[k]);
          if (dt < base) continue;
          if (!emit(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())) { stop = true; break; }
        }
      }
    } else if (freq === 'MONTHLY') {
      for (var mth = 0; guard++ < 1200; mth += interval) {
        var y = w.y + Math.floor((w.mo - 1 + mth) / 12), mo = (w.mo - 1 + mth) % 12 + 1, go = true;
        (monthDays || [w.d]).forEach(function (md) {
          if (!go) return;
          var dim = new Date(Date.UTC(y, mo, 0)).getUTCDate(), day = md < 0 ? dim + md + 1 : md;
          if (day >= 1 && day <= dim && !emit(y, mo, day)) go = false;
        });
        if (!go) break;
      }
    } else if (freq === 'YEARLY') {
      for (var yr = 0; guard++ < 200; yr += interval) {
        if (!emit(w.y + yr, w.mo, w.d)) break;
      }
    } else {
      out.push(ev);
    }
    return out;
  }
  /**
   * Parse .ics text. Options: { from, to } (timestamps) limit recurring events; defaultTz for "floating" times.
   * Returns { name, events: [{ uid, title, location, description, url, allDay, start, end, date, endDate }], warnings }.
   */
  function parse(text, opts) {
    opts = opts || {};
    var from = opts.from != null ? opts.from : Date.now() - 60 * 864e5;
    var to = opts.to != null ? opts.to : Date.now() + 365 * 864e5;
    var defaultTz = opts.defaultTz || DUBAI;
    var lines = unfold(text), stack = [], cur = null, name = '', calTz = '', raw = [], warnings = [];
    if (!lines.some(function (l) { return /^BEGIN:VCALENDAR/i.test(l); })) throw new Error('This is not a calendar (.ics) file.');
    lines.forEach(function (line) {
      if (!line.trim()) return;
      var p = parseLine(line);
      if (!p) return;
      if (p.name === 'BEGIN') { stack.push(p.value.toUpperCase()); if (p.value.toUpperCase() === 'VEVENT') cur = { props: {}, exdates: [] }; return; }
      if (p.name === 'END') { var e = stack.pop(); if (e === 'VEVENT' && cur) { raw.push(cur); cur = null; } return; }
      if (stack[stack.length - 1] === 'VCALENDAR') {
        if (p.name === 'X-WR-CALNAME') name = unescapeText(p.value);
        if (p.name === 'X-WR-TIMEZONE') calTz = p.value;
        return;
      }
      if (cur && stack[stack.length - 1] === 'VEVENT') {
        if (p.name === 'EXDATE') cur.exdates.push(p);
        else cur.props[p.name] = p;
      }
    });
    if (calTz) defaultTz = tzName(calTz);
    var overrides = {}, events = [];
    raw.forEach(function (r) {
      if (r.props['RECURRENCE-ID']) {
        var rid = parseDateValue(r.props['RECURRENCE-ID'].value, r.props['RECURRENCE-ID'].params, defaultTz);
        if (rid) (overrides[(r.props.UID || {}).value] = overrides[(r.props.UID || {}).value] || {})[rid.allDay ? rid.date : String(rid.ts)] = true;
      }
    });
    raw.forEach(function (r, idx) {
      var P = r.props;
      if (P.STATUS && /CANCELLED/i.test(P.STATUS.value)) return;
      if (!P.DTSTART) { warnings.push('Skipped an event without a start time.'); return; }
      var s = parseDateValue(P.DTSTART.value, P.DTSTART.params, defaultTz);
      if (!s) { warnings.push('Skipped an event with an unreadable date.'); return; }
      var end;
      if (P.DTEND) { var e = parseDateValue(P.DTEND.value, P.DTEND.params, defaultTz); end = e ? e.ts : s.ts; }
      else if (P.DURATION) end = s.ts + parseDuration(P.DURATION.value);
      else end = s.allDay ? s.ts + 864e5 : s.ts;
      if (end < s.ts) end = s.ts;
      var ev = {
        uid: P.UID ? P.UID.value : 'ics-' + idx,
        title: P.SUMMARY ? unescapeText(P.SUMMARY.value).trim() || '(No title)' : '(No title)',
        location: P.LOCATION ? unescapeText(P.LOCATION.value) : '',
        description: P.DESCRIPTION ? unescapeText(P.DESCRIPTION.value).slice(0, 2000) : '',
        url: P.URL ? P.URL.value : '',
        allDay: s.allDay, start: s.ts, end: end, wall: s.wall, tz: s.tz
      };
      if (s.allDay) { ev.date = s.date; ev.endDate = addDaysIso(s.date, Math.max(1, Math.round((end - s.ts) / 864e5))); }
      var list;
      if (P.RRULE && !P['RECURRENCE-ID']) {
        var ex = {};
        r.exdates.forEach(function (x) {
          x.value.split(',').forEach(function (v) { var dv = parseDateValue(v, x.params, defaultTz); if (dv) ex[dv.allDay ? dv.date : String(dv.ts)] = true; });
        });
        Object.assign(ex, overrides[ev.uid] || {});
        list = expand(ev, parseRule(P.RRULE.value), from, to, ex);
      } else {
        list = ev.end >= from && ev.start <= to ? [ev] : [];
      }
      list.forEach(function (x) {
        var o = { uid: x.uid, title: x.title, location: x.location, description: x.description, url: x.url, allDay: x.allDay, start: x.start, end: x.end };
        if (x.allDay) { o.date = x.date; o.endDate = x.endDate; }
        if (x.recurrenceTs) o.occurrence = x.recurrenceTs;
        events.push(o);
      });
    });
    events.sort(function (a, b) { return a.start - b.start; });
    return { name: name, events: events, warnings: warnings };
  }

  /* ---------------- writing .ics ---------------- */
  function escapeText(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
  function utf8Len(s) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c <= 0xdbff) ? (i++, 4) : 3; } return n; }
  // Fold lines longer than 75 octets (RFC 5545).
  function fold(line) {
    if (utf8Len(line) <= 75) return line;
    var out = [], cur = '', limit = 75;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (/[\ud800-\udbff]/.test(ch)) { ch += line[++i]; }
      if (utf8Len(cur + ch) > limit) { out.push(cur); cur = ' ' + ch; limit = 75; }
      else cur += ch;
    }
    out.push(cur);
    return out.join('\r\n');
  }
  function stampUtc(ts) { var d = new Date(ts); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'; }
  function localDubai(ts) { var p = dubaiParts(ts); return p.date.replace(/-/g, '') + 'T' + p.time.replace(':', '') + '00'; }
  /**
   * Build an .ics file. items: [{ uid, title, description, location, url, allDay, date, endDate, start, end }]
   * (timed items use start/end timestamps; all-day items use date and an exclusive endDate).
   */
  function build(items, opts) {
    opts = opts || {};
    var now = stampUtc(opts.now || Date.now());
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NOVA//Personal Assistant//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' + escapeText(opts.name || 'NOVA'), 'X-WR-TIMEZONE:Asia/Dubai',
      'BEGIN:VTIMEZONE', 'TZID:Asia/Dubai', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0400', 'TZOFFSETTO:+0400', 'TZNAME:+04', 'END:STANDARD', 'END:VTIMEZONE'];
    items.forEach(function (it) {
      L.push('BEGIN:VEVENT');
      L.push('UID:' + escapeText(it.uid || (Math.random().toString(36).slice(2) + '@jarvis')));
      L.push('DTSTAMP:' + now);
      if (it.allDay) {
        L.push('DTSTART;VALUE=DATE:' + it.date.replace(/-/g, ''));
        L.push('DTEND;VALUE=DATE:' + (it.endDate || addDaysIso(it.date, 1)).replace(/-/g, ''));
      } else {
        L.push('DTSTART;TZID=Asia/Dubai:' + localDubai(it.start));
        L.push('DTEND;TZID=Asia/Dubai:' + localDubai(it.end || it.start + 30 * 60e3));
      }
      L.push('SUMMARY:' + escapeText(it.title || 'Untitled'));
      if (it.description) L.push('DESCRIPTION:' + escapeText(it.description));
      if (it.location) L.push('LOCATION:' + escapeText(it.location));
      if (it.url) L.push('URL:' + it.url);
      if (it.categories) L.push('CATEGORIES:' + escapeText(it.categories));
      L.push('END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  /* ---------------- add-to-calendar links ---------------- */
  function googleLink(it) {
    var dates = it.allDay
      ? it.date.replace(/-/g, '') + '/' + (it.endDate || addDaysIso(it.date, 1)).replace(/-/g, '')
      : stampUtc(it.start) + '/' + stampUtc(it.end || it.start + 30 * 60e3);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(it.title || '') +
      '&dates=' + dates + '&ctz=' + encodeURIComponent(DUBAI) +
      (it.description ? '&details=' + encodeURIComponent(it.description) : '') + (it.location ? '&location=' + encodeURIComponent(it.location) : '');
  }
  function isoOffset(ts) { var p = dubaiParts(ts); return p.date + 'T' + p.time + ':00+04:00'; }
  // kind: 'live' (Outlook.com, personal) or 'office' (Microsoft 365 work / school).
  function outlookLink(it, kind) {
    var host = kind === 'office' ? 'https://outlook.office.com' : 'https://outlook.live.com';
    var q = it.allDay
      ? 'startdt=' + it.date + '&enddt=' + (it.endDate || addDaysIso(it.date, 1)) + '&allday=true'
      : 'startdt=' + encodeURIComponent(isoOffset(it.start)) + '&enddt=' + encodeURIComponent(isoOffset(it.end || it.start + 30 * 60e3)) + '&allday=false';
    return host + '/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=' + encodeURIComponent(it.title || '') + '&' + q +
      (it.description ? '&body=' + encodeURIComponent(it.description) : '') + (it.location ? '&location=' + encodeURIComponent(it.location) : '');
  }

  return {
    parse: parse, build: build, googleLink: googleLink, outlookLink: outlookLink,
    zonedToUtc: zonedToUtc, tzName: tzName, dubaiTs: dubaiTs, dubaiParts: dubaiParts, addDaysIso: addDaysIso, parseDuration: parseDuration, fold: fold
  };
});

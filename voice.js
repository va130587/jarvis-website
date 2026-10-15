/* Jarvis voice and motion layer.
   - Talk: browser speech recognition (Chrome, Edge, Safari) with a typed fallback everywhere.
   - Reply: browser speech synthesis.
   - "Hey Jarvis" wake mode, animated core orbs, background field, boot sequence, live clock.
   Commands act on the same data as the app (window.JarvisCore). No server, no API key. */
(function () {
  'use strict';
  var J = window.JarvisCore;
  if (!J) return;

  var REDUCE = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s) { return document.querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  // ======================================================================
  // Boot sequence (once per browser session)
  // ======================================================================
  (function boot() {
    var el = $('#boot'); if (!el) return;
    var seen = false; try { seen = sessionStorage.getItem('jarvis.booted') === '1'; } catch (e) { /* ignore */ }
    function done() { el.classList.add('done'); setTimeout(function () { el.remove(); }, 700); try { sessionStorage.setItem('jarvis.booted', '1'); } catch (e) { /* ignore */ } }
    if (seen || REDUCE) { el.remove(); return; }
    el.addEventListener('click', done);
    document.addEventListener('keydown', function once() { done(); document.removeEventListener('keydown', once); });
    setTimeout(done, 2100);
  })();

  // ======================================================================
  // Live clock
  // ======================================================================
  var clock = $('#hudClock');
  function tick() { if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
  tick(); setInterval(tick, 1000);

  // ======================================================================
  // Background field: faint grid, drifting particles, linked when close
  // ======================================================================
  (function bgfx() {
    var c = $('#bgfx'); if (!c || !c.getContext) return;
    var ctx = c.getContext('2d'), w = 0, h = 0, pts = [], last = 0;
    function size() {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      w = innerWidth; h = innerHeight; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.min(90, Math.round(w * h / 26000));
      pts = []; for (var i = 0; i < n; i++) pts.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .18, vy: (Math.random() - .5) * .18, r: Math.random() * 1.3 + .3 });
      draw(0);
    }
    function draw(t) {
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(94,214,255,0.035)';
      var step = 56; ctx.beginPath();
      for (var x = 0.5; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (var y = 0.5; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        if (t) { p.x += p.vx; p.y += p.vy; if (p.x < 0) p.x += w; if (p.x > w) p.x -= w; if (p.y < 0) p.y += h; if (p.y > h) p.y -= h; }
        for (var j = i + 1; j < pts.length; j++) {
          var q = pts[j], dx = p.x - q.x, dy = p.y - q.y, d = dx * dx + dy * dy;
          if (d < 12000) { ctx.strokeStyle = 'rgba(94,214,255,' + (0.10 * (1 - d / 12000)).toFixed(3) + ')'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
        }
        ctx.fillStyle = 'rgba(140,225,255,0.55)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
    }
    function loop(t) {
      if (!document.hidden && t - last > 33) { last = t; draw(t); }
      requestAnimationFrame(loop);
    }
    addEventListener('resize', size); size();
    if (!REDUCE) requestAnimationFrame(loop);
  })();

  // ======================================================================
  // Core orb
  // ======================================================================
  var COLORS = { cyan: [94, 214, 255], amber: [255, 184, 77], red: [255, 93, 108] };
  var TARGET = { idle: 0.12, standby: 0.28, listening: 0.75, thinking: 0.5, speaking: 0.62 };
  var core = { state: 'idle', energy: 0.12, kick: 0, col: COLORS.cyan.slice() };
  var orbs = [];

  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(3) + ')'; }
  function register(canvas) { if (canvas && canvas.getContext) orbs.push({ c: canvas, ctx: canvas.getContext('2d'), px: 0 }); }

  function drawOrb(o, t) {
    var css = o.c.clientWidth; if (!css) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (o.px !== css) { o.px = css; o.c.width = css * dpr; o.c.height = css * dpr; }
    var ctx = o.ctx, s = css, cx = s / 2, cy = s / 2, R = s * 0.47, k = s / 260, e = core.energy + core.kick, c = core.col;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, s, s);

    var g = ctx.createRadialGradient(cx, cy, R * 0.05, cx, cy, R);
    g.addColorStop(0, rgba(c, 0.30 + 0.35 * e)); g.addColorStop(0.45, rgba(c, 0.07 + 0.1 * e)); g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.fill();

    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.00010);
    for (var i = 0; i < 90; i++) {
      var a = i / 90 * 6.283, len = (i % 9 === 0 ? 0.08 : 0.035) * R;
      ctx.strokeStyle = rgba(c, (i % 9 === 0 ? 0.7 : 0.3) + 0.2 * e); ctx.lineWidth = Math.max(1, 1.2 * k);
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95); ctx.lineTo(Math.cos(a) * (R * 0.95 - len), Math.sin(a) * (R * 0.95 - len)); ctx.stroke();
    }
    ctx.restore();

    var rings = [
      { r: 0.80, w: 2.2, sp: 0.00030, segs: [[0, 0.9], [1.2, 2.5], [3.0, 3.9], [4.3, 5.9]] },
      { r: 0.69, w: 5, sp: -0.00048, segs: [[0, 1.3], [1.9, 2.3], [2.9, 5.1]] },
      { r: 0.585, w: 1.4, sp: 0.00085, segs: [[0, 0.5], [0.8, 5.7]] }
    ];
    rings.forEach(function (rg, n) {
      var rot = t * rg.sp * (1 + e * 2.2);
      ctx.lineWidth = rg.w * k; ctx.lineCap = 'butt';
      ctx.strokeStyle = n === 1 ? rgba(c, 0.32 + 0.4 * e) : rgba(c, 0.55 + 0.35 * e);
      rg.segs.forEach(function (sg) { ctx.beginPath(); ctx.arc(cx, cy, R * rg.r, rot + sg[0], rot + sg[1]); ctx.stroke(); });
    });

    ctx.beginPath();
    for (var j = 0; j <= 160; j++) {
      var ang = j / 160 * 6.283;
      var amp = R * 0.06 * e * (Math.sin(ang * 6 + t * 0.006) + 0.6 * Math.sin(ang * 13 - t * 0.011) + 0.3 * Math.sin(ang * 3 + t * 0.003));
      var rr = R * 0.45 + amp;
      var x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.lineWidth = 1.6 * k; ctx.strokeStyle = rgba(c, 0.55 + 0.4 * e); ctx.stroke();

    var cr = R * (0.2 + 0.035 * Math.sin(t * 0.003) * (0.4 + e) + 0.05 * core.kick);
    var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 1.6);
    cg.addColorStop(0, 'rgba(255,255,255,0.95)'); cg.addColorStop(0.35, rgba(c, 0.9)); cg.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, cr * 1.6, 0, 6.283); ctx.fill();
  }

  function frame(t) {
    var tgt = TARGET[core.state] || 0.12;
    if (core.state === 'listening') tgt += Math.random() * 0.25;
    core.energy += (tgt - core.energy) * 0.08;
    core.kick *= 0.9;
    var want = core.state === 'speaking' ? COLORS.amber : COLORS.cyan;
    for (var i = 0; i < 3; i++) core.col[i] += (want[i] - core.col[i]) * 0.08;
    orbs = orbs.filter(function (o) { return document.body.contains(o.c); });
    orbs.forEach(function (o) { drawOrb(o, t); });
  }
  function loop(t) { if (!document.hidden) frame(t); requestAnimationFrame(loop); }
  function stillFrame() { core.energy = TARGET[core.state] || 0.12; core.col = (core.state === 'speaking' ? COLORS.amber : COLORS.cyan).slice(); orbs = orbs.filter(function (o) { return document.body.contains(o.c); }); orbs.forEach(function (o) { drawOrb(o, 0); }); }

  register($('#dockCanvas'));
  if (REDUCE) stillFrame(); else requestAnimationFrame(loop);

  // ======================================================================
  // State + UI
  // ======================================================================
  var STATE_TEXT = { idle: 'Standing by', standby: 'Listening for “Hey Jarvis”', listening: 'Listening…', thinking: 'Processing…', speaking: 'Speaking' };
  var dock = $('#dock'), panel = $('#dockPanel'), orbBtn = $('#dockOrb'), logEl = $('#voiceLog');

  function setState(s) {
    core.state = s;
    var txt = STATE_TEXT[s];
    var ds = $('#dockState'); if (ds) ds.textContent = txt;
    var hs = $('#heroStatus');
    if (hs) { hs.textContent = s === 'idle' ? 'Tap the core or press J to talk.' : txt; hs.classList.toggle('speaking', s === 'speaking'); }
    orbBtn.classList.toggle('listening', s === 'listening');
    orbBtn.classList.toggle('speaking', s === 'speaking');
    orbBtn.setAttribute('aria-label', s === 'listening' ? 'Stop listening' : 'Talk to Jarvis');
    if (REDUCE) stillFrame();
  }
  function openPanel() { panel.hidden = false; }
  function closePanel() { panel.hidden = true; }

  var interimEl = null;
  function addMsg(who, text, interim) {
    openPanel();
    if (interim) {
      if (!interimEl) { interimEl = document.createElement('div'); interimEl.className = 'msg you interim'; interimEl.innerHTML = '<span>YOU</span><p></p>'; logEl.appendChild(interimEl); }
      interimEl.querySelector('p').textContent = text; logEl.scrollTop = logEl.scrollHeight; return null;
    }
    if (interimEl) { interimEl.remove(); interimEl = null; }
    var m = document.createElement('div');
    m.className = 'msg ' + (who === 'you' ? 'you' : 'jarvis');
    m.innerHTML = '<span>' + (who === 'you' ? 'YOU' : 'JARVIS') + '</span><p></p>';
    logEl.appendChild(m);
    while (logEl.children.length > 14) logEl.removeChild(logEl.firstChild);
    var p = m.querySelector('p');
    if (who === 'you' || REDUCE) p.textContent = text;
    else { var i = 0; (function type() { i += 2; p.textContent = text.slice(0, i); logEl.scrollTop = logEl.scrollHeight; if (i < text.length) setTimeout(type, 14); })(); }
    logEl.scrollTop = logEl.scrollHeight;
    return m;
  }

  // ======================================================================
  // Speech out
  // ======================================================================
  var synth = window.speechSynthesis || null, voice = null;
  var muted = store('jarvis.muted') === '1';
  function pickVoice() {
    if (!synth) return;
    var vs = synth.getVoices(); if (!vs.length) return;
    var en = vs.filter(function (v) { return /^en/i.test(v.lang); });
    var prefs = [/Google UK English Male/i, /Daniel/i, /Microsoft (Ryan|George|Thomas)/i, /Arthur/i, /Oliver/i, /Microsoft Guy/i, /Alex/i];
    for (var i = 0; i < prefs.length; i++) { var m = en.filter(function (v) { return prefs[i].test(v.name); })[0]; if (m) { voice = m; return; } }
    voice = en.filter(function (v) { return /en-GB/i.test(v.lang); })[0] || en[0] || vs[0];
  }
  if (synth) { pickVoice(); if (synth.addEventListener) synth.addEventListener('voiceschanged', pickVoice); else synth.onvoiceschanged = pickVoice; }

  function say(text) {
    addMsg('jarvis', text);
    if (!synth || muted) { afterSpeech(); return; }
    stopRec();
    try {
      synth.cancel();
      var u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = 1.03; u.pitch = 0.92;
      u.onstart = function () { setState('speaking'); };
      u.onboundary = function () { core.kick = 0.35; };
      u.onend = u.onerror = function () { afterSpeech(); };
      synth.speak(u);
      setTimeout(function () { if (core.state === 'thinking') setState('speaking'); }, 600);
    } catch (e) { afterSpeech(); }
  }
  function afterSpeech() {
    setState(wakeOn ? 'standby' : 'idle');
    if (wakeOn) setTimeout(function () { if (wakeOn && !rec && !(synth && synth.speaking)) listen('wake'); }, 350);
  }
  function shutUp() { if (synth) synth.cancel(); }

  // ======================================================================
  // Speech in
  // ======================================================================
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var LANG = /^en/i.test(navigator.language || '') ? navigator.language : 'en-US';
  var rec = null, wakeOn = false, audio = null;
  var WAKE = /\b(?:hey|hi|ok|okay|yo)?\s*(?:jarvis|jervis|javis|jarvas|travis|service)\b[\s,.!?]*/i;

  var hv = $('#hudVoice');
  if (hv) hv.textContent = SR ? 'Voice ready' : 'Voice: type commands';

  function chime(up) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var o = audio.createOscillator(), g = audio.createGain(), now = audio.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(up ? 660 : 880, now); o.frequency.exponentialRampToValueAtTime(up ? 1320 : 520, now + 0.12);
      g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.08, now + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      o.connect(g); g.connect(audio.destination); o.start(now); o.stop(now + 0.2);
    } catch (e) { /* sound is optional */ }
  }

  function stopRec() { if (rec) { var r = rec; rec = null; r.onend = null; r.onresult = null; r.onerror = null; try { r.abort(); } catch (e) { /* ignore */ } } }

  function listen(mode) {
    if (!SR) {
      openPanel();
      say('Voice input is not supported in this browser. Use Chrome, Edge or Safari to talk to me, or type your command below.');
      var di = $('#dockInput'); if (di) di.focus();
      return;
    }
    stopRec(); shutUp();
    var r = new SR(); rec = r;
    r.lang = LANG; r.interimResults = true; r.continuous = mode === 'wake'; r.maxAlternatives = 1;
    r.onresult = function (e) {
      var text = '', final = false;
      for (var i = e.resultIndex; i < e.results.length; i++) { text += e.results[i][0].transcript; if (e.results[i].isFinal) final = true; }
      text = text.trim();
      if (mode === 'command') {
        addMsg('you', text, !final);
        if (final) { stopRec(); handle(text, true); }
        return;
      }
      var m = text.match(WAKE);
      if (!m) return;
      var rest = text.slice(m.index + m[0].length).trim();
      if (rest) addMsg('you', rest, !final);
      if (final) {
        stopRec();
        if (rest.length > 2) handle(rest, true);
        else { chime(true); openPanel(); listen('command'); }
      }
    };
    r.onerror = function (e) {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wakeOn = false; updateWake(); stopRec(); setState('idle');
        say('I need permission to use your microphone. Click the microphone or lock icon in the address bar, allow the microphone, and try again.');
      } else if (e.error === 'no-speech' && mode === 'command') {
        addMsg('jarvis', "I didn't hear anything. Tap the core and try again.");
      } else if (e.error === 'network') {
        addMsg('jarvis', 'Voice recognition needs an internet connection.');
      }
    };
    r.onend = function () {
      if (rec !== r) return;
      rec = null;
      if (interimEl) { interimEl.remove(); interimEl = null; }
      if (core.state === 'listening' || core.state === 'standby') setState(wakeOn ? 'standby' : 'idle');
      if (wakeOn) setTimeout(function () { if (wakeOn && !rec && !(synth && synth.speaking)) listen('wake'); }, 400);
    };
    try { r.start(); } catch (e) { /* already started */ }
    setState(mode === 'command' ? 'listening' : 'standby');
    if (mode === 'command') chime(true);
  }

  function talk() {
    if (core.state === 'listening') { stopRec(); setState(wakeOn ? 'standby' : 'idle'); if (wakeOn) listen('wake'); return; }
    if (core.state === 'speaking') { shutUp(); afterSpeech(); return; }
    openPanel(); listen('command');
  }

  // wake + mute toggles
  var wakeBtn = $('#wakeBtn'), muteBtn = $('#muteBtn');
  function updateWake() {
    wakeBtn.setAttribute('aria-pressed', String(wakeOn));
    wakeBtn.textContent = '“Hey Jarvis”: ' + (wakeOn ? 'on' : 'off');
  }
  function updateMute() {
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.textContent = 'Spoken replies: ' + (muted ? 'off' : 'on');
  }
  if (!SR) { wakeBtn.disabled = true; wakeBtn.title = 'Needs Chrome, Edge or Safari'; }
  wakeBtn.addEventListener('click', function () {
    wakeOn = !wakeOn; updateWake();
    if (wakeOn) { chime(true); addMsg('jarvis', 'Wake mode on. Say “Hey Jarvis” followed by your request.'); listen('wake'); }
    else { stopRec(); setState('idle'); }
  });
  muteBtn.addEventListener('click', function () { muted = !muted; store('jarvis.muted', muted ? '1' : '0'); if (muted) shutUp(); updateMute(); });
  updateWake(); updateMute();

  orbBtn.addEventListener('click', talk);
  $('#dockClose').addEventListener('click', function () { closePanel(); });
  $('#dockForm').addEventListener('submit', function (e) {
    e.preventDefault(); var i = $('#dockInput'); var v = i.value.trim(); if (!v) return; i.value = ''; handle(v, false);
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-voice]'); if (!b) return;
    if (b.dataset.voice === 'listen') talk();
    if (b.dataset.voice === 'brief') { openPanel(); handle('Brief me', false); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f.dataset || f.dataset.form !== 'cmd') return;
    e.preventDefault(); var v = (f.cmd.value || '').trim(); if (!v) return; f.cmd.value = ''; handle(v, false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('input,textarea,select,dialog,[contenteditable]')) return;
    if ((e.key === 'j' || e.key === 'J') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); talk(); }
    if (e.key === 'Escape') { shutUp(); stopRec(); if (!wakeOn) setState('idle'); }
  });

  // re-attach hero orb and count-up stats after each screen render
  var lastView = null;
  document.addEventListener('jarvis:render', function (e) {
    register($('#heroOrb'));
    var v = e.detail && e.detail.view, same = v === lastView; lastView = v;
    var viewEl = document.querySelector('#main .view');
    if (same && viewEl) viewEl.classList.add('still');
    if (REDUCE) { stillFrame(); return; }
    if (same) { setState(core.state); return; }
    document.querySelectorAll('.stat b').forEach(function (b) {
      var end = parseInt(b.textContent, 10); if (!(end > 0)) return;
      var start = performance.now();
      (function step(now) { var p = Math.min(1, (now - start) / 700); b.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); })(start);
    });
    setState(core.state);
  });
  register($('#heroOrb'));
  setState('idle');

  // ======================================================================
  // Understanding commands
  // ======================================================================
  var STOP = ['the', 'a', 'an', 'to', 'for', 'of', 'and', 'my', 'on', 'in', 'with', 'by', 'it', 'that', 'this', 'as', 'is', 'i', 'me', 'done', 'mark', 'finished', 'complete', 'completed'];
  function words(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9& ]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 2 && STOP.indexOf(w) < 0; }); }
  function overlap(a, b) { var wa = words(a), wb = words(b), n = 0; wa.forEach(function (w) { if (wb.some(function (x) { return x === w || (w.length > 4 && x.indexOf(w.slice(0, 5)) === 0); })) n++; }); return n; }
  function name() { var n = J.state().profile.name; return n ? n : ''; }
  function nameTail() { return name() ? ', ' + name() : ''; }
  function listJoin(arr) { return arr.length < 2 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]; }
  function describe(c) { return c.what + (c.who ? ' to ' + c.who : ''); }
  function when(d) { var f = J.fmtDate(d); return /^(Today|Tomorrow|Yesterday)$/.test(f) ? f.toLowerCase() : f; }
  function due(d) { var f = when(d); return /^(today|tomorrow|yesterday)$/.test(f) ? f : 'on ' + f; }

  function groups() {
    var open = J.openItems();
    return {
      open: open,
      overdue: open.filter(function (c) { var s = J.cState(c); return s === 'overdue' || s === 'slipped'; }).sort(J.byDue),
      today: open.filter(function (c) { return J.daysFrom(c.due) === 0; }),
      week: open.filter(function (c) { var n = J.daysFrom(c.due); return n !== null && n >= 1 && n <= 7; }).sort(J.byDue)
    };
  }

  function brief() {
    var s = J.state(), g = groups(), h = new Date().getHours();
    var parts = [(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + nameTail() + '.'];
    if (!g.open.length) parts.push('You have no open commitments.');
    else {
      parts.push('You have ' + (g.overdue.length ? J.plural(g.overdue.length, 'overdue item') : 'nothing overdue') + ', ' + g.today.length + ' due today, and ' + g.week.length + ' more this week.');
      if (g.overdue[0]) parts.push('Most urgent: ' + describe(g.overdue[0]) + ', which was due ' + when(g.overdue[0].due) + '.');
      else if (g.today[0]) parts.push('First for today: ' + describe(g.today[0]) + '.');
    }
    var pend = s.drafts.filter(function (d) { return d.status === 'pending'; }).length;
    if (pend) parts.push(J.plural(pend, 'draft') + (pend === 1 ? ' is' : ' are') + ' waiting for your approval.');
    if (s.levels.criteria.length) parts.push('Career focus: ' + J.careerAction().title.replace(/["“”]/g, '') + '.');
    return parts.join(' ');
  }

  function addCommitment(text) {
    var p = J.parseCapture(text);
    if (!p.what || p.what.length < 3) return 'What should I add? For example: remind me to send the report to Omar by Friday.';
    var c = { id: J.uid(), what: p.what, who: p.who, due: p.due, source: p.source === 'Other' ? 'Voice' : p.source, status: 'open', created: J.addDays(0) };
    J.state().commitments.push(c); J.save(); J.render();
    return 'Added: ' + p.what + (p.who ? ' to ' + p.who : '') + (p.due ? ', due ' + due(p.due) + '.' : ', with no due date. You can set one in Commitments.');
  }

  function completeCommitment(q) {
    var best = null, score = 0;
    J.openItems().forEach(function (c) { var n = overlap(q, c.what + ' ' + (c.who || '')); if (n > score) { score = n; best = c; } });
    if (!best) return "I couldn't find an open commitment matching that. Say “what's open” to hear your list.";
    best.status = 'done'; best.doneOn = J.addDays(0); J.save(); J.render();
    return 'Marked as done: ' + describe(best) + '. Promise kept.';
  }

  var CRIT_HINTS = [
    [/budget|cost|sav|revenue|p&l|profit|spend/, /p&l|budget|commercial|financ/],
    [/hire|hired|promot|mentor|coach|team|leader/, /leader|people|team|talent/],
    [/board|executive|ceo|cfo|committee|steering/, /board|executive|investor/],
    [/talk|post|article|panel|conference|podcast|linkedin|speak/, /external|profile|brand|industry/],
    [/strategy|roadmap|vision|plan/, /strategy|vision/],
    [/ship|launch|deliver|migrat|release|on time/, /delivery|execution|scale/],
    [/risk|security|audit|compliance|incident/, /risk|security|governance/]
  ];
  function logWin(text) {
    var s = J.state(), crit = null, t = text.toLowerCase();
    CRIT_HINTS.some(function (h) { if (h[0].test(t)) { crit = s.levels.criteria.filter(function (c) { return h[1].test(c.name.toLowerCase()); })[0]; return !!crit; } return false; });
    if (!crit) { var best = 0; s.levels.criteria.forEach(function (c) { var n = overlap(text, c.name); if (n > best) { best = n; crit = c; } }); }
    var title = text.charAt(0).toUpperCase() + text.slice(1);
    s.evidence.push({ id: J.uid(), date: J.addDays(0), title: title, detail: '', criterionId: crit ? crit.id : '' });
    J.save(); J.render();
    return 'Logged your win' + (crit ? ' under ' + crit.name : '') + '. Well done' + nameTail() + '.';
  }

  var NAV = [
    [/today|home|dashboard|main/, 'today'], [/commit|promise|task|to ?do/, 'commitments'], [/promot|evidence|level|criteri/, 'promotion'],
    [/radar|job|role|career/, 'radar'], [/review|week/, 'review'], [/approv|inbox|draft/, 'inbox'], [/profile|about me|people/, 'profile'],
    [/blueprint|architecture|presentation|slide/, 'blueprint']
  ];
  function navTo(t) {
    for (var i = 0; i < NAV.length; i++) if (NAV[i][0].test(t)) {
      if (NAV[i][1] === 'blueprint') { setTimeout(function () { location.href = 'blueprint/'; }, 1600); return 'Opening the blueprint.'; }
      J.go(NAV[i][1]); return 'Opening ' + ({ today: 'today', commitments: 'commitments', promotion: 'the promotion tracker', radar: 'career radar', review: 'your weekly review', inbox: 'approvals', profile: 'your profile' }[NAV[i][1]]) + '.';
    }
    return null;
  }

  function route(raw) {
    var t = raw.toLowerCase().replace(/[“”"]/g, '').replace(/[.!?]+$/, '').trim();
    var s = J.state(), m, g, a;

    if (/^(stop|cancel|quiet|be quiet|silence|never ?mind|that'?s all)\b/.test(t)) { shutUp(); return 'Standing by.'; }
    if (/(what can you do|^help\b|commands|how do i use you)/.test(t))
      return 'I can brief you on your day, tell you what is overdue or due this week, add a commitment, mark one as done, log a win for your promotion, suggest your next career step, tell you about your best-fit roles, and open any screen. Try: remind me to send the report to Omar by Friday.';
    if (/(who are you|your name|what are you)/.test(t)) return "I'm Jarvis, your personal chief of staff. I keep track of your promises, your promotion case and your path to CTO or CEO.";
    if (/^(thanks|thank you|cheers|great|perfect|nice)/.test(t)) return 'Always a pleasure' + nameTail() + '.';

    if ((m = t.match(/^(?:remind me to|add (?:a |an )?(?:new )?(?:commitment|task|promise|reminder|to-?do)(?: to| that)?:?|new (?:commitment|task)(?: to)?:?|i promised (?:to )?|note that i(?:'ll| will) )\s*(.+)$/)))
      return addCommitment(raw.slice(raw.length - m[1].length));
    if (/^(i'll|i will|i'm going to|i need to|i have to|i must) /.test(t) && /( by | tomorrow| today| on | next | before )/.test(' ' + t))
      return addCommitment(raw);

    if ((m = t.match(/^(?:mark|tick off|close|complete|finish)\s+(.+?)(?:\s+as\s+(?:done|complete|completed|finished))?$/)) ||
        (m = t.match(/^i(?:'ve| have)?\s+(?:finished|completed|done|sent|delivered|shared|submitted)\s+(.+)$/)) ||
        (m = t.match(/^done with\s+(.+)$/)))
      return completeCommitment(m[1]);

    if ((m = t.match(/^(?:log|add|record|save)\s+(?:a |an |my )?(?:win|evidence|achievement|accomplishment)s?\s*(?:that|:|-|,)?\s*(.+)$/)))
      return logWin(raw.slice(raw.length - m[1].length).replace(/^[\s:,-]+/, ''));

    if (/(brief|briefing|status report|sitrep|my day|what'?s (?:on|happening|up)(?: for| today)?|good (?:morning|afternoon|evening)|^(?:hello|hi|hey)\b)/.test(t)) return brief();

    if (/(overdue|late|behind|slipped|missed)/.test(t)) {
      g = groups();
      if (!g.overdue.length) return 'Nothing is overdue. You are on top of things' + nameTail() + '.';
      return 'You have ' + J.plural(g.overdue.length, 'overdue item') + ': ' + listJoin(g.overdue.slice(0, 4).map(function (c) { return describe(c) + ', due ' + due(c.due); })) + '.';
    }
    if (/(due today|for today|today'?s (?:tasks|commitments))/.test(t)) {
      g = groups();
      return g.today.length ? 'Due today: ' + listJoin(g.today.map(describe)) + '.' : 'Nothing is due today.';
    }
    if (/(this week|upcoming|due soon|what'?s due|coming up|what'?s open|open (?:items|commitments|tasks)|my (?:commitments|tasks|list))/.test(t)) {
      g = groups();
      var items = g.overdue.concat(g.today, g.week);
      return items.length ? 'Coming up: ' + listJoin(items.slice(0, 5).map(function (c) { return describe(c) + ' ' + due(c.due); })) + '.' : 'Nothing is due in the next seven days.';
    }

    if (/^(open|show|go to|take me to|display|switch to)\b/.test(t)) { var n = navTo(t); if (n) return n; }

    if (/(promotion|next career|career step|what should i (?:work|focus) on|how do i get promoted|gap)/.test(t)) {
      if (!s.levels.criteria.length) return 'You have not added your promotion criteria yet. Open the promotion tracker and paste them from your company framework.';
      a = J.careerAction(); return a.title.replace(/["“”]/g, '') + '. ' + a.text;
    }
    if (/(job|role|opportunit|radar|cto position|ceo position|interview)/.test(t)) {
      var roles = s.roles.filter(function (r) { return r.status !== 'closed'; }).sort(function (x, y) { return J.fitScore(y) - J.fitScore(x); });
      if (!roles.length) return 'You are not tracking any roles yet. Add one in career radar.';
      var iv = roles.filter(function (r) { return r.status === 'interviewing'; });
      return 'Your best fit is ' + roles[0].title + ' at ' + roles[0].company + ', at ' + J.fitScore(roles[0]) + ' percent.' +
        (iv.length ? ' You are interviewing for ' + listJoin(iv.map(function (r) { return r.title + ' at ' + r.company; })) + '.' : '') +
        ' You are tracking ' + J.plural(roles.length, 'role') + ' in total.';
    }
    if (/(approval|drafts?|inbox|messages to send)/.test(t)) {
      var pend = s.drafts.filter(function (d) { return d.status === 'pending'; });
      return pend.length ? J.plural(pend.length, 'draft') + ' waiting: ' + listJoin(pend.map(function (d) { return 'to ' + d.to + (d.subject ? ' about ' + d.subject : ''); })) + '.' : 'No drafts are waiting for approval.';
    }
    if (/(what time|the time|time is it)/.test(t)) return 'It is ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.';
    if (/(what'?s the date|what is the date|what day|today'?s date)/.test(t)) return 'Today is ' + new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '.';
    if (/(my goal|career goal|who am i|my profile|about me)/.test(t)) {
      var p = s.profile;
      if (!p.goal && !p.thesis) return 'Your profile is empty. Open My profile and tell me your goal.';
      return 'Your goal is ' + (p.goal || 'not set') + (p.timeframe ? ', ' + p.timeframe.toLowerCase() : '') + '.' + (p.thesis ? ' ' + p.thesis : '');
    }
    var nav = navTo(t); if (nav && t.split(' ').length <= 3) return nav;

    return "I'm not sure how to do that yet. Try: brief me, what's overdue, remind me to send the report to Omar by Friday, or log a win.";
  }

  function handle(text, spoken) {
    text = String(text || '').trim(); if (!text) return;
    stopRec();
    if (!spoken) addMsg('you', text);
    setState('thinking');
    var reply;
    try { reply = route(text); } catch (e) { reply = 'Something went wrong with that request.'; if (window.console) console.error(e); }
    setTimeout(function () { say(reply); }, REDUCE ? 0 : 320);
  }

  window.JarvisVoice = { route: route, handle: handle };
})();

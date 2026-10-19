/* Jarvis voice: the animated core, speech recognition and synthesis (built into the browser, free),
   wake mode, the chat panel, interface sounds and the command system. */
(function () {
  'use strict';

  var J = window.J;
  var $ = J.$, $$ = J.$$;
  var body = document.body;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var synth = window.speechSynthesis || null;
  var isFirefox = /firefox/i.test(navigator.userAgent);

  /* ================= state ================= */
  var vstate = 'idle'; // idle | listening | thinking | speaking
  var LABEL = { idle: 'Voice ready', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking' };
  function setState(s) {
    vstate = s;
    body.setAttribute('data-voice', s);
    var txt = LABEL[s];
    if (s === 'idle') txt = !SR ? 'Type to Jarvis' : wake.on ? 'Wake mode on' : 'Voice ready';
    var chip = $('#voiceChip'); if (chip) chip.textContent = txt;
    var cs = $('#chatState'); if (cs) cs.textContent = s === 'idle' ? (wake.on ? 'Say "Hey Jarvis"' : 'Ready') : txt;
    var cap = $('#coreCaption'); if (cap) cap.textContent = s === 'listening' ? 'Listening' : s === 'thinking' ? 'Processing' : s === 'speaking' ? 'Tap to stop' : 'Tap to talk';
    var cb = $('#coreBtn'); if (cb) cb.setAttribute('aria-label', s === 'idle' || s === 'thinking' ? 'Talk to Jarvis' : s === 'listening' ? 'Stop listening' : 'Stop Jarvis speaking');
    orb.dirty = true;
  }
  function setLive(text) {
    var a = $('#liveLine'); if (a) a.textContent = text || '';
    var b = $('#chatLive'); if (b) b.textContent = text || '';
  }

  /* ================= the core (canvas) ================= */
  var orb = { t: 0, col: [79, 216, 255], energy: 0.25, level: 0, pulse: 0, dirty: true };
  var TARGET = {
    idle: { col: [79, 216, 255], e: 0.22 },
    listening: { col: [150, 240, 255], e: 1 },
    thinking: { col: [100, 225, 255], e: 0.55 },
    speaking: { col: [245, 196, 106], e: 0.62 }
  };
  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')'; }
  function prep(c) {
    if (!c || !c.isConnected || !c.getContext) return null;
    var w = c.clientWidth;
    if (!w) return null;
    var dpr = Math.min(2, window.devicePixelRatio || 1), px = Math.round(w * dpr);
    if (c.width !== px) { c.width = px; c.height = px; }
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, s: w };
  }
  function drawCore(c, mini) {
    var p = prep(c);
    if (!p) return;
    var ctx = p.ctx, s = p.s, cx = s / 2, cy = s / 2, R = s * (mini ? 0.3 : 0.29), t = orb.t, col = orb.col, e = orb.energy, lv = orb.level;
    var thinking = vstate === 'thinking', tp = thinking ? 0.5 + 0.5 * Math.sin(t * 6) : 0;
    ctx.clearRect(0, 0, s, s);

    // glow
    var g = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 1.7);
    g.addColorStop(0, rgba(col, 0.24 + e * 0.12 + lv * 0.22 + tp * 0.1));
    g.addColorStop(0.5, rgba(col, 0.06 + e * 0.05 + lv * 0.06));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.7, 0, 6.2832); ctx.fill();

    // speaking ripples
    if (lv > 0.02) {
      for (var k = 0; k < 3; k++) {
        var ph = (t * 0.55 + k / 3) % 1;
        ctx.strokeStyle = rgba(col, (1 - ph) * 0.38 * lv); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(cx, cy, R * (0.6 + ph * 0.95), 0, 6.2832); ctx.stroke();
      }
    }

    // tick marks + outer sweep
    if (!mini) {
      var ticks = 90, tr = R * 1.36;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.04);
      for (var i = 0; i < ticks; i++) {
        var a = i / ticks * 6.2832, long = i % 5 === 0, len = long ? 8 : 3.5;
        ctx.strokeStyle = rgba(col, long ? 0.5 : 0.2); ctx.lineWidth = long ? 1.4 : 1;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * tr, Math.sin(a) * tr); ctx.lineTo(Math.cos(a) * (tr + len), Math.sin(a) * (tr + len)); ctx.stroke();
      }
      ctx.strokeStyle = rgba(col, 0.15); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, R * 1.5, 0, 6.2832); ctx.stroke();
      var sweep = -t * (thinking ? 2.5 : 0.3);
      ctx.strokeStyle = rgba(col, 0.55 + tp * 0.4); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, R * 1.5, sweep, sweep + 0.7); ctx.stroke();
      ctx.restore();
    }

    // concentric rotating rings (segmented)
    var rings = mini
      ? [{ r: 1.05, w: 1.6, sp: 0.5, segs: [[0, 2], [2.6, 4.6]] }, { r: 0.8, w: 2, sp: -0.8, segs: [[0, 1], [3.1, 4.1]] }]
      : [{ r: 1.0, w: 1.6, sp: 0.35, segs: [[0, 1.6], [2.0, 3.3], [3.7, 5.6]], tilt: 1 },
         { r: 1.16, w: 1.1, sp: -0.22, segs: [[0.4, 1.1], [1.5, 2.9], [3.4, 4.0], [4.5, 6.0]], tilt: 0.94 },
         { r: 0.84, w: 2.6, sp: 0.6, segs: [[0, 0.9], [3.14, 4.04]], tilt: 1 }];
    var boost = 1 + e * 2.4;
    rings.forEach(function (rg, idx) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * rg.sp * boost + idx); ctx.scale(1, rg.tilt || 1);
      ctx.strokeStyle = rgba(col, (0.62 + e * 0.3) * (1 - idx * 0.12) + tp * 0.2); ctx.lineWidth = rg.w; ctx.lineCap = 'round';
      ctx.shadowColor = rgba(col, 0.9); ctx.shadowBlur = mini ? 4 : 6 + e * 8;
      rg.segs.forEach(function (sg) { ctx.beginPath(); ctx.arc(0, 0, R * rg.r, sg[0], sg[1]); ctx.stroke(); });
      ctx.restore();
    });

    // waveform ring
    if (!mini) {
      ctx.save(); ctx.translate(cx, cy);
      ctx.strokeStyle = rgba(col, 0.25 + e * 0.35 + lv * 0.3); ctx.lineWidth = 1.2;
      ctx.beginPath();
      var amp = R * (0.012 + e * 0.035 + lv * 0.05);
      for (var n = 0; n <= 160; n++) {
        var an = n / 160 * 6.2832;
        var rr = R * 0.66 + Math.sin(an * 6 + t * 4) * amp + Math.sin(an * 13 - t * 6.5) * amp * 0.6;
        if (n === 0) ctx.moveTo(Math.cos(an) * rr, Math.sin(an) * rr); else ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
      }
      ctx.closePath(); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = rgba(col, 0.22); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.55, 0, 6.2832); ctx.stroke();
    }

    // bright centre
    var cr = R * ((mini ? 0.5 : 0.44) + lv * 0.13 + tp * 0.06 + Math.sin(t * 1.4) * 0.015);
    var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    cg.addColorStop(0, 'rgba(255,255,255,' + (0.88 + lv * 0.12).toFixed(3) + ')');
    cg.addColorStop(0.25, rgba(col, 0.92));
    cg.addColorStop(0.62, rgba(col, 0.3 + e * 0.12));
    cg.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, cr, 0, 6.2832); ctx.fill();
  }
  var lastTs = 0;
  function loop(ts) {
    var dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    var tg = TARGET[vstate] || TARGET.idle;
    var big = $('#coreOrb'), mini = $('#miniOrb');
    if (J.calm()) {
      // Reduce motion: no animation; a still frame is drawn only when something changes.
      if (orb.dirty) { orb.col = tg.col.slice(); orb.energy = tg.e; orb.level = vstate === 'speaking' ? 0.45 : 0; drawCore(big, false); drawCore(mini, true); orb.dirty = false; }
    } else if (!document.hidden) {
      orb.t += dt;
      var k = 1 - Math.pow(0.02, dt);
      for (var i = 0; i < 3; i++) orb.col[i] += (tg.col[i] - orb.col[i]) * k;
      orb.energy += (tg.e - orb.energy) * k;
      orb.pulse *= Math.pow(0.04, dt);
      // Speech synthesis gives no audio level, so the pulse follows word boundaries plus a voice-like rhythm.
      var lvT = vstate === 'speaking' ? 0.28 + 0.36 * Math.abs(Math.sin(orb.t * 7.3) * Math.sin(orb.t * 2.9)) + orb.pulse * 0.45 : 0;
      orb.level += (lvT - orb.level) * Math.min(1, dt * 12);
      drawCore(big, false);
      drawCore(mini, true);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  if (window.matchMedia) { var mq = matchMedia('(prefers-reduced-motion: reduce)'); if (mq.addEventListener) mq.addEventListener('change', function () { orb.dirty = true; }); }
  window.addEventListener('resize', function () { orb.dirty = true; });

  /* ================= interface sounds (off by default) ================= */
  var actx = null;
  function beep(kind) {
    if (!J.data.settings.sounds) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var tones = { start: [[880, 0], [1320, 0.07]], stop: [[660, 0], [440, 0.07]], alert: [[988, 0], [1319, 0.12], [988, 0.24]], ok: [[1046, 0]] }[kind] || [[880, 0]];
      tones.forEach(function (tn) {
        var o = actx.createOscillator(), g = actx.createGain(), at = actx.currentTime + tn[1];
        o.type = 'sine'; o.frequency.value = tn[0];
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.05, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
        o.connect(g); g.connect(actx.destination); o.start(at); o.stop(at + 0.1);
      });
    } catch (e) { /* audio not available */ }
  }
  J.beep = beep;

  /* ================= speaking ================= */
  var voices = [], chosen = null, speakId = 0, lastSpoken = '', lastReply = '';
  var PREFERRED = ['Google UK English Male', 'Microsoft Ryan', 'Microsoft George', 'Microsoft Thomas', 'Microsoft Alfie', 'Daniel', 'Arthur', 'Oliver', 'Male'];
  var FEMALE = /female|kate|serena|martha|stephanie|libby|sonia|hazel|susan|fiona|moira|tessa|karen|samantha|victoria|zira|amy|emma|mia|maisie|catherine|bella|abbi|hollie|jenny|aria|natasha/i;
  function loadVoices() { voices = synth ? synth.getVoices() : []; pickVoice(); fillVoiceSelect(); }
  function pickVoice() {
    chosen = null;
    var saved = J.data.settings.voiceURI;
    if (saved) chosen = voices.filter(function (v) { return v.voiceURI === saved; })[0] || null;
    if (chosen) return;
    var gb = voices.filter(function (v) { return /en[-_]GB/i.test(v.lang); });
    for (var i = 0; i < PREFERRED.length && !chosen; i++) {
      var nm = PREFERRED[i];
      chosen = gb.filter(function (v) { return v.name.indexOf(nm) >= 0 && !FEMALE.test(v.name); })[0] || null;
    }
    if (!chosen) chosen = gb.filter(function (v) { return !FEMALE.test(v.name); })[0] || gb[0] ||
      voices.filter(function (v) { return /^en/i.test(v.lang) && !FEMALE.test(v.name); })[0] || voices.filter(function (v) { return /^en/i.test(v.lang); })[0] || null;
  }
  function fillVoiceSelect() {
    var sel = $('#voiceSelect');
    if (sel) {
      var saved = J.data.settings.voiceURI;
      var en = voices.filter(function (v) { return /^en/i.test(v.lang); });
      sel.innerHTML = '<option value="">Automatic (calm British English male)</option>' + en.map(function (v) {
        var o = document.createElement('option'); o.value = v.voiceURI; o.textContent = v.name + ' (' + v.lang + ')';
        if (v.voiceURI === saved) o.selected = true;
        return o.outerHTML;
      }).join('');
    }
    var sup = $('#voiceSupport');
    if (sup) sup.textContent = (SR ? 'Listening works in this browser.' : isFirefox ? 'Firefox cannot listen. Type your commands, or use Chrome, Edge or Safari for voice.' : 'This browser cannot listen. Type your commands instead.') + ' ' +
      (synth ? (chosen ? 'Current voice: ' + chosen.name + '.' : 'Using the default voice.') : 'This browser cannot speak replies.');
  }
  if (synth) {
    loadVoices();
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', loadVoices); else synth.onvoiceschanged = loadVoices;
  }
  function speak(text) {
    if (!text) return;
    lastSpoken = text.toLowerCase();
    if (!synth || !J.data.settings.voice) { if (vstate === 'thinking') setState('idle'); return; }
    var id = ++speakId;
    synth.cancel();
    if (synth.paused) synth.resume();
    var parts = (String(text).replace(/["“”]/g, '').match(/[^.!?]+[.!?]*/g) || [text]).map(function (p) { return p.trim(); }).filter(Boolean);
    var rate = +J.data.settings.rate || 1;
    parts.forEach(function (p, i) {
      var u = new SpeechSynthesisUtterance(p);
      if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else u.lang = 'en-GB';
      u.rate = rate; u.pitch = 0.92;
      u.onstart = function () { if (id === speakId && vstate !== 'speaking') setState('speaking'); };
      u.onboundary = function () { orb.pulse = 1; };
      if (i === parts.length - 1) u.onend = u.onerror = function () { if (id === speakId) doneSpeaking(); };
      synth.speak(u);
    });
    // Some browsers never fire onstart: leave the thinking state anyway.
    setTimeout(function () { if (id === speakId && vstate === 'thinking') setState(synth.speaking ? 'speaking' : 'idle'); }, 900);
  }
  function doneSpeaking() {
    wake.ignoreUntil = Date.now() + 700;
    setState(wake.awaiting ? 'listening' : 'idle');
  }
  function stopSpeaking() {
    speakId++;
    if (synth) synth.cancel();
    if (vstate === 'speaking' || vstate === 'thinking') setState('idle');
  }

  /* ================= listening (tap the core, press J, Talk button) ================= */
  var rec = null;
  var ERR = {
    blocked: 'Microphone access is blocked. Click the lock icon next to the web address, allow the microphone, then reload the page. You can also type to me.',
    nomic: 'I can\'t find a microphone. Connect one, or type to me instead.',
    network: 'Speech recognition needs an internet connection in this browser. You can type to me instead.',
    unsupported: isFirefox ? 'Firefox can\'t listen. Please type to me here, or use Chrome, Edge or Safari for voice.' : 'Voice input isn\'t supported in this browser. Please type to me here, or use Chrome, Edge or Safari.'
  };
  function listen() {
    if (rec) { stopListening(); return; }
    if (!SR) { openChat(true); respond(ERR.unsupported); return; }
    if (navigator.onLine === false) { openChat(true); respond(ERR.network); return; }
    stopSpeaking();
    pauseWake();
    var finalText = '', err = '';
    var r = new SR();
    r.lang = 'en-GB'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    r.onstart = function () { setState('listening'); setLive('Listening…'); beep('start'); };
    r.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
      }
      setLive('“' + (finalText + interim).trim() + '”');
    };
    r.onerror = function (e) { err = e.error || 'error'; };
    r.onend = function () {
      rec = null;
      if (vstate === 'listening') setState('idle');
      beep('stop');
      var text = finalText.trim();
      if (text) handle(text, true);
      else if (err === 'not-allowed' || err === 'service-not-allowed') { openChat(false); respond(ERR.blocked); }
      else if (err === 'audio-capture') { openChat(false); respond(ERR.nomic); }
      else if (err === 'network') { openChat(false); respond(ERR.network); }
      else if (err === 'no-speech') setLive('I didn\'t hear anything. Tap the core to try again.');
      else setLive('');
      setTimeout(resumeWake, 500);
    };
    rec = r;
    try { r.start(); } catch (e) { rec = null; setState('idle'); resumeWake(); }
  }
  function stopListening() { if (rec) { try { rec.stop(); } catch (e) { /* already stopped */ } } }
  function coreTap() {
    if (vstate === 'speaking') { stopSpeaking(); setLive('Stopped.'); }
    else if (rec) stopListening();
    else listen();
  }

  /* ================= wake mode ("Hey Jarvis") ================= */
  var WAKE_RX = /(?:\b(?:hey|hi|ok|okay|hello|yo)\s+)?\b(jarvis|jervis|javis|jarvas|jarves|nova)\b[\s,.:!?]*(.*)$/i;
  var STOP_RX = /\b(stop|cancel|quiet|enough|shut up|pause|be quiet)\b/i;
  var wake = { on: false, rec: null, paused: false, awaiting: false, timer: null, ignoreUntil: 0, armed: false, failures: 0 };
  function setWake(on, quiet) {
    if (on && !SR) { J.data.settings.wake = false; J.persist(); syncSwitches(); if (!quiet) respond(ERR.unsupported); return; }
    wake.on = !!on;
    J.data.settings.wake = wake.on;
    J.persist();
    syncSwitches();
    if (wake.on) { wake.failures = 0; startWake(); if (!quiet) respond('Wake mode is on. Say "Hey Jarvis" followed by your request.'); }
    else { stopWake(); if (!quiet) respond('Wake mode is off.'); }
    setState(vstate);
  }
  function syncSwitches() {
    $$('[data-setting="wake"]').forEach(function (el) { el.checked = !!J.data.settings.wake; });
    $$('[data-setting="voice"]').forEach(function (el) { el.checked = !!J.data.settings.voice; });
  }
  function startWake() {
    if (!SR || !wake.on || wake.rec || wake.paused || rec || document.hidden) return;
    var r = new SR();
    r.lang = 'en-GB'; r.continuous = true; r.interimResults = true;
    r.onresult = function (e) {
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var txt = e.results[i][0].transcript;
        if (e.results[i].isFinal) heard(txt);
        else if (vstate !== 'speaking' && (wake.awaiting || WAKE_RX.test(txt))) setLive('“' + txt.trim() + '”');
      }
    };
    r.onerror = function (e) {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wake.on = false; J.data.settings.wake = false; J.persist(); syncSwitches(); respond(ERR.blocked); }
      else if (e.error === 'audio-capture') { wake.on = false; J.data.settings.wake = false; J.persist(); syncSwitches(); respond(ERR.nomic); }
      else if (e.error === 'network') wake.failures++;
    };
    r.onend = function () {
      wake.rec = null;
      // Restart automatically; back off if the network keeps failing.
      if (wake.on && !wake.paused) setTimeout(startWake, wake.failures > 3 ? 5000 : 300);
    };
    wake.rec = r;
    try { r.start(); } catch (e) { wake.rec = null; }
  }
  function stopWake() {
    clearAwait();
    if (wake.rec) { var r = wake.rec; wake.rec = null; r.onend = null; try { r.abort(); } catch (e) { /* ignore */ } }
  }
  function pauseWake() { wake.paused = true; stopWake(); }
  function resumeWake() { wake.paused = false; startWake(); }
  function clearAwait() { wake.awaiting = false; clearTimeout(wake.timer); }
  function isEcho(t) {
    // Ignore Jarvis's own voice picked up by the microphone.
    if (!lastSpoken || t.length < 4) return false;
    var words = t.split(/\s+/), hits = words.filter(function (w) { return lastSpoken.indexOf(w) >= 0; }).length;
    return hits / words.length > 0.75 && !WAKE_RX.test(t);
  }
  function heard(raw) {
    var t = String(raw || '').toLowerCase().trim();
    if (!t) return;
    if (vstate === 'speaking') { if (STOP_RX.test(t) && t.split(/\s+/).length <= 4) { stopSpeaking(); setLive('Stopped.'); } return; }
    if (!WAKE_RX.test(t)) {
      // Just after Jarvis speaks, only a real follow-up (not its own echo) is accepted.
      if (Date.now() < wake.ignoreUntil && (!wake.awaiting || isEcho(t))) return;
      if (isEcho(t)) return;
    }
    var m = t.match(WAKE_RX);
    if (m) {
      var cmd = m[2].trim();
      if (cmd) { clearAwait(); handle(cmd, true); }
      else {
        wake.awaiting = true;
        beep('start');
        setState('listening');
        respond('Yes?', true);
        clearTimeout(wake.timer);
        wake.timer = setTimeout(function () { wake.awaiting = false; if (vstate === 'listening' && !rec) { setState('idle'); setLive(''); } }, 9000);
      }
      return;
    }
    if (wake.awaiting) { clearAwait(); handle(t, true); }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopWake();
    else if (wake.on) startWake();
  });
  // Browsers only allow the microphone after an interaction, so wake mode starts on the first click or key.
  function arm() { if (wake.armed) return; wake.armed = true; if (J.data.settings.wake) setWake(true, true); }
  window.addEventListener('pointerdown', arm, { once: true });
  window.addEventListener('keydown', arm, { once: true });

  /* ================= chat panel ================= */
  var chat = $('#chat'), log = $('#chatLog'), mini = $('#miniCore');
  function addMsg(who, text, chips) {
    var li = document.createElement('li');
    li.className = 'msg ' + who;
    var w = document.createElement('span'); w.className = 'who'; w.textContent = who === 'you' ? 'You' : 'Jarvis';
    var p = document.createElement('p'); p.textContent = text;
    li.appendChild(w); li.appendChild(p);
    if (chips && chips.length) {
      var box = document.createElement('div'); box.className = 'chips';
      chips.forEach(function (c) { var b = document.createElement('button'); b.type = 'button'; b.textContent = c; b.setAttribute('data-act', 'say'); b.setAttribute('data-say', c); box.appendChild(b); });
      li.appendChild(box);
    }
    log.appendChild(li);
    while (log.children.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  function openChat(focus) {
    chat.hidden = false;
    mini.setAttribute('aria-expanded', 'true'); mini.setAttribute('aria-label', 'Close chat with Jarvis');
    log.scrollTop = log.scrollHeight;
    if (focus) $('#chatInput').focus();
  }
  function closeChat() {
    chat.hidden = true;
    mini.setAttribute('aria-expanded', 'false'); mini.setAttribute('aria-label', 'Open chat with Jarvis');
  }
  mini.addEventListener('click', function () { if (chat.hidden) openChat(true); else { closeChat(); mini.focus(); } });
  $('#chatClose').addEventListener('click', function () { closeChat(); mini.focus(); });
  $('#chatForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var inp = $('#chatInput'), v = inp.value.trim();
    if (!v) return;
    inp.value = '';
    handle(v, false);
  });
  $('#chatInput').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); if (vstate === 'speaking') stopSpeaking(); else { closeChat(); mini.focus(); } }
  });

  /* ================= keyboard ================= */
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (document.querySelector('dialog[open]') || J.booting()) return;
    var tg = e.target, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable;
    if (!typing && (e.key === 'j' || e.key === 'J')) { e.preventDefault(); listen(); }
    else if (e.key === 'Escape') {
      if (vstate === 'speaking') { stopSpeaking(); setLive('Stopped.'); }
      else if (rec) stopListening();
      else if (pending) { pending = null; addMsg('jarvis', 'Cancelled.'); }
      else if (!chat.hidden && !typing) { closeChat(); mini.focus(); }
    }
  });

  /* ================= replies ================= */
  function respond(text, silentLog, chips) {
    if (!text) { if (vstate === 'thinking') setState('idle'); return; }
    lastReply = text;
    if (!silentLog) addMsg('jarvis', text, chips);
    setLive(text);
    speak(text);
    if (!synth || !J.data.settings.voice) setState(wake.awaiting ? 'listening' : 'idle');
  }
  function handle(text) {
    addMsg('you', text);
    setState('thinking');
    var out;
    try { out = command(text); }
    catch (e) { out = 'Sorry, something went wrong with that request.'; setTimeout(function () { throw e; }); }
    Promise.resolve(out).then(function (r) {
      setTimeout(function () {
        if (!r) { if (vstate === 'thinking') setState('idle'); return; }
        if (typeof r === 'string') respond(r); else respond(r.text, false, r.chips);
      }, J.calm() ? 0 : 280);
    }, function () { respond('Sorry, I couldn\'t complete that. Please try again.'); });
  }
  J.say = respond;

  /* ================= commands ================= */
  var EXAMPLES = ['brief me', 'what\'s due today', 'add task submit report to Dr. Ahmed by Sunday', 'remind me to call HR tomorrow at 10am', 'find internships in Dubai', 'how many applications do I have', 'what\'s on my calendar this week', 'add note bring printed CVs', 'log a win finished the SQL course', 'what\'s my next step', 'what jobs can hire me', 'what should I learn to get more jobs', 'which job should I apply to first'];
  function three() { var a = EXAMPLES.slice().sort(function () { return Math.random() - 0.5; }); return a.slice(0, 3); }
  var SCREENS = [
    [/^(today|home|dashboard|main|start|command)$/, 'today'], [/^(tasks?|to ?dos?|reminders?)$/, 'tasks'], [/^(calendar|schedule|week|week view)$/, 'calendar'],
    [/^(notes?)$/, 'notes'], [/^(jobs?|job finder|job search|internships?|job board)$/, 'jobs'], [/^(applications?|tracker|application tracker|pipeline)$/, 'applications'],
    [/^(growth|skills?|wins?|goals?|certificates?|progress)$/, 'growth'], [/^(weekly review|review|my week)$/, 'review'], [/^(profile|me)$/, 'profile'],
    [/^(settings?|preferences|options)$/, 'settings'], [/^(help|voice commands|commands)$/, 'help'], [/^(blueprint|architecture)$/, 'blueprint']
  ];
  function screenFor(target) {
    var t = String(target || '').replace(/\b(the|my|screen|page|tab|view|section|please|up|for me)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || t.split(' ').length > 3) return null;
    for (var i = 0; i < SCREENS.length; i++) if (SCREENS[i][0].test(t)) return SCREENS[i][1];
    return null;
  }
  function list3(arr, fn) { var shown = arr.slice(0, 3).map(fn), more = arr.length - shown.length; return J.joinList(shown) + (more > 0 ? ', and ' + more + ' more' : ''); }
  var pending = null;
  var ctx = J.ctx = { jobs: [], job: null };
  var YES = /^(yes|yeah|yep|yup|sure|confirm|confirmed|do it|ok|okay|correct|please do|go ahead|affirmative|delete it)\b/;
  var NO = /^(no|nope|nah|cancel|don'?t|do not|stop|never mind|keep it|negative)\b/;
  var ORD = { first: 0, '1st': 0, one: 0, second: 1, '2nd': 1, two: 1, third: 2, '3rd': 2, three: 2, fourth: 3, four: 3, fifth: 4, five: 4 };
  function lower(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
  function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s; }
  function describeJob(j) { return j.title + ' at ' + j.company + ', ' + (j.city === 'Remote' ? 'remote' : j.city) + ', a ' + j.score + '% match.' + (j.scam ? ' Careful: it mentions a fee.' : ''); }

  function command(raw) {
    var original = String(raw).trim();
    var t = original.toLowerCase().replace(/[’‘]/g, '\'')
      .replace(/^(?:hey |ok |okay |hi )?(?:jarvis|jervis|javis)[,:!.]?\s*/, '')
      .replace(/^(?:please|can you|could you|would you|will you)\s+/, '')
      .replace(/[?!.]+$/, '').replace(/\bwhat is\b/g, 'what\'s').replace(/\bwhats\b/g, 'what\'s').replace(/\s+/g, ' ').trim();
    var orig = original.replace(/^(?:hey |ok |okay |hi )?(?:jarvis|jervis|javis)[,:!.]?\s*/i, '').replace(/^(?:please|can you|could you|would you|will you)\s+/i, '').replace(/[?!.]+$/, '').trim();
    var m, name = J.data.profile.name || 'Roshan';
    if (!t) return 'Yes?';

    /* ---- stop / cancel ---- */
    if (/^(stop|stop talking|cancel|quiet|be quiet|shush|enough|never ?mind|shut up|pause|that's all|that's enough|abort)$/.test(t)) {
      var had = !!pending; pending = null; stopSpeaking();
      addMsg('jarvis', had ? 'Cancelled.' : 'Stopped.'); setLive('');
      return '';
    }

    /* ---- answers to a question Jarvis asked ---- */
    if (pending) {
      var pd = pending; pending = null;
      if (pd.type === 'confirmFn') {
        if (YES.test(t)) return pd.yes();
        if (NO.test(t)) return 'Okay, I left it as it is.';
        pending = pd; return 'Please say yes or no.';
      }
      if (pd.type === 'confirmDelete') {
        if (YES.test(t)) { J.removeTask(pd.task.id); return 'Deleted "' + pd.task.title + '".'; }
        if (NO.test(t)) return 'Okay, I kept it.';
        pending = pd; return 'Please say yes to delete "' + pd.task.title + '", or no to keep it.';
      }
      if (NO.test(t) && t.split(' ').length <= 3) return 'Okay, cancelled.';
      if (pd.type === 'askTask') return addTaskFrom(orig, !!pd.reminder);
      if (pd.type === 'askWhen') {
        var tm = J.parseTime(t), dt = J.parseDate(t);
        if (!tm && !dt) { pending = pd; return 'Sorry, when? For example, tomorrow at 10am.'; }
        var due = dt ? dt.date : (tm.date || (tm.time > J.nowHM() ? J.today() : J.addDays(J.today(), 1)));
        var task = J.addTask(Object.assign({}, pd.task, { due: due, time: tm ? tm.time : '' }));
        return 'Done. I\'ll remind you to ' + lower(J.taskPhrase(task)) + ', ' + J.when(task.due, task.time) + '.';
      }
      if (pd.type === 'askNote') { J.addNote(orig); return 'Note saved.'; }
      if (pd.type === 'askFn') return wrapCal(pd.answer(orig, t));
      if (pd.type === 'askWin') { var w = J.addWin(orig); return 'Logged: ' + w.win.text + '. Well done.'; }
    }

    /* ---- NOVA server actions (tasks, notes, forget, memory search) ---- */
    if (J.novaIntent && J.novaIntent(orig)) return J.novaAsk(orig);

    /* ---- repeat, help, test ---- */
    if (/^(repeat( that| it)?|say (that|it) again|come again|pardon|what did you say|again)$/.test(t)) return lastReply ? { text: lastReply } : 'I haven\'t said anything yet.';
    if (/what can you do|^help( me)?$|^commands$|what do you do|what should i say|how do i use (this|you)/.test(t)) {
      return { text: 'I can brief you, manage tasks and reminders, take notes, log wins, find UAE internships and fresher jobs, track applications and read your calendar. Try one of these.', chips: three() };
    }
    if (/^test( your)? voice$/.test(t)) return 'This is Jarvis. Voice systems are working normally.';

    /* ---- voice controls ---- */
    if (/^(voice off|mute|turn off (your |the )?voice|stop speaking out loud|text only|be silent|silent mode|disable voice)$/.test(t)) { J.data.settings.voice = false; J.persist(); stopSpeaking(); syncSwitches(); return 'Voice replies are off. I\'ll answer in text. Say "voice on" to hear me again.'; }
    if (/^(voice on|unmute|turn on (your |the )?voice|speak again|enable voice|talk to me)$/.test(t)) { J.data.settings.voice = true; J.persist(); syncSwitches(); return 'Voice replies are on.'; }
    if (/(turn on|enable|start|switch on|activate) (the )?wake( mode| word)?|^wake mode on$|listen for hey jarvis/.test(t)) { setWake(true, true); return SR ? 'Wake mode is on. Say "Hey Jarvis" followed by your request.' : ERR.unsupported; }
    if (/(turn off|disable|stop|switch off|deactivate) (the )?wake( mode| word)?|^wake mode off$/.test(t)) { setWake(false, true); return 'Wake mode is off.'; }
    if (/(speak|talk) (a bit |a little |more )?(slower|slowly)|slow down/.test(t)) { J.data.settings.rate = Math.max(0.7, Math.round(((+J.data.settings.rate || 1) - 0.15) * 100) / 100); J.persist(); return 'Okay, I\'ll speak more slowly.'; }
    if (/(speak|talk) (a bit |a little |more )?(faster|quicker|quickly)|speed up/.test(t)) { J.data.settings.rate = Math.min(1.4, Math.round(((+J.data.settings.rate || 1) + 0.15) * 100) / 100); J.persist(); return 'Okay, I\'ll speak a little faster.'; }

    /* ---- time and date ---- */
    if (/\b(what time|the time|time is it|current time|time now)\b/.test(t)) return 'It\'s ' + J.timeNow() + ' in Dubai.';
    if (/\b(what's the date|today's date|what day is it|what's today|the date|which day is it|date today)\b/.test(t)) return 'Today is ' + J.longDate(J.today()) + '.';

    /* ---- job matching (matches.js) ---- */
    if (J.matchVoice && !/^(open|go to|goto|take me to|switch to|display|view|bring up|launch)\s/.test(t)) {
      var mr = J.matchVoice(t, orig);
      if (mr) return wrapCal(mr);
    }

    /* ---- calendar (calendar.js): sync, next meeting, free time, add / move / cancel ---- */
    if (J.calVoice && !/^(open|go to|goto|take me to|switch to|display|view|bring up|launch)\s/.test(t)) {
      var calr = J.calVoice(t, orig);
      if (calr) return wrapCal(calr);
    }

    /* ---- navigation ---- */
    if (/^(go back|back|previous screen|go to the previous (screen|page))$/.test(t)) { history.back(); return 'Going back.'; }
    if ((m = t.match(/^(?:open|show|go to|goto|take me to|switch to|display|view|bring up|launch|show me)\s+(.+)$/))) {
      var scr = screenFor(m[1]);
      if (scr === 'blueprint') { setTimeout(function () { location.href = 'blueprint/'; }, 1200); return 'Opening the blueprint.'; }
      if (scr) { J.go(scr); return 'Opening ' + J.titles[scr] + '.'; }
    }

    /* ---- jobs ---- */
    if (/^(save|bookmark|keep|track)( this| that| the)?( job| one| role)?$|^save (it|job \d|the \w+ (job|one))$/.test(t)) {
      var idx = 0, om = t.match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|one|two|three|four|five)\b/), nm = t.match(/job (\d)/);
      if (om) idx = ORD[om[1]]; else if (nm) idx = +nm[1] - 1;
      var job = idx ? ctx.jobs[idx] : (ctx.job || ctx.jobs[0]);
      if (!job) return { text: 'Which job? Ask me to find jobs first, then say "save this job".', chips: ['find internships', 'show new jobs'] };
      var sv = J.jobs.save(job);
      return sv.existed ? job.title + ' at ' + job.company + ' is already in your applications.' : 'Saved ' + job.title + ' at ' + job.company + ' to your applications.' + (job.scam ? ' Careful: this listing mentions a fee or deposit.' : '');
    }
    if (/^(next( one| job)?|another( one)?|skip)$/.test(t) && ctx.jobs.length) {
      var i2 = ctx.jobs.indexOf(ctx.job) + 1;
      if (i2 >= ctx.jobs.length) return 'That was the last one in this list.';
      ctx.job = ctx.jobs[i2];
      return 'Next: ' + describeJob(ctx.job) + ' Say "save this job" to save it.';
    }
    if (/\b(new jobs?|new roles|new openings|new internships|jobs? found)\b/.test(t) && !/^add /.test(t)) {
      return J.jobs.ensure().then(function (c) {
        var nj = J.jobs.newJobs();
        J.go('jobs');
        if (!c.ok.length) return 'I couldn\'t reach the company job boards right now. I\'ve opened the job finder so you can search LinkedIn, Indeed, Bayt and others.';
        if (!nj.length) return 'No new roles since you last looked. ' + J.plural(c.jobs.length, 'fresher-friendly role') + ' in the job finder.';
        ctx.jobs = nj; ctx.job = nj[0];
        return J.plural(nj.length, 'new role') + ' found. The best match is ' + describeJob(nj[0]) + ' Say "save this job" to save it.';
      });
    }
    if ((m = t.match(/^(?:find|search(?: for)?|look for|show(?: me)?|get|any|are there(?: any)?|list)\s+(?:me\s+)?(?:some\s+|any\s+|new\s+|good\s+)?(.*?\b(?:internships?|intern|jobs?|roles?|positions?|openings?|vacanc(?:y|ies)|graduate programmes?|traineeships?)\b.*)$/))) {
      var q = m[1];
      var level = /intern/.test(q) ? 'intern' : /graduate|grad\b/.test(q) ? 'graduate' : /trainee/.test(q) ? 'trainee' : /fresher|entry|junior|first job/.test(q) ? 'fresher' : 'all';
      var city = 'all';
      J.CITIES.forEach(function (c) { if (new RegExp('\\b' + c.toLowerCase() + '\\b').test(q)) city = c; });
      if (/\bremote\b/.test(q)) city = 'Remote';
      var kw = q.replace(/\b(internships?|intern|jobs?|roles?|positions?|openings?|vacanc(?:y|ies)|graduate|grad|trainee(?:ships?)?|programmes?|fresher|entry level|entry|junior|first|in|at|for|the|uae|remote|abu dhabi|dubai|sharjah|ajman|ras al khaimah|fujairah|umm al quwain|al ain)\b/g, ' ').replace(/\s+/g, ' ').trim();
      J.ui.jlevel = level; J.ui.jcity = city; J.ui.jq = kw; J.ui.sLevel = level === 'intern' ? 'internship' : level === 'graduate' ? 'graduate' : 'fresher'; J.ui.sCity = city === 'all' || city === 'Remote' ? '' : city;
      return J.jobs.ensure().then(function (c) {
        var found = J.jobs.filter({ level: level, city: city, q: kw });
        J.go('jobs');
        var one = found.length === 1;
        var what = (level === 'intern' ? 'internship' : level === 'graduate' ? 'graduate role' : level === 'trainee' ? 'trainee role' : level === 'fresher' ? 'fresher role' : 'entry-level role') + (one ? '' : 's') + (kw ? ' for ' + kw : '') + (city !== 'all' ? (city === 'Remote' ? ' that are remote' : ' in ' + city) : ' in the UAE');
        if (!c.ok.length) return 'I couldn\'t reach the company job boards right now. I\'ve opened the job finder with one-click searches for ' + what + ' on LinkedIn, Indeed, Bayt and others.';
        if (!found.length) return 'I found no live ' + what + ' on the company boards right now. Use the one-click searches I\'ve opened to check LinkedIn, Indeed, Bayt and others.';
        ctx.jobs = found; ctx.job = found[0];
        return 'I found ' + found.length + ' ' + what + '. The best match is ' + describeJob(found[0]) + ' Say "save this job", or "next" to hear another.';
      });
    }

    /* ---- applications ---- */
    if (/\b(how many applications|applications? (count|status|summary)|my applications|application status|how are my applications)\b/.test(t)) {
      var apps = J.data.apps;
      if (!apps.length) return 'You have no applications yet. Say "find internships" to get started.';
      var by = {}; apps.forEach(function (a) { by[a.stage] = (by[a.stage] || 0) + 1; });
      var parts = J.STAGES.filter(function (s) { return by[s[0]]; }).map(function (s) { return by[s[0]] + ' ' + s[1].toLowerCase(); });
      var goal = +J.data.settings.weeklyGoal || 0, sent = J.appsThisWeek().length;
      return 'You have ' + J.plural(apps.length, 'application') + ': ' + J.joinList(parts) + '. This week you\'ve sent ' + sent + (goal ? ' of your goal of ' + goal : '') + '.';
    }
    if (/\b(deadlines?|interviews?)\b/.test(t) && /\b(coming|upcoming|next|any|what|when|my|soon)\b/.test(t)) {
      var dl = J.deadlines(14).filter(function (x) { return x.kind !== 'task'; });
      if (!dl.length) return 'No application deadlines or interviews in the next two weeks.';
      return J.plural(dl.length, 'item') + ' coming up: ' + list3(dl, function (x) { return x.text.replace(/^Application deadline: /, 'deadline for ') + ', ' + J.when(x.date, x.time); }) + '.';
    }

    /* ---- growth and notes ---- */
    if ((m = orig.match(/^(?:log|add|record|save|note)\s+(?:a |an |another |new |my )?(win|achievement|accomplishment|certificate|certification)\s*[:,-]?\s*(.*)$/i)) || (m = orig.match(/^(win)\s*[:,-]\s*(.+)$/i))) {
      var wtext = m[2].replace(/^(that )?i /i, '').trim();
      if (!wtext) { pending = { type: 'askWin' }; return 'What would you like to log?'; }
      var res = J.addWin(wtext, /certif/i.test(m[1]) ? 'certificate' : null);
      return 'Logged: ' + res.win.text + (res.skill ? ', under ' + res.skill.name : '') + '. Well done.';
    }
    if ((m = orig.match(/^(?:add|take|make|new|save|create|write)\s+(?:a\s+)?note\s*[:,-]?\s*(?:that\s+)?(.*)$/i)) || (m = orig.match(/^note\s*[:,-]\s*(.+)$/i)) || (m = orig.match(/^(?:remember|note) that\s+(.+)$/i))) {
      if (!m[1].trim()) { pending = { type: 'askNote' }; return 'What should the note say?'; }
      J.addNote(m[1].trim());
      return 'Note saved.';
    }
    if (/\b(read|show|tell me|what are|list|go through)\b.*\bnotes?\b|^my notes$/.test(t)) {
      var notes = J.data.notes.slice().sort(function (a, b) { return b.updated - a.updated; });
      if (!notes.length) return 'You have no notes yet. Say "add note" followed by the text.';
      var top = notes.slice(0, 3).map(function (n, i) { return (i + 1) + '. ' + clip(n.text, 140); });
      return 'You have ' + J.plural(notes.length, 'note') + '. ' + (notes.length > 1 ? 'The latest: ' : '') + top.join(' ');
    }

    /* ---- tasks ---- */
    if ((m = t.match(/^(?:delete|remove|erase|get rid of|cancel)\s+(?:the\s+)?(?:task|todo|to-do|reminder)\s+(.+)$/)) || (m = t.match(/^(?:delete|remove|erase)\s+(.+)$/))) {
      var dq = m[1].replace(/^(?:called|named)\s+/, '');
      var dt2 = J.findTask(dq, true);
      if (!dt2) return 'I couldn\'t find a task matching "' + dq + '".';
      pending = { type: 'confirmDelete', task: dt2 };
      return 'Delete the task "' + dt2.title + '"? Say yes or no.';
    }
    if ((m = t.match(/^(?:mark|tick|tick off|check off|set)\s+(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished)$/)) ||
        (m = t.match(/^(?:complete|finish|close|done with|i finished|i've finished|i have finished|i completed|i've done|i have done|i did)\s+(.+)$/)) ||
        (m = t.match(/^(.+?)\s+is\s+(?:done|complete|finished)$/))) {
      var q2 = m[1].replace(/^(?:the\s+)?(?:task\s+)?/, '');
      var c2 = J.findTask(q2);
      if (!c2) {
        var any = J.findTask(q2, true);
        if (any && any.status === 'done') return '"' + any.title + '" is already done.';
        return 'I couldn\'t find an open task matching "' + q2 + '".';
      }
      J.setTaskDone(c2.id, true);
      var left = J.overdue().length + J.dueToday().length;
      return 'Done: ' + c2.title + '.' + (left ? ' ' + J.plural(left, 'task') + ' still need' + (left === 1 ? 's' : '') + ' attention today.' : ' You\'re clear for today.');
    }
    if (/^(add|create|new|make|set)( a| another| new)? (task|to-?do|reminder)\b|^(remind me|i need to|i have to|i must|i'll |i will |set a reminder)/.test(t)) {
      return addTaskFrom(orig, /^(remind me|set a reminder)/.test(t));
    }

    /* ---- briefings and questions ---- */
    if (/\b(brief me|briefing|good morning|good afternoon|good evening|morning jarvis|my day|catch me up|status report|daily summary|update me|what's up|what's happening)\b/.test(t)) return briefing();
    if (/\b(overdue|late|slipped|behind|missed)\b/.test(t)) {
      var o = J.overdue();
      return o.length ? J.plural(o.length, 'overdue task') + ': ' + list3(o, J.taskPhrase) + '.' : 'Nothing is overdue.';
    }
    if (/\b(due today|today's tasks|for today|on today|have today|do today|today)\b/.test(t)) {
      var d = J.dueToday(), o2 = J.overdue().length;
      return (d.length ? J.plural(d.length, 'task') + ' due today: ' + list3(d, function (x) { return J.taskPhrase(x) + (x.time ? ' at ' + J.fmtTime(x.time) : ''); }) + '.' : 'Nothing is due today.') + (o2 ? ' Also ' + J.plural(o2, 'overdue task') + '.' : '');
    }
    if (/\b(this week|coming up|upcoming|rest of the week|due soon|by friday|end of the week)\b/.test(t)) {
      var w2 = J.dueWeek();
      if (!w2.length) return 'Nothing else is due before the weekend.';
      return J.plural(w2.length, 'task') + ' due later this week: ' + list3(w2, function (x) { return J.taskPhrase(x) + ', ' + J.when(x.due, x.time); }) + '.';
    }
    if (/\b(next step|what should i (do|work on|focus on)|what's next|priority|priorities|focus)\b/.test(t)) return 'Your next step: ' + J.nextStep().text;
    if (/\b(how was my week|weekly review|my week|week in review|review my week)\b/.test(t)) {
      var r = J.weekReview();
      return 'This week you finished ' + J.plural(r.finished.length, 'task') + ', sent ' + J.plural(r.applied.length, 'application') + ' and logged ' + J.plural(r.wins.length, 'win') + '. ' + (r.slipped.length ? J.plural(r.slipped.length, 'task') + ' slipped. ' : 'Nothing slipped. ') + 'Next step: ' + r.next.text;
    }

    /* ---- screen name alone ---- */
    var bare = screenFor(t);
    if (bare && bare !== 'blueprint') { J.go(bare); return 'Opening ' + J.titles[bare] + '.'; }

    /* ---- small talk ---- */
    if (/^(hi|hello|hey|hiya|yo|good day|salam|salaam|marhaba)( there)?$/.test(t)) return 'Hello ' + name + '. How can I help?';
    if (/\b(thank you|thanks|cheers|great job|well done|nice one)\b/.test(t)) return 'You\'re welcome.';
    if (/\b(who are you|your name|what are you)\b/.test(t)) return 'I\'m Jarvis, your personal assistant. Everything I know stays in this browser.';
    if (/^(yes|no|yeah|nope|ok|okay)$/.test(t)) return 'Okay.';

    if (J.novaAsk) { var na = J.novaAsk(orig); if (na) return na; }
    if (J.smart && J.smart.ready() && J.smart.interpret) {
      return J.smart.interpret(orig).then(function (r) { return r ? wrapCal(r) : { text: 'Sorry, I didn\'t catch that. You could try one of these.', chips: three() }; });
    }
    return { text: 'Sorry, I didn\'t catch that. You could try one of these.', chips: three() };
  }
  // Calendar replies may be text, a promise, a yes/no question or a follow-up question.
  function wrapCal(r) {
    if (r && typeof r === 'object' && typeof r.then !== 'function' && (r.confirm || r.ask)) {
      pending = r.confirm ? { type: 'confirmFn', yes: r.confirm } : { type: 'askFn', answer: r.ask };
      return r.text;
    }
    return r;
  }
  function addTaskFrom(text, isReminder) {
    if (/^(?:add|create|new|make|set)(?: a| another| new)? (?:task|to-?do|reminder)$|^(?:remind me|set a reminder)$/i.test(text.trim())) { pending = { type: 'askTask', reminder: isReminder }; return 'What\'s the task?'; }
    var pt = J.parseTask(text);
    if (!pt.title || /^(a |an )?(task|reminder|to-?do)$/i.test(pt.title)) { pending = { type: 'askTask' }; return 'What\'s the task?'; }
    if (isReminder && !pt.due && !pt.time) { pending = { type: 'askWhen', task: pt }; return 'When should I remind you?'; }
    var task = J.addTask(pt);
    var when = task.due ? J.when(task.due, task.time) : 'no date';
    return (isReminder || task.time ? 'Done. I\'ll remind you to ' + lower(J.taskPhrase(task)) + ', ' : 'Added: ' + J.taskPhrase(task) + ', ') + when + (task.priority === 'high' ? ', high priority' : '') + '.';
  }
  function briefing() {
    var name = J.data.profile.name || 'Roshan';
    var o = J.overdue(), d = J.dueToday(), dl = J.deadlines(3).filter(function (x) { return x.kind !== 'task'; }), ns = J.nextStep();
    var nj = J.jobs ? J.jobs.newJobs().length : 0;
    var out = [J.greeting() + ', ' + name + '. It\'s ' + J.spokenDate(J.today()) + ', ' + J.timeNow() + '.'];
    out.push(o.length ? (o.length === 1 ? '1 task is' : o.length + ' tasks are') + ' overdue, including ' + J.taskPhrase(o[0]) + '.' : 'Nothing is overdue.');
    out.push(d.length ? J.plural(d.length, 'task') + ' due today: ' + list3(d, J.taskPhrase) + '.' : 'Nothing is due today.');
    if (dl.length) out.push('Coming up: ' + dl[0].text.replace(/^Application deadline: /, 'deadline for ') + ', ' + J.when(dl[0].date, dl[0].time) + '.');
    if (nj) out.push(J.plural(nj, 'new job') + ' in the job finder.');
    out.push('Next step: ' + ns.text);
    return out.join(' ');
  }

  /* ================= hooks ================= */
  document.addEventListener('jarvis:rendered', function (e) {
    orb.dirty = true;
    if (e.detail.view === 'settings') fillVoiceSelect();
    setState(vstate);
  });
  function announce(text) {
    beep('alert');
    addMsg('jarvis', text);
    if (vstate !== 'listening') { setLive(text); speak(text); }
  }

  setState('idle');
  addMsg('jarvis', 'Hello ' + (J.data.profile.name || 'Roshan') + '. Tap the core or press J to talk, or type here.', ['brief me', 'what can you do']);

  J.voice = {
    listen: listen, coreTap: coreTap, run: function (text) { handle(text); }, command: command, speak: speak, stop: stopSpeaking,
    announce: announce, open: openChat, close: closeChat, state: function () { return vstate; },
    supported: { listen: !!SR, speak: !!synth },
    settingsChanged: function (k) {
      if (k === 'voiceURI') { pickVoice(); fillVoiceSelect(); if (J.data.settings.voice) speak('This is how I sound.'); }
      if (k === 'wake') setWake(!!J.data.settings.wake, false);
      if (k === 'voice' && !J.data.settings.voice) stopSpeaking();
      if (k === 'sounds' && J.data.settings.sounds) beep('ok');
    }
  };
})();

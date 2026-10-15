/* Jarvis: voice, chat, the animated core, background and start-up screen.
   Uses only the browser's built-in speech recognition and speech synthesis. No paid services. */
(function () {
  'use strict';

  var J = window.Jarvis;
  if (!J) return;
  var body = document.body;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var synth = window.speechSynthesis || null;
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  /* ================= start-up screen ================= */
  (function boot() {
    var el = $('#boot');
    if (!el) return;
    if (document.documentElement.classList.contains('no-boot')) { el.remove(); return; }
    try { sessionStorage.setItem('jarvis.booted', '1'); } catch (e) { /* private mode */ }
    var done = false;
    function end() {
      if (done) return;
      done = true;
      el.classList.add('out');
      window.removeEventListener('keydown', end);
      setTimeout(function () { el.remove(); }, 450);
    }
    el.addEventListener('click', end);
    window.addEventListener('keydown', end);
    setTimeout(end, 1500);
  })();

  /* ================= background: drifting dots joined by thin lines ================= */
  (function background() {
    var c = $('#bgfx');
    if (!c || !c.getContext) return;
    var ctx = c.getContext('2d'), w = 0, h = 0, pts = [];
    function seed() {
      var n = Math.min(80, Math.round(w * h / 18000));
      pts = [];
      for (var i = 0; i < n; i++) pts.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.16, vy: (Math.random() - 0.5) * 0.16, r: Math.random() * 1.1 + 0.4 });
    }
    function size() {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var nw = window.innerWidth, nh = window.innerHeight, reseed = Math.abs(nw - w) > 80 || !pts.length;
      w = nw; h = nh;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reseed) seed();
      draw(false);
    }
    function draw(move) {
      ctx.clearRect(0, 0, w, h);
      var i, j, p, q, dx, dy, d2, max = 130 * 130;
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        if (move) {
          p.x += p.vx; p.y += p.vy;
          if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
          if (p.y < -10) p.y = h + 10; else if (p.y > h + 10) p.y = -10;
        }
      }
      ctx.lineWidth = 0.6;
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        for (j = i + 1; j < pts.length; j++) {
          q = pts[j]; dx = p.x - q.x; dy = p.y - q.y; d2 = dx * dx + dy * dy;
          if (d2 < max) {
            ctx.strokeStyle = 'rgba(95,216,255,' + (0.11 * (1 - d2 / max)).toFixed(3) + ')';
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
        }
      }
      ctx.fillStyle = 'rgba(140,220,255,0.38)';
      for (i = 0; i < pts.length; i++) { p = pts[i]; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill(); }
    }
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(size, 150); });
    size();
    var last = 0;
    function loop(ts) {
      // ~30 fps is plenty for a faint background.
      if (!document.hidden && !J.calm() && ts - last > 32) { draw(true); last = ts; }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  })();

  /* ================= voice state ================= */
  var vstate = 'idle';
  var STATE_TEXT = { idle: 'Voice ready', listening: 'Listening…', speaking: 'Speaking' };
  function setState(s) {
    vstate = s;
    body.setAttribute('data-voice', s);
    var chip = $('#voiceChip');
    var txt = STATE_TEXT[s];
    if (s === 'idle' && hey.on) txt = 'Hey Jarvis: on';
    if (s === 'idle' && !SR) txt = 'Type to Jarvis';
    if (chip) chip.textContent = txt;
    var cs = $('#chatState'); if (cs) cs.textContent = s === 'idle' ? (hey.on ? 'Say "Hey Jarvis"' : 'Ready') : txt;
    var cap = $('#orbCaption'); if (cap) cap.textContent = s === 'listening' ? 'Listening' : s === 'speaking' ? 'Tap to stop' : 'Tap to talk';
    var ob = $('#orbBtn'); if (ob) ob.setAttribute('aria-label', s === 'idle' ? 'Talk to Jarvis' : s === 'listening' ? 'Stop listening' : 'Stop Jarvis speaking');
    orb.dirty = true;
  }
  function setLine(text) {
    var el = $('#voiceLine');
    if (el) el.textContent = text || '';
  }

  /* ================= the core orb ================= */
  var orb = { c: null, ctx: null, t: 0, col: [80, 186, 255], energy: 0.25, level: 0, pulse: 0, dirty: true, w: 0 };
  var TARGET = {
    idle: { col: [80, 186, 255], e: 0.25 },
    listening: { col: [120, 236, 255], e: 1 },
    speaking: { col: [244, 196, 104], e: 0.6 }
  };
  function bindOrb() {
    orb.c = $('#coreOrb');
    orb.ctx = orb.c && orb.c.getContext ? orb.c.getContext('2d') : null;
    orb.w = 0; orb.dirty = true;
  }
  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')'; }
  function drawOrb() {
    var c = orb.c, ctx = orb.ctx;
    if (!c || !ctx || !c.isConnected) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1), cw = c.clientWidth;
    if (!cw) return;
    if (cw !== orb.w) { orb.w = cw; c.width = Math.round(cw * dpr); c.height = Math.round(cw * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var s = cw, cx = s / 2, cy = s / 2, R = s * 0.3, t = orb.t, col = orb.col, e = orb.energy, lv = orb.level;
    ctx.clearRect(0, 0, s, s);

    // soft outer glow
    var g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.65);
    g.addColorStop(0, rgba(col, 0.22 + e * 0.12 + lv * 0.2));
    g.addColorStop(0.45, rgba(col, 0.07 + e * 0.05 + lv * 0.06));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.65, 0, 6.2832); ctx.fill();

    // speaking ripples
    if (lv > 0.02) {
      for (var k = 0; k < 3; k++) {
        var ph = (t * 0.55 + k / 3) % 1;
        ctx.strokeStyle = rgba(col, (1 - ph) * 0.35 * lv);
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(cx, cy, R * (0.55 + ph * 0.95), 0, 6.2832); ctx.stroke();
      }
    }

    // tick ring
    var ticks = 72, tr = R * 1.32;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.05);
    for (var i = 0; i < ticks; i++) {
      var a = i / ticks * 6.2832, long = i % 6 === 0;
      ctx.strokeStyle = rgba(col, long ? 0.45 : 0.18);
      ctx.lineWidth = long ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * tr, Math.sin(a) * tr);
      ctx.lineTo(Math.cos(a) * (tr + (long ? 7 : 3.5)), Math.sin(a) * (tr + (long ? 7 : 3.5)));
      ctx.stroke();
    }
    ctx.restore();

    // rotating rings (segmented arcs, gently tilted)
    var rings = [
      { r: 1.0, w: 1.6, speed: 0.35, segs: [[0, 1.6], [2.0, 3.3], [3.7, 5.6]], tilt: 1, alpha: 0.8 },
      { r: 1.14, w: 1.1, speed: -0.22, segs: [[0.4, 1.1], [1.5, 2.9], [3.4, 4.0], [4.5, 6.0]], tilt: 0.92, alpha: 0.55 },
      { r: 0.84, w: 2.4, speed: 0.6, segs: [[0, 0.9], [3.14, 4.04]], tilt: 1, alpha: 0.65 }
    ];
    var boost = 1 + e * 2.2;
    rings.forEach(function (rg, idx) {
      ctx.save(); ctx.translate(cx, cy);
      ctx.rotate(t * rg.speed * boost + idx);
      ctx.scale(1, rg.tilt);
      ctx.strokeStyle = rgba(col, rg.alpha * (0.7 + e * 0.3));
      ctx.lineWidth = rg.w; ctx.lineCap = 'round';
      ctx.shadowColor = rgba(col, 0.8); ctx.shadowBlur = 6 + e * 8;
      rg.segs.forEach(function (sg) { ctx.beginPath(); ctx.arc(0, 0, R * rg.r, sg[0], sg[1]); ctx.stroke(); });
      ctx.restore();
    });

    // listening wave ring
    if (vstate === 'listening' || e > 0.6) {
      ctx.save(); ctx.translate(cx, cy);
      ctx.strokeStyle = rgba(col, 0.5 * e); ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var n = 0; n <= 120; n++) {
        var an = n / 120 * 6.2832;
        var rr = R * 0.66 + Math.sin(an * 6 + t * 5) * R * 0.035 * e + Math.sin(an * 11 - t * 7) * R * 0.02 * e;
        if (n === 0) ctx.moveTo(Math.cos(an) * rr, Math.sin(an) * rr); else ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
      }
      ctx.stroke(); ctx.restore();
    }

    // inner sphere edge
    ctx.strokeStyle = rgba(col, 0.25); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.56, 0, 6.2832); ctx.stroke();

    // core light
    var cr = R * (0.44 + lv * 0.12 + Math.sin(t * 1.4) * 0.015);
    var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    cg.addColorStop(0, 'rgba(255,255,255,' + (0.85 + lv * 0.15).toFixed(3) + ')');
    cg.addColorStop(0.25, rgba(col, 0.9));
    cg.addColorStop(0.6, rgba(col, 0.32 + e * 0.1));
    cg.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, cr, 0, 6.2832); ctx.fill();
  }
  var lastTs = 0;
  function orbLoop(ts) {
    var dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    var tg = TARGET[vstate] || TARGET.idle;
    if (J.calm()) {
      // No motion: snap to the state and draw a still frame only when something changes.
      if (orb.dirty) { orb.col = tg.col.slice(); orb.energy = tg.e; orb.level = vstate === 'speaking' ? 0.5 : 0; drawOrb(); orb.dirty = false; }
    } else if (!document.hidden && orb.c) {
      orb.t += dt;
      var k = 1 - Math.pow(0.02, dt);
      for (var i = 0; i < 3; i++) orb.col[i] += (tg.col[i] - orb.col[i]) * k;
      orb.energy += (tg.e - orb.energy) * k;
      orb.pulse *= Math.pow(0.04, dt);
      var lvTarget = 0;
      if (vstate === 'speaking') {
        // Speech synthesis gives no audio level, so the pulse follows word boundaries plus a gentle voice-like rhythm.
        lvTarget = 0.3 + 0.35 * Math.abs(Math.sin(orb.t * 7.3) * Math.sin(orb.t * 2.9)) + orb.pulse * 0.45;
      }
      orb.level += (lvTarget - orb.level) * Math.min(1, dt * 12);
      drawOrb();
    }
    requestAnimationFrame(orbLoop);
  }
  requestAnimationFrame(orbLoop);
  if (J.calm && window.matchMedia) {
    var mq = matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.addEventListener) mq.addEventListener('change', function () { orb.dirty = true; });
  }

  /* ================= speaking ================= */
  var voices = [], chosen = null, speakId = 0;
  var PREFERRED = ['Google UK English Male', 'Microsoft Ryan', 'Microsoft George', 'Microsoft Thomas', 'Microsoft Alfie', 'Daniel', 'Arthur', 'Oliver', 'Male'];
  var FEMALE = /female|kate|serena|martha|stephanie|libby|sonia|hazel|susan|fiona|moira|tessa|karen|samantha|victoria|zira|amy|emma|mia|maisie|catherine|bella|abbi|hollie/i;
  function loadVoices() {
    voices = synth ? synth.getVoices() : [];
    pickVoice();
    fillVoiceSelect();
  }
  function pickVoice() {
    chosen = null;
    var saved = J.state.settings.voice;
    if (saved) chosen = voices.filter(function (v) { return v.voiceURI === saved; })[0] || null;
    if (chosen) return;
    var gb = voices.filter(function (v) { return /en[-_]GB/i.test(v.lang); });
    for (var i = 0; i < PREFERRED.length && !chosen; i++) {
      var name = PREFERRED[i];
      chosen = gb.filter(function (v) { return v.name.indexOf(name) >= 0 && !(name === 'Male' && /female/i.test(v.name)); })[0] || null;
    }
    if (!chosen) chosen = gb.filter(function (v) { return !FEMALE.test(v.name); })[0] || gb[0] ||
      voices.filter(function (v) { return /^en/i.test(v.lang) && !FEMALE.test(v.name); })[0] ||
      voices.filter(function (v) { return /^en/i.test(v.lang); })[0] || null;
  }
  function fillVoiceSelect() {
    var sel = $('#voiceSelect');
    if (!sel) return;
    var saved = J.state.settings.voice;
    var en = voices.filter(function (v) { return /^en/i.test(v.lang); });
    sel.innerHTML = '<option value="">Automatic (British English male if available)</option>' + en.map(function (v) {
      var o = document.createElement('option');
      o.value = v.voiceURI; o.textContent = v.name + ' (' + v.lang + ')';
      if (v.voiceURI === saved) o.selected = true;
      return o.outerHTML;
    }).join('');
    var sup = $('#voiceSupport');
    if (sup) {
      var bits = [];
      bits.push(SR ? 'Listening works in this browser.' : 'This browser cannot listen. Type to Jarvis instead, or use Chrome, Edge or Safari.');
      bits.push(synth ? (chosen ? 'Current voice: ' + chosen.name + '.' : 'Using the default voice.') : 'This browser cannot speak replies.');
      sup.textContent = bits.join(' ');
    }
  }
  if (synth) {
    loadVoices();
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', loadVoices);
    else synth.onvoiceschanged = loadVoices;
  }

  function speak(text) {
    if (!synth || !text || !J.state.settings.speak) return;
    var id = ++speakId;
    synth.cancel();
    if (synth.paused) synth.resume();
    // Speak sentence by sentence: Chrome cuts off long single utterances.
    var parts = String(text).replace(/[“”"]/g, '').match(/[^.!?]+[.!?]*/g) || [text];
    parts = parts.map(function (p) { return p.trim(); }).filter(Boolean);
    var rate = +J.state.settings.rate || 1;
    parts.forEach(function (p, i) {
      var u = new SpeechSynthesisUtterance(p);
      if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else u.lang = 'en-GB';
      u.rate = rate; u.pitch = 0.92;
      u.onstart = function () { if (id === speakId && vstate !== 'speaking') setState('speaking'); };
      u.onboundary = function () { orb.pulse = 1; };
      if (i === parts.length - 1) u.onend = u.onerror = function () { if (id === speakId) doneSpeaking(); };
      synth.speak(u);
    });
  }
  function doneSpeaking() {
    hey.ignoreUntil = Date.now() + 350;
    setState(hey.awaiting ? 'listening' : 'idle');
  }
  function stopSpeaking() {
    speakId++;
    if (synth) synth.cancel();
    if (vstate === 'speaking') setState('idle');
  }

  /* ================= listening (tap to talk) ================= */
  var rec = null;
  function listen() {
    if (rec) { stopListening(); return; }
    if (!SR) {
      openChat(true);
      respond('I can\'t listen in this browser. Chrome, Edge or Safari work best. You can type to me here instead.');
      return;
    }
    stopSpeaking();
    pauseHey();
    var finalText = '', err = '';
    var r = new SR();
    r.lang = 'en-GB'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    r.onstart = function () { setState('listening'); setLine('Listening…'); };
    r.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
      }
      setLine('“' + (finalText + interim).trim() + '”');
    };
    r.onerror = function (e) { err = e.error || 'error'; };
    r.onend = function () {
      rec = null;
      if (vstate === 'listening') setState('idle');
      var text = finalText.trim();
      if (text) handle(text);
      else if (err === 'not-allowed' || err === 'service-not-allowed') respond('I need permission to use the microphone. Allow it in your browser settings, or type to me instead.');
      else if (err === 'no-speech') setLine('I didn\'t hear anything. Tap the core to try again.');
      else if (err === 'network') respond('Speech recognition needs an internet connection in this browser. You can type to me instead.');
      else setLine('');
      setTimeout(resumeHey, 400);
    };
    rec = r;
    try { r.start(); } catch (e) { rec = null; setState('idle'); resumeHey(); }
  }
  function stopListening() {
    if (rec) { try { rec.stop(); } catch (e) { /* already stopped */ } }
  }
  function orbTap() {
    if (vstate === 'speaking') { stopSpeaking(); setLine('Stopped.'); }
    else if (rec) stopListening();
    else listen();
  }

  /* ================= "Hey Jarvis" mode ================= */
  var hey = { on: false, rec: null, paused: false, awaiting: false, timer: null, ignoreUntil: 0, armed: false };
  function setHey(on, quiet) {
    hey.on = !!on && !!SR;
    J.state.settings.hey = hey.on;
    J.persist();
    $$('[data-hey]').forEach(function (el) { el.checked = hey.on; });
    if (hey.on) { startHey(); if (!quiet) respond('Hey Jarvis mode is on. Say "Hey Jarvis" followed by your request.'); }
    else { stopHey(); if (!quiet && on === false) J.toast('Hey Jarvis mode is off.'); }
    if (on && !SR) respond('This browser can\'t listen, so Hey Jarvis mode is not available. Try Chrome, Edge or Safari.');
    setState(vstate);
  }
  function startHey() {
    if (!SR || !hey.on || hey.rec || hey.paused || rec || document.hidden) return;
    var r = new SR();
    r.lang = 'en-GB'; r.continuous = true; r.interimResults = false;
    r.onresult = function (e) {
      for (var i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) heard(e.results[i][0].transcript);
    };
    r.onerror = function (e) {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        hey.on = false; J.state.settings.hey = false; J.persist();
        $$('[data-hey]').forEach(function (el) { el.checked = false; });
        respond('Hey Jarvis mode needs microphone permission. I have switched it off.');
      }
    };
    r.onend = function () {
      hey.rec = null;
      if (hey.on && !hey.paused) setTimeout(startHey, 350);
    };
    hey.rec = r;
    try { r.start(); } catch (e) { hey.rec = null; }
  }
  function stopHey() {
    clearAwait();
    if (hey.rec) { var r = hey.rec; hey.rec = null; r.onend = null; try { r.abort(); } catch (e) { /* ignore */ } }
  }
  function pauseHey() { hey.paused = true; stopHey(); }
  function resumeHey() { hey.paused = false; startHey(); }
  function clearAwait() { hey.awaiting = false; clearTimeout(hey.timer); }
  function heard(raw) {
    var t = String(raw || '').toLowerCase().trim();
    if (!t) return;
    if (vstate === 'speaking') {
      // While Jarvis talks, only listen for an interruption (it may hear its own voice).
      if (/\b(stop|cancel|quiet|enough|shut up|pause)\b/.test(t)) { stopSpeaking(); setLine('Stopped.'); }
      return;
    }
    if (Date.now() < hey.ignoreUntil && !hey.awaiting) return;
    var m = t.match(/(?:\b(?:hey|hi|ok|okay|hello)\s+)?\bjarvis\b[\s,.:!?]*(.*)$/);
    if (m) {
      var cmd = m[1].trim();
      if (cmd) { clearAwait(); handle(cmd); }
      else {
        hey.awaiting = true;
        setState('listening');
        respond('Yes?', true);
        clearTimeout(hey.timer);
        hey.timer = setTimeout(function () { hey.awaiting = false; if (vstate === 'listening' && !rec) setState('idle'); }, 9000);
      }
      return;
    }
    if (hey.awaiting) { clearAwait(); handle(t); }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopHey(); stopSpeaking(); }
    else if (hey.on) startHey();
  });
  // Browsers only allow the microphone after the person interacts with the page.
  function armHey() {
    if (hey.armed) return;
    hey.armed = true;
    if (J.state.settings.hey) setHey(true, true);
  }
  window.addEventListener('pointerdown', armHey, { once: true });
  window.addEventListener('keydown', armHey, { once: true });

  /* ================= chat panel ================= */
  var log = $('#chatLog'), chat = $('#chat'), mini = $('#miniOrb');
  function addMsg(who, text) {
    if (!log) return;
    var li = document.createElement('li');
    li.className = 'msg ' + who;
    var w = document.createElement('span'); w.className = 'who mono'; w.textContent = who === 'you' ? 'You' : 'Jarvis';
    var p = document.createElement('p'); p.textContent = text;
    li.appendChild(w); li.appendChild(p);
    log.appendChild(li);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  function openChat(focus) {
    chat.hidden = false;
    mini.setAttribute('aria-expanded', 'true');
    mini.setAttribute('aria-label', 'Close chat with Jarvis');
    body.classList.add('chat-open');
    log.scrollTop = log.scrollHeight;
    if (focus) $('#chatInput').focus();
  }
  function closeChat() {
    chat.hidden = true;
    mini.setAttribute('aria-expanded', 'false');
    mini.setAttribute('aria-label', 'Open chat with Jarvis');
    body.classList.remove('chat-open');
  }
  mini.addEventListener('click', function () { if (chat.hidden) openChat(true); else { closeChat(); mini.focus(); } });
  $('#chatClose').addEventListener('click', function () { closeChat(); mini.focus(); });
  $('#chatForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var inp = $('#chatInput'), v = inp.value.trim();
    if (!v) return;
    inp.value = '';
    handle(v);
  });
  $('#chatInput').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); closeChat(); mini.focus(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.hasAttribute('data-hey')) setHey(e.target.checked);
    if (e.target.hasAttribute('data-speak')) {
      J.state.settings.speak = e.target.checked; J.persist();
      $$('[data-speak]').forEach(function (el) { el.checked = e.target.checked; });
      if (!e.target.checked) stopSpeaking();
    }
  });
  $$('[data-speak]').forEach(function (el) { el.checked = J.state.settings.speak; });
  $$('[data-hey]').forEach(function (el) { el.checked = !!J.state.settings.hey; });

  /* ================= keyboard ================= */
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (document.querySelector('dialog[open]') || $('#boot')) return;
    var tg = e.target, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable;
    if (!typing && (e.key === 'j' || e.key === 'J')) { e.preventDefault(); listen(); }
    else if (e.key === 'Escape') {
      if (vstate === 'speaking') stopSpeaking();
      else if (rec) stopListening();
      else if (!chat.hidden && !typing) { closeChat(); mini.focus(); }
    }
  });

  /* ================= replies ================= */
  function respond(text, silentLog) {
    if (!text) return;
    if (!silentLog) addMsg('jarvis', text);
    setLine(text);
    speak(text);
  }
  function handle(text) {
    addMsg('you', text);
    var reply;
    try { reply = command(text); }
    catch (e) { reply = 'Sorry, something went wrong with that request.'; }
    if (reply) respond(reply);
  }

  /* ================= commands ================= */
  var HELP = 'I can brief you, tell you what\'s overdue, due today or coming up this week, add a reminder, mark something as done, log a win, suggest your next step, add an opportunity, open any screen, and tell you the time or date. Try "remind me to send the report to Omar by Friday".';
  var SCREENS = [
    [/^(today|home|dashboard|main|start)$/, 'today'],
    [/^(commitments?|promises?|tasks?|to ?dos?|reminders?)$/, 'commitments'],
    [/^(growth|skills?|wins?|goals?|progress)$/, 'growth'],
    [/^(opportunit(y|ies)|jobs?|roles?|pipeline|projects?|courses?)$/, 'opportunities'],
    [/^(weekly review|review|week|my week)$/, 'review'],
    [/^(approvals?|drafts?|messages?|inbox)$/, 'approvals'],
    [/^(profile|my profile|settings|people|me)$/, 'profile'],
    [/^(blueprint|architecture|presentation|plan)$/, 'blueprint']
  ];
  function screenFor(target) {
    var t = target.replace(/\b(the|my|me|screen|page|tab|view|section|please|up)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    if (t.split(' ').length > 2) return null;
    for (var i = 0; i < SCREENS.length; i++) if (SCREENS[i][0].test(t) || SCREENS[i][0].test(t.replace(/^my /, ''))) return SCREENS[i][1];
    if (/review/.test(t)) return 'review';
    return null;
  }
  function items(list, max) {
    var shown = list.slice(0, max || 3).map(function (c) { return J.itemPhrase(c); });
    var more = list.length - shown.length;
    return J.joinList(shown) + (more > 0 ? ', and ' + more + ' more' : '');
  }
  function briefing() {
    var name = J.state.profile.name || 'Roshan';
    var o = J.overdue(), d = J.dueToday(), w = J.dueWeek(), p = J.pendingDrafts(), ns = J.nextStep();
    var out = [J.greeting() + ', ' + name + '. It\'s ' + J.spokenDate(J.today()) + ', ' + J.timeNow() + ' in Dubai.'];
    out.push(o.length ? 'You have ' + J.plural(o.length, 'overdue item') + ': ' + items(o) + '.' : 'Nothing is overdue.');
    out.push(d.length ? J.plural(d.length, 'item') + ' ' + (d.length === 1 ? 'is' : 'are') + ' due today: ' + items(d) + '.' : 'Nothing is due today.');
    if (w.length) out.push(w.length + ' more ' + (w.length === 1 ? 'is' : 'are') + ' due by Friday.');
    if (p.length) out.push(J.plural(p.length, 'draft') + ' ' + (p.length === 1 ? 'is' : 'are') + ' waiting for your approval.');
    out.push('Your next step: ' + ns.text);
    return out.join(' ');
  }
  function weekSummary() {
    var r = J.weekReview();
    return 'This week you logged ' + J.plural(r.wins.length, 'win') + ' and kept ' + J.plural(r.kept.length, 'promise') + '. ' +
      (r.slipped.length ? J.plural(r.slipped.length, 'item') + ' slipped: ' + items(r.slipped) + '. ' : 'Nothing slipped. ') +
      'One next step: ' + r.next.text;
  }

  function command(raw) {
    var original = String(raw).trim();
    var t = original.toLowerCase()
      .replace(/[’‘]/g, '\'')
      .replace(/^(?:hey |ok |okay )?jarvis[,:!.]?\s*/, '')
      .replace(/^(?:please|can you|could you|would you)\s+/, '')
      .replace(/[?!.]+$/, '')
      .replace(/\bwhat is\b/g, 'what\'s').replace(/\bwhats\b/g, 'what\'s')
      .trim();
    // keep the user's own capitalisation for things we store
    var orig = original.replace(/^(?:hey |ok |okay )?jarvis[,:!.]?\s*/i, '').replace(/^(?:please|can you|could you|would you)\s+/i, '').replace(/[?!.]+$/, '').trim();
    var m;

    if (!t) return 'Yes?';

    // stop
    if (/^(stop|stop talking|cancel|quiet|be quiet|shush|enough|never mind|nevermind|shut up|pause|that's all|that's enough)$/.test(t)) {
      stopSpeaking(); addMsg('jarvis', 'Stopped.'); setLine('Stopped.');
      return '';
    }

    // open a screen
    if ((m = t.match(/^(?:open|show|go to|goto|take me to|switch to|display|view|bring up|launch)\s+(.+)$/))) {
      var scr = screenFor(m[1]);
      if (scr === 'blueprint') { setTimeout(function () { location.href = 'blueprint/'; }, 1400); return 'Opening the blueprint.'; }
      if (scr) { J.go(scr); return 'Opening ' + J.views[scr] + '.'; }
    }

    // add a reminder / commitment
    if (/^(remind me|i'll |i will |i'm going to |i promised|i promise |add (a |another )?(task|commitment|promise|reminder)|new (task|commitment|promise)|i need to |i have to |i must )/.test(t)) {
      var p = J.parseCapture(orig);
      if (!p.what || p.what.split(' ').length < 1 || /^(to|about)$/i.test(p.what)) return 'What should I remind you about? For example: remind me to send the report to Omar by Friday.';
      J.addCommitment(p);
      return 'Got it. ' + J.itemPhrase(p) + ', ' + J.spokenDue(p.due) + '.';
    }

    // log a win
    if ((m = orig.match(/^(?:log|add|record|save|note)(?: a| another| new)? (?:win|achievement|accomplishment)\s*[:,-]?\s*(.*)$/i)) ||
        (m = orig.match(/^win\s*[:,-]\s*(.+)$/i))) {
      var wtext = m[1].replace(/^(that )?i /i, '').trim();
      if (!wtext) return 'What was the win? Say, for example: log a win, cut cloud costs by 12 percent.';
      var res = J.addWin(wtext);
      return 'Nice work. Logged: ' + res.win.text + (res.skill ? ', under ' + res.skill.name : '') + '.';
    }

    // mark done
    if ((m = t.match(/^(?:mark|tick|tick off|check off|set)\s+(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished)$/)) ||
        (m = t.match(/^(?:mark|tick off|check off|complete|finish|close|done with|i finished|i've finished|i have finished|i completed|i've done|i have done|i did)\s+(.+)$/)) ||
        (m = t.match(/^(.+?)\s+is\s+(?:done|complete|finished)$/))) {
      var q = m[1].replace(/\s+(as\s+)?(done|complete|completed|finished)$/, '');
      var c = J.findCommitment(q);
      if (!c) {
        var already = J.findCommitment(q, true);
        if (already && already.done) return '"' + already.what + '" is already marked as done.';
        return 'I couldn\'t find an open promise matching "' + q + '". Check the Commitments screen.';
      }
      J.setDone(c.id, true);
      var left = J.overdue().length + J.dueToday().length;
      return 'Done. I\'ve marked "' + c.what + '" as complete.' + (left ? ' ' + J.plural(left, 'item') + ' still ' + (left === 1 ? 'needs' : 'need') + ' attention today.' : ' You\'re clear for today.');
    }

    // add an opportunity
    if ((m = orig.match(/^(?:add|track|save|new|create)\s+(?:an?\s+|the\s+|new\s+)?(opportunity|job|role|position|project|course|certification)\s*[:,-]?\s*(.*)$/i))) {
      var kindWord = m[1].toLowerCase(), oname = m[2].trim();
      var kind = /project/.test(kindWord) ? 'project' : /course|certification/.test(kindWord) ? 'course' : 'job';
      if (!oname) return 'What\'s the opportunity called? Say, for example: add opportunity Head of Engineering at a fintech.';
      var org = '';
      var om = oname.match(/^(.+?)\s+(?:at|with)\s+(.+)$/i);
      if (om) { oname = om[1]; org = om[2]; }
      var o = J.addOpp({ name: oname, kind: kind, org: org });
      return 'Added ' + o.name + (org ? ' at ' + org : '') + ' to Opportunities as Interested. It\'s a ' + J.matchScore(o) + '% match with your profile.';
    }

    if (/^(what can you do|help|commands|what do you do|how do i use (this|you)|what should i say|options)$/.test(t) || /what can you do/.test(t)) return HELP;

    if (/\b(what time|the time|time is it|current time)\b/.test(t)) return 'It\'s ' + J.timeNow() + ' in Dubai.';
    if (/\b(what's the date|today's date|what day is it|what's today|the date|which day)\b/.test(t)) return 'Today is ' + J.longDate(J.today()) + '.';

    if (/\b(brief me|briefing|good morning|good afternoon|good evening|morning jarvis|my day|catch me up|status report|daily summary|summary|update me|what's up)\b/.test(t)) return briefing();

    if (/\b(overdue|late|slipped|behind|missed)\b/.test(t)) {
      var o2 = J.overdue();
      return o2.length ? 'You have ' + J.plural(o2.length, 'overdue item') + ': ' + items(o2, 5) + '.' : 'Nothing is overdue. Nicely done.';
    }
    if (/\b(due today|today's (tasks|list|commitments|promises)|for today|on today|have today|do today|today)\b/.test(t)) {
      var d2 = J.dueToday();
      return d2.length ? J.plural(d2.length, 'item') + ' ' + (d2.length === 1 ? 'is' : 'are') + ' due today: ' + items(d2, 5) + '.' : 'Nothing is due today.' + (J.overdue().length ? ' But ' + J.plural(J.overdue().length, 'item') + ' ' + (J.overdue().length === 1 ? 'is' : 'are') + ' overdue.' : '');
    }
    if (/\b(this week|coming up|upcoming|rest of the week|due soon|end of the week|before friday|by friday)\b/.test(t)) {
      var w2 = J.dueWeek(), d3 = J.dueToday();
      if (!w2.length) return 'Nothing else is due before the weekend.' + (d3.length ? ' ' + J.plural(d3.length, 'item') + ' ' + (d3.length === 1 ? 'is' : 'are') + ' due today.' : '');
      return 'Coming up by Friday: ' + w2.slice(0, 5).map(function (c) { return J.itemPhrase(c) + ', ' + J.dueLabel(c.due).replace(/^Due /, '').toLowerCase(); }).join('; ') + '.';
    }
    if (/\b(next step|what should i (do|work on|focus on)|what's next|priority|priorities|focus)\b/.test(t)) return 'Your next step: ' + J.nextStep().text;

    if (/\b(how was my week|weekly review|my week|week in review|review my week)\b/.test(t)) return weekSummary();

    if (/\b(opportunit|jobs?|roles?|best match|courses?)\b/.test(t)) {
      var act = J.state.opps.filter(function (x) { return x.stage !== 'done'; }).sort(function (a, b) { return J.matchScore(b) - J.matchScore(a); });
      if (!act.length) return 'You have no active opportunities. Say "add opportunity" and a name to start.';
      return 'You have ' + J.plural(act.length, 'active opportunity', 'active opportunities') + '. The best match is ' + act[0].name + ' at ' + J.matchScore(act[0]) + '%, stage ' + J.stageName(act[0].stage) + '.';
    }
    if (/\b(drafts?|approvals?|messages to approve)\b/.test(t)) {
      var pd = J.pendingDrafts();
      return pd.length ? J.plural(pd.length, 'draft') + ' waiting: ' + J.joinList(pd.slice(0, 3).map(function (x) { return 'to ' + x.to + ' about ' + (x.subject || 'no subject'); })) + '. Say "open approvals" to review them.' : 'No drafts are waiting for approval.';
    }

    // open, without a verb ("approvals", "growth")
    var bare = screenFor(t);
    if (bare && bare !== 'blueprint') { J.go(bare); return 'Opening ' + J.views[bare] + '.'; }

    if (/^(hi|hello|hey|hiya|yo|good day)( there)?$/.test(t)) return 'Hello ' + (J.state.profile.name || 'Roshan') + '. How can I help? Say "brief me" for your day.';
    if (/\b(thank you|thanks|cheers|great job|well done)\b/.test(t)) return 'You\'re welcome.';
    if (/\b(who are you|your name|what are you)\b/.test(t)) return 'I\'m Jarvis, your personal assistant. I keep track of your promises, your growth and your opportunities. Everything stays in this browser.';

    return 'Sorry, I didn\'t catch that. ' + HELP;
  }

  /* ================= hook into screens ================= */
  document.addEventListener('jarvis:rendered', function () {
    bindOrb();
    fillVoiceSelect();
    $$('[data-hey]').forEach(function (el) { el.checked = hey.on || !!J.state.settings.hey; });
    $$('[data-speak]').forEach(function (el) { el.checked = !!J.state.settings.speak; });
    setState(vstate);
  });
  bindOrb();
  fillVoiceSelect();
  setState('idle');
  addMsg('jarvis', 'Hello ' + (J.state.profile.name || 'Roshan') + '. Ask me anything from the list, or say "what can you do".');

  window.JarvisVoice = {
    listen: listen, orbTap: orbTap, run: handle, speak: speak, stop: stopSpeaking,
    open: openChat, close: closeChat, command: command,
    settingsChanged: function () { pickVoice(); fillVoiceSelect(); },
    get state() { return vstate; }, supported: { listen: !!SR, speak: !!synth }
  };
})();

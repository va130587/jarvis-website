/* NOVA microphone self-test (Voice page): ten seconds, a level meter, then a plain verdict.
   NOTHING is recorded or sent: it only measures how loud the sound is, never plays it back, and lets go of the microphone when it ends. */
(function () {
  'use strict';
  var N = window.NOVA, J = window.J;
  if (!N || !J || !window.NovaSpeech) return;
  var esc = J.esc, $ = J.$;
  var M = N.mic = { duration: 10000, running: false, level: 0, peak: 0, result: null, error: null };
  var stream = null, actx = null, tick = null, startedAt = 0;

  function release() {
    clearInterval(tick); tick = null;
    if (stream) { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* already stopped */ } }); stream = null; }
    if (actx) { try { actx.close(); } catch (e) { /* already closed */ } actx = null; }
  }
  function why(e) {
    var n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return NovaSpeech.explain('not-allowed');
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return NovaSpeech.explain('audio-capture');
    if (n === 'NotReadableError') return { title: 'The microphone is busy.', steps: ['Close other apps or browser tabs that are using it, then test again.'] };
    return { title: 'The microphone could not be tested.', steps: ['Try again, or check your browser and system sound settings.'] };
  }
  function body() {
    if (M.running) return '<div class="mic-meter" id="micMeter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + M.level + '" aria-label="Microphone level"><i id="micBar"></i></div><p class="mono mic-read" id="micRead">Speak now. Level ' + M.level + '%</p>';
    if (M.error) return '<div class="load-error" role="alert"><b>' + esc(M.error.title) + '</b>' + (M.error.steps && M.error.steps.length ? '<ul class="small-text">' + M.error.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
    if (M.result) return '<div class="mic-result ' + (M.result.ok ? 'ok' : 'bad') + '" role="status"><b>' + esc(M.result.title) + '</b> ' + esc(M.result.text) + '</div>';
    return '';
  }
  M.panel = function () {
    var can = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    return '<article class="panel" id="micPanel"><h2 class="label">Microphone test</h2><p class="small-text muted">Speak for ' + Math.round(M.duration / 1000) + ' seconds and watch the level move. NOVA does not record or send anything: it only measures how loud the sound is, then lets go of the microphone.</p>' +
      (can ? '<div class="btn-row"><button type="button" class="btn" data-act="micTest" id="micBtn">' + (M.running ? 'Stop the test' : M.result || M.error ? 'Test my microphone again' : 'Test my microphone') + '</button></div>' : '<p class="small-text">This browser cannot test the microphone. Type or paste your request instead.</p>') +
      '<div id="micBody">' + body() + '</div></article>';
  };
  function paint() {
    var b = $('#micBody'); if (b) b.innerHTML = body();
    var btn = $('#micBtn'); if (btn) btn.textContent = M.running ? 'Stop the test' : M.result || M.error ? 'Test my microphone again' : 'Test my microphone';
  }
  function draw() {
    var m = $('#micMeter'), bar = $('#micBar'), r = $('#micRead'), left = Math.max(0, Math.ceil((M.duration - (Date.now() - startedAt)) / 1000));
    if (m) m.setAttribute('aria-valuenow', String(M.level)); if (bar) bar.style.width = M.level + '%';
    if (r) r.textContent = 'Speak now. Level ' + M.level + '% · ' + left + ' s left';
  }
  function finish(cancelled) {
    release(); M.running = false;
    M.result = cancelled ? null : NovaSpeech.micVerdict(M.peak);
    paint();
  }
  function start() {
    if (M.running) return finish(true);
    M.error = null; M.result = null; M.peak = 0; M.level = 0;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { M.error = { title: 'This browser cannot test the microphone.', steps: ['Type or paste your request instead.'] }; return paint(); }
    M.running = true; paint();
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      if (!M.running) { s.getTracks().forEach(function (t) { t.stop(); }); return; }            // stopped while the permission box was open
      stream = s;
      var AC = window.AudioContext || window.webkitAudioContext; actx = new AC(); if (actx.resume) actx.resume();
      var an = actx.createAnalyser(); an.fftSize = 1024; actx.createMediaStreamSource(s).connect(an);       // measured only; never connected to the speakers
      var f = new Float32Array(an.fftSize), u = new Uint8Array(an.fftSize); startedAt = Date.now();
      tick = setInterval(function () {
        var sum = 0, i;
        if (an.getFloatTimeDomainData) { an.getFloatTimeDomainData(f); for (i = 0; i < f.length; i++) sum += f[i] * f[i]; sum = Math.sqrt(sum / f.length); }
        else { an.getByteTimeDomainData(u); for (i = 0; i < u.length; i++) { var v = (u[i] - 128) / 128; sum += v * v; } sum = Math.sqrt(sum / u.length); }
        M.level = NovaSpeech.level(sum); if (M.level > M.peak) M.peak = M.level; draw();
        if (Date.now() - startedAt >= M.duration) finish(false);
      }, 100);
    }).catch(function (e) { release(); M.running = false; M.error = why(e); paint(); });
  }
  J.actions.micTest = start;
  // leaving the Voice page ends the test and lets go of the microphone
  document.addEventListener('jarvis:rendered', function (e) { if (M.running && e.detail && e.detail.view !== 'voice') finish(true); });
  window.addEventListener('pagehide', function () { if (M.running) finish(true); });
})();

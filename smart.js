/* NOVA — optional "Smart mode": a small AI model that runs ON YOUR DEVICE.
   Off by default. It only SUGGESTS: explanations, a polished cover-letter draft, or
   "did you mean…" for a voice command. It never changes data without your yes.
   Engines (free, no account, no server of mine):
     1. Chrome's built-in AI (window.LanguageModel / window.ai.languageModel)
     2. WebLLM (needs WebGPU), loaded from a CDN only after you agree to the download. */
(function () {
  'use strict';
  var J = window.J;
  var esc = J.esc;
  var WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm';
  var WEBLLM_MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
  var S = { state: 'off', pct: 0, engine: null, name: '', msg: '' };
  var session = null;

  function builtin() {
    if (window.LanguageModel && typeof window.LanguageModel.create === 'function') return window.LanguageModel;
    if (window.ai && window.ai.languageModel && typeof window.ai.languageModel.create === 'function') return window.ai.languageModel;
    return null;
  }
  function availability(api) {
    try {
      if (typeof api.availability === 'function') return Promise.resolve(api.availability());
      if (typeof api.capabilities === 'function') return Promise.resolve(api.capabilities()).then(function (c) { return c && c.available === 'readily' ? 'available' : c && c.available === 'after-download' ? 'downloadable' : 'unavailable'; });
    } catch (e) { /* fall through */ }
    return Promise.resolve('unavailable');
  }
  function say(msg) { S.msg = msg; paint(); }
  function paint() {
    var el = document.getElementById('smartStatus');
    if (el) {
      el.textContent = S.msg;
      var bar = document.getElementById('smartBar');
      if (bar) { bar.hidden = S.state !== 'loading'; bar.value = S.pct; }
    }
  }

  /* ---- engines ---- */
  function startBuiltin(api) {
    return availability(api).then(function (av) {
      if (av === 'unavailable' || av === 'no') return null;
      S.state = 'loading'; say(av === 'available' ? 'Starting the built-in AI…' : 'Downloading the built-in AI model… 0%');
      return api.create({ monitor: function (m) { m.addEventListener('downloadprogress', function (e) { S.pct = Math.round((e.loaded <= 1 ? e.loaded * 100 : e.loaded)); say('Downloading the built-in AI model… ' + S.pct + '%'); }); } })
        .then(function (sess) {
          session = sess; S.name = 'Chrome built-in AI';
          return function (prompt) { return Promise.resolve(session.prompt(prompt)); };
        });
    });
  }
  function startWebLLM() {
    if (!navigator.gpu && !window.__webllmTest) return Promise.resolve(null);
    S.state = 'loading'; say('Downloading the on-device model… 0%');
    return import(/* @vite-ignore */ WEBLLM_URL).then(function (mod) {
      return mod.CreateMLCEngine(WEBLLM_MODEL, { initProgressCallback: function (p) { S.pct = Math.round((p.progress || 0) * 100); say('Downloading the on-device model… ' + S.pct + '%'); } });
    }).then(function (eng) {
      S.name = 'WebLLM (' + WEBLLM_MODEL + ')';
      return function (prompt) {
        return eng.chat.completions.create({ messages: [{ role: 'system', content: 'You are a careful careers assistant. Be brief and never invent facts.' }, { role: 'user', content: prompt }], temperature: 0.3, max_tokens: 400 })
          .then(function (r) { return r.choices[0].message.content; });
      };
    });
  }
  function enable() {
    var api = builtin();
    var p = api ? startBuiltin(api).then(function (f) { return f || startWebLLM(); }) : startWebLLM();
    return p.then(function (fn) {
      if (!fn) { S.state = 'off'; J.data.settings.smart = false; J.persist(); say('Smart mode is not available on this browser or device. NOVA keeps working with its normal rule-based matching.'); return false; }
      S.engine = fn; S.state = 'ready'; S.pct = 100; say('Smart mode is on (' + S.name + '). It runs on your device and only suggests.'); J.render(false); return true;
    }).catch(function (err) {
      S.state = 'off'; S.engine = null; J.data.settings.smart = false; J.persist();
      say('Smart mode could not start (' + String(err && err.message || err).slice(0, 80) + '). NOVA keeps working with its normal matching.'); J.render(false); return false;
    });
  }
  function disable() { S.state = 'off'; S.engine = null; session = null; say('Smart mode is off.'); }
  function ready() { return S.state === 'ready' && !!S.engine; }
  function ask(prompt) { return ready() ? S.engine(prompt).then(function (t) { return String(t || '').trim(); }) : Promise.reject(new Error('Smart mode is off')); }

  /* ---- what it does (all suggestions) ---- */
  var COMMANDS = ['what jobs can hire me', 'show my best matches', 'why did you match this job', 'what am I missing for this job', 'show new jobs since yesterday', 'read the top three', 'which job should I apply to first', 'what should I learn to get more jobs', 'turn job alerts on', 'turn job alerts off', 'run the job search now', 'when did you last check', 'prepare an application for this job', 'brief me', 'what is due today', 'whats on my calendar today', 'find internships in Dubai'];
  function interpret(text) {
    return ask('A user said to a voice assistant: "' + text.replace(/"/g, '') + '". Reply with ONLY the number of the closest command, or 0 if none fits.\n' + COMMANDS.map(function (c, i) { return (i + 1) + '. ' + c; }).join('\n')).then(function (out) {
      var n = parseInt((out.match(/\d+/) || ['0'])[0], 10), cmd = COMMANDS[n - 1];
      if (!cmd) return null;
      return { text: 'I am not sure I understood. Smart mode thinks you meant "' + cmd + '". Run it? Say yes or no.', confirm: function () { setTimeout(function () { J.voice.run(cmd); }, 0); return 'Okay.'; } };
    }).catch(function () { return null; });
  }
  function facts(j) {
    var e = j.eval;
    return 'Job: ' + j.title + ' at ' + j.company + ' (' + j.city + '). Score ' + j.score + '/100, verdict: ' + e.verdictText + '. Reasons: ' + e.reasons.map(function (r) { return r.text; }).join(' ') + ' Gaps: ' + e.gaps.concat(e.blockers).map(function (r) { return r.text; }).join(' ');
  }
  function showSuggestion(title, text, copyId) {
    var html = '<div class="tip-box"><b>Suggestion from on-device AI.</b> It can be wrong. Check it before you use it. Nothing was changed.</div><pre class="template" id="' + (copyId || 'smartOut') + '">' + esc(text) + '</pre><div class="btn-row"><button type="button" class="btn small" data-act="copyTpl" data-id="' + (copyId || 'smartOut') + '">Copy</button></div>';
    J.openForm({ title: title, submit: 'Close', hideCancel: true, noFocus: true, fields: [{ type: 'html', html: html }], onSave: function () {} });
  }
  function explainTop() {
    var top = J.matches.sections().best.concat(J.matches.sections().stretch)[0];
    if (!top) { J.toast('No matches to explain yet.'); return Promise.resolve(); }
    J.toast('Smart mode is thinking…');
    return ask('Explain in 3 short plain sentences to a fresher why this job is or is not a good fit. Use ONLY these facts, add nothing.\n' + facts(top)).then(function (t) { showSuggestion('Smart explanation: ' + top.title, t, 'smartOut'); }).catch(function () { J.toast('Smart mode could not answer. The rule-based explanation is still on the Why panel.'); });
  }
  function improveCover(id) {
    var a = J.byId(J.data.apps, id); if (!a || !a.prep) return Promise.resolve();
    J.toast('Smart mode is thinking…');
    return ask('Improve this cover letter draft. Keep every fact exactly as written, do not add skills, degrees or experience that are not in it, keep it under 180 words.\n\n' + a.prep.cover).then(function (t) { showSuggestion('Smart cover letter draft', t, 'smartOut'); }).catch(function () { J.toast('Smart mode could not answer.'); });
  }

  function settingsHTML() {
    var on = !!J.data.settings.smart, can = !!(builtin() || navigator.gpu);
    return '<article class="panel" id="smartCard"><h2 class="label">Smart mode (optional, on your device)</h2>' +
      '<label class="switch"><span class="txt"><b>Smart mode</b><small>A small AI that runs in this browser. Off by default. It only suggests: explanations, cover-letter polish, and "did you mean…" for voice. It never changes anything without your yes.</small></span><input type="checkbox" id="smartToggle" data-setting="smart"' + (on ? ' checked' : '') + '><span class="knob" aria-hidden="true"></span></label>' +
      '<progress id="smartBar" max="100" value="' + S.pct + '" hidden aria-label="Smart mode download progress"></progress>' +
      '<p class="small-text muted" id="smartStatus" role="status" style="margin:10px 0 0">' + esc(S.msg || (can ? 'Off. Turning it on downloads a model once (about 0.5 to 2 GB, depending on your browser) after you agree.' : 'Not available here: this browser has no built-in AI and no WebGPU. NOVA works fine without it.')) + '</p></article>';
  }
  function toggled(on) {
    if (!on) { disable(); return; }
    var can = !!(builtin() || navigator.gpu || window.__webllmTest);
    if (!can) { J.data.settings.smart = false; J.persist(); say('Smart mode is not available on this browser or device. NOVA keeps working with its normal rule-based matching.'); var t = document.getElementById('smartToggle'); if (t) t.checked = false; return; }
    J.confirm('Smart mode downloads a small AI model to this device once (roughly 0.5 to 2 GB; the browser keeps it afterwards). It runs locally, nothing you type is sent anywhere, and it only makes suggestions. Download it now?', 'Download', 'Turn on Smart mode?').then(function (ok) {
      if (!ok) { J.data.settings.smart = false; J.persist(); var t2 = document.getElementById('smartToggle'); if (t2) t2.checked = false; say('Smart mode stays off.'); return; }
      enable();
    });
  }

  J.smart = { ready: ready, enable: enable, disable: disable, ask: ask, interpret: interpret, explainTop: explainTop, improveCover: improveCover, toggled: toggled, state: function () { return S; } };
  J.smartSettingsHTML = settingsHTML;
  Object.assign(J.actions, { smartCover: function (id) { J.closeForm(); improveCover(id); } });
  // A model that was already approved earlier starts again quietly on the next visit (no new download prompt).
  // Only a choice saved before this page loaded counts: switching it on now must still go through the consent question first.
  document.addEventListener('DOMContentLoaded', function () { var before = !!J.data.settings.smart; setTimeout(function () { if (before && J.data.settings.smart && S.state === 'off') enable(); }, 600); });
})();

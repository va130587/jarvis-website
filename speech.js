/* NOVA speech helpers (no paid service: the browser's own speech recognition and speech synthesis).
   Pure functions (voice ranking, spoken-approval parsing, error explanations) plus a small provider wrapper around the browser's recogniser.
   Another engine can be added later by implementing the same `start()` contract. Voice is NEVER used to prove who you are. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.NovaSpeech = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LANGS = [['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['ar-AE', 'Arabic (UAE)']];
  var FEMALE = /female|kate|serena|martha|stephanie|libby|sonia|hazel|susan|fiona|moira|tessa|karen|samantha|victoria|zira|amy|emma|mia|maisie|catherine|bella|abbi|hollie|jenny|aria|natasha|ava|michelle|ana/i;
  var natural = function (v) { return /natural|neural|\bhd\b|andrew/i.test(v.name || ''); };

  // Higher is better. Edge's online "Natural" voices (for example "Microsoft Andrew Online (Natural)") come first; an "Andrew ... HD" voice would beat them if the browser ever offers one.
  function score(v, lang) {
    var n = v.name || '', s = 0;
    if (/andrew/i.test(n)) s += 100;
    if (/\bhd\b/i.test(n)) s += 30;
    if (/multilingual/i.test(n)) s += 5;
    if (/natural|neural/i.test(n)) s += 60;
    if (/online/i.test(n)) s += 5;
    var want = String(lang || 'en-GB').toLowerCase(), have = String(v.lang || '').toLowerCase().replace('_', '-');
    if (have === want) s += 20; else if (have.slice(0, 2) === want.slice(0, 2)) s += 10; else return -1;     // never pick a voice for another language
    if (FEMALE.test(n) && !/andrew/i.test(n)) s -= 10;
    return s;
  }
  // Best natural voice for the language, or null (then the caller falls back to its own default).
  function pick(voices, lang) {
    var best = null, bs = 0;
    (voices || []).forEach(function (v) { if (!natural(v)) return; var s = score(v, lang); if (s > bs) { bs = s; best = v; } });
    return best;
  }
  function report(voices) {
    var list = voices || [], nat = list.filter(natural);
    return { total: list.length, natural: nat.map(function (v) { return v.name; }), hasAndrew: list.some(function (v) { return /andrew/i.test(v.name || ''); }), hasHD: list.some(function (v) { return /andrew/i.test(v.name || '') && /\bhd\b/i.test(v.name || ''); }) };
  }

  // "approve" / "reject" by voice. A bare "yes" never approves: the word has to be clear, and only low-risk, undoable actions can be approved by voice at all (the server enforces that too).
  function parseApproval(text) {
    var t = String(text || '').toLowerCase().replace(/[’']/g, "'").replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (/^(?:(?:yes|ok|okay|sure)\s+)?(?:please\s+)?(?:i\s+)?(?:go ahead and\s+)?approve(?:d)?(?:\s+(?:it|that|this))?(?:\s+please)?$/.test(t)) return 'approve';
    if (/^(?:(?:no|nope)\s+)?(?:please\s+)?(?:reject|decline|deny)(?:\s+(?:it|that|this))?$|^(?:no|nope|don't do it|do not do it|cancel that|never mind)$/.test(t)) return 'reject';
    return null;
  }

  // Plain-English help for each way listening can fail. `steps` are things the person can actually do.
  function explain(code, ctx) {
    ctx = ctx || {};
    switch (code) {
      case 'not-allowed': case 'service-not-allowed':
        return { title: 'Microphone access is blocked.', steps: ['Click the lock (or tune) icon next to the web address and set Microphone to Allow, then reload the page.', 'In Chrome or Edge: Settings > Privacy and security > Site settings > Microphone.', 'You can type your request in the box below instead; everything still works.'], fatal: true };
      case 'audio-capture': return { title: 'No microphone was found.', steps: ['Connect or switch on a microphone, check it is the system input, then try again.', 'Or type your request below.'], fatal: true };
      case 'network': return { title: 'Speech recognition could not reach its service.', steps: ['In Chrome and Edge the browser sends your audio to its vendor to turn it into text, so it needs the internet.', 'Check your connection and try again, or type your request below.'], fatal: false };
      case 'offline': return { title: 'You appear to be offline.', steps: ['Speech recognition needs the internet in this browser. Typing works offline.'], fatal: false };
      case 'no-speech': return { title: 'I did not hear anything.', steps: ['Check the microphone is not muted, speak after pressing the button, and keep it close.', 'Or type your request below.'], fatal: false };
      case 'language-not-supported': return { title: 'This browser cannot recognise ' + (ctx.lang || 'that language') + '.', steps: ['Pick another language, or type your request below.'], fatal: false };
      case 'aborted': return { title: 'Listening was stopped.', steps: [], fatal: false };
      case 'unsupported': return { title: 'This browser cannot listen.', steps: [ctx.firefox ? 'Firefox cannot do speech recognition. Use Chrome, Edge or Safari, or type below.' : 'Use Chrome, Edge or Safari for voice, or type below.'], fatal: true };
      default: return { title: 'Listening stopped (' + code + ').', steps: ['Try again, or type your request below.'], fatal: false };
    }
  }

  // What this browser can do with voice, in one plain sentence that ends with the fix. Detected from the browser's own features, with its name only for the wording.
  // level: 'full' (listen and speak), 'partial' (Safari), 'typing' (cannot listen: type or paste; replies can still be read aloud if it can speak).
  function browser(win) {
    var nav = (win && win.navigator) || {}, ua = String(nav.userAgent || ''), listens = !!(win && (win.SpeechRecognition || win.webkitSpeechRecognition)), speaks = !!(win && win.speechSynthesis);
    var name = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    var read = speaks ? ' NOVA can still read its answers aloud.' : ' This browser cannot read answers aloud either, so replies are text only.';
    var level, text;
    if (!listens) {
      level = 'typing';
      text = (name ? name + ' cannot' : 'This browser cannot') + ' listen to your voice. Type or paste your request below.' + read + ' To talk to NOVA, use Chrome or Edge.';
    } else if (name === 'Safari') {
      level = 'partial';
      text = 'In Safari, listening works only partly (and only with Dictation turned on in your Mac or iPhone settings), while reading answers aloud works' + (speaks ? '' : ' if the browser allows it') + '. If the button does nothing, type or paste below, or use Chrome or Edge.';
    } else if (name === 'Chrome' || name === 'Edge' || name === 'Opera') {
      level = 'full';
      text = name + ' can both listen and speak. It sends your voice to ' + (name === 'Edge' ? 'Microsoft' : name === 'Opera' ? 'its maker' : 'Google') + ' to turn it into words, so listening needs the internet; typing always works.';
    } else {
      level = 'full';
      text = 'This browser says it can listen' + (speaks ? ' and speak' : '') + '. If the listening button does not work, type or paste below, or use Chrome or Edge.';
    }
    return { name: name || 'Unknown browser', level: level, listens: listens, speaks: speaks, text: text };
  }

  // Microphone self-test: how loud (0 to 100) a block of audio is, and what the loudest moment means. Nothing here records or sends audio.
  function level(rms) { if (!(rms > 0)) return 0; var db = 20 * Math.log10(rms); return Math.max(0, Math.min(100, Math.round((db + 60) / 60 * 100))); }
  function micVerdict(peak) {
    if (peak >= 20) return { ok: true, title: 'Your microphone works.', text: 'NOVA heard sound (the loudest moment reached ' + peak + '%). If speech recognition still struggles, check the language setting on this page.' };
    if (peak >= 6) return { ok: false, title: 'Your microphone is very quiet.', text: 'NOVA heard something faint (the loudest moment reached ' + peak + '%). Move closer, raise the microphone volume in your system settings, and test again.' };
    return { ok: false, title: 'NOVA heard almost nothing.', text: 'Check that the microphone is not muted, that it is the input your computer is using, and that you spoke during the test. Then test again.' };
  }

  // The browser's recogniser behind a small contract:  start({lang, onStart, onInterim(text), onFinal(text, confidence), onError(code), onEnd()}) -> { stop(), abort() }
  function createBrowserProvider(win) {
    var SR = win && (win.SpeechRecognition || win.webkitSpeechRecognition);
    return {
      name: 'browser', supported: !!SR,
      start: function (o) {
        var r = new SR(), finals = [], active = true, timer;
        r.lang = o.lang || 'en-GB'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
        r.onstart = function () { if (o.onStart) o.onStart(); };
        r.onresult = function (e) {
          var interim = '';
          for (var i = e.resultIndex; i < e.results.length; i++) {
            var alt = e.results[i][0];
            if (e.results[i].isFinal) { finals.push({ text: alt.transcript, confidence: typeof alt.confidence === 'number' ? alt.confidence : null }); if (o.onFinal) o.onFinal(finals.map(function (f) { return f.text; }).join(' ').replace(/\s+/g, ' ').trim(), avg(finals)); }
            else interim += alt.transcript;
          }
          if (o.onInterim) o.onInterim((finals.map(function (f) { return f.text; }).join(' ') + ' ' + interim).replace(/\s+/g, ' ').trim());
        };
        r.onerror = function (e) { if (active && o.onError) o.onError(e && e.error || 'error'); };
        r.onend = function () { active = false; clearTimeout(timer); if (o.onEnd) o.onEnd(finals.map(function (f) { return f.text; }).join(' ').replace(/\s+/g, ' ').trim(), avg(finals)); };
        timer = setTimeout(function () { try { r.stop(); } catch (e) { /* done */ } }, o.maxMs || 90000);     // never listen forever
        try { r.start(); } catch (e) { active = false; clearTimeout(timer); if (o.onError) o.onError('error'); if (o.onEnd) o.onEnd('', null); }
        return { stop: function () { try { r.stop(); } catch (e) { /* already stopped */ } }, abort: function () { active = false; try { r.abort(); } catch (e) { /* already stopped */ } } };
      }
    };
  }
  function avg(f) { var c = f.map(function (x) { return x.confidence; }).filter(function (x) { return x !== null; }); return c.length ? c.reduce(function (a, b) { return a + b; }, 0) / c.length : null; }

  return { LANGS: LANGS, score: score, pick: pick, report: report, isNatural: natural, parseApproval: parseApproval, explain: explain, createBrowserProvider: createBrowserProvider, browser: browser, level: level, micVerdict: micVerdict };
});

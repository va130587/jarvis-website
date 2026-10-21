// Voice help (pure functions): what each browser can do, in plain words with the fix; the microphone level and verdict.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../speech');

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const EDGE = CHROME + ' Edg/130.0.0.0';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0';
const win = (ua, o) => Object.assign({ navigator: { userAgent: ua }, speechSynthesis: {} }, o || {});

test('Chrome and Edge: listen and speak, and where the audio goes', () => {
  const c = S.browser(win(CHROME, { webkitSpeechRecognition: function () {} })), e = S.browser(win(EDGE, { SpeechRecognition: function () {} }));
  assert.equal(c.name, 'Chrome'); assert.equal(c.level, 'full'); assert.match(c.text, /can both listen and speak.*Google.*needs the internet/);
  assert.equal(e.name, 'Edge'); assert.equal(e.level, 'full'); assert.match(e.text, /Microsoft/);
});
test('Safari: partly, with the fix', () => {
  const s = S.browser(win(SAFARI, { webkitSpeechRecognition: function () {} }));
  assert.equal(s.name, 'Safari'); assert.equal(s.level, 'partial'); assert.match(s.text, /works only partly.*Dictation.*reading answers aloud works.*Chrome or Edge/);
});
test('Firefox: cannot listen, can still speak, type or paste', () => {
  const f = S.browser(win(FIREFOX));
  assert.equal(f.name, 'Firefox'); assert.equal(f.level, 'typing'); assert.equal(f.listens, false); assert.equal(f.speaks, true); assert.match(f.text, /Firefox cannot listen.*Type or paste.*still read its answers aloud.*Chrome or Edge/);
});
test('a browser with neither listening nor speaking, and one nobody has heard of', () => {
  const n = S.browser({ navigator: { userAgent: FIREFOX } }); assert.match(n.text, /cannot read answers aloud either, so replies are text only/);
  const u = S.browser(win('SomeNewBrowser/1.0', { SpeechRecognition: function () {} })); assert.equal(u.name, 'Unknown browser'); assert.equal(u.level, 'full'); assert.match(u.text, /says it can listen and speak.*does not work/);
  const w = S.browser(undefined); assert.equal(w.level, 'typing'); assert.doesNotMatch(JSON.stringify(w), /undefined|\[object/);
  for (const t of [CHROME, EDGE, SAFARI, FIREFOX, 'x']) for (const sr of [false, true]) assert.doesNotMatch(S.browser(win(t, sr ? { SpeechRecognition: function () {} } : {})).text, /undefined|\[object|null/);
});
test('microphone level is 0 to 100, quiet speech is not zero, and the verdicts say what to do', () => {
  assert.equal(S.level(0), 0); assert.equal(S.level(NaN), 0); assert.equal(S.level(0.0001), 0); assert.equal(S.level(1), 100); assert.equal(S.level(5), 100);
  assert.ok(S.level(0.01) > 25 && S.level(0.01) < 40); assert.ok(S.level(0.1) > S.level(0.01));
  assert.equal(S.micVerdict(80).ok, true); assert.match(S.micVerdict(80).text, /reached 80%/); assert.equal(S.micVerdict(20).ok, true);
  assert.equal(S.micVerdict(10).ok, false); assert.match(S.micVerdict(10).title, /very quiet/); assert.match(S.micVerdict(10).text, /raise the microphone volume/);
  assert.equal(S.micVerdict(0).ok, false); assert.match(S.micVerdict(0).title, /almost nothing/); assert.match(S.micVerdict(0).text, /not muted/);
});

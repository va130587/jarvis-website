const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../speech.js');

const V = (name, lang) => ({ name, lang: lang || 'en-GB', voiceURI: name });

test('voice ranking prefers Andrew Online (Natural), then other natural voices', () => {
  const voices = [V('Google UK English Male'), V('Microsoft Libby Online (Natural)'), V('Microsoft Andrew Online (Natural)', 'en-US'), V('Microsoft Ryan Online (Natural)')];
  assert.equal(S.pick(voices, 'en-GB').name, 'Microsoft Andrew Online (Natural)');
  assert.equal(S.pick(voices.filter(v => !/Andrew/.test(v.name)), 'en-GB').name, 'Microsoft Ryan Online (Natural)', 'male natural beats female natural');
});
test('an Andrew HD voice would beat plain Andrew', () => {
  const v = [V('Microsoft Andrew Online (Natural)', 'en-US'), V('Microsoft Andrew HD Online (Natural)', 'en-US')];
  assert.match(S.pick(v, 'en-US').name, /HD/);
});
test('no natural voice means no pick; other languages are never chosen', () => {
  assert.equal(S.pick([V('Google UK English Male')], 'en-GB'), null);
  assert.equal(S.pick([V('Microsoft Hamed Online (Natural)', 'ar-SA')], 'en-GB'), null);
  assert.equal(S.pick([V('Microsoft Hamed Online (Natural)', 'ar-SA'), V('Microsoft Andrew Online (Natural)', 'en-US')], 'ar-AE').name, 'Microsoft Hamed Online (Natural)');
});
test('report is honest about what is installed', () => {
  const r = S.report([V('Google UK English Male'), V('Microsoft Andrew Online (Natural)', 'en-US')]);
  assert.equal(r.total, 2); assert.equal(r.hasAndrew, true); assert.equal(r.hasHD, false);
  assert.deepEqual(S.report([]).natural, []);
});
test('parseApproval: only clear words approve; bare yes never does', () => {
  for (const t of ['approve', 'Approve.', 'approve it', 'please approve that', 'yes approve', 'okay approve it please']) assert.equal(S.parseApproval(t), 'approve', t);
  for (const t of ['yes', 'ok', 'sure', 'go ahead', 'do it', 'I approve of nothing', 'approve and delete everything', 'improve', 'a prove', '']) assert.equal(S.parseApproval(t), null, t);
  for (const t of ['reject', 'no', 'nope', 'Reject it', "don't do it", 'cancel that', 'never mind', 'no reject']) assert.equal(S.parseApproval(t), 'reject', t);
});
test('explain gives actionable steps for each failure', () => {
  for (const c of ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'offline', 'no-speech', 'language-not-supported', 'aborted', 'unsupported', 'weird']) {
    const e = S.explain(c, { lang: 'ar-AE' }); assert.ok(e.title); assert.ok(Array.isArray(e.steps));
  }
  assert.equal(S.explain('not-allowed').fatal, true);
  assert.match(S.explain('not-allowed').steps.join(' '), /Allow/);
  assert.match(S.explain('unsupported', { firefox: true }).steps[0], /Firefox/);
});
test('provider reports unsupported without a recogniser', () => {
  assert.equal(S.createBrowserProvider({}).supported, false);
});

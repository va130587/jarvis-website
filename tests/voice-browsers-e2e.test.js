// Voice on more browsers: what each browser can do (Chrome, Edge, Safari, Firefox, unknown), the type-or-paste fallback with the same
// approval rules, and the 10-second microphone test (level meter, nothing recorded, microphone released). Real microphones and real
// Safari/Firefox are UNVERIFIED here (see NOVA_VOICE_TEST_SCRIPT.md); these tests use browser profiles and a fake audio source.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const { checkLayout } = require('./layout-check');
const { boot, closeAll } = require('./server-helpers');

const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const PROFILE = {
  chrome: { ua: CHROME, sr: 'both' }, edge: { ua: CHROME + ' Edg/130.0.0.0', sr: 'both' },
  safari: { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', sr: 'webkit' },
  firefox: { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0', sr: 'none' }, other: { ua: 'SomeNewBrowser/1.0', sr: 'none' }
};
let browser, srv;
test.before(async () => { browser = await H.launch(); srv = await boot({ NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }); });
test.after(async () => { await browser.close(); await closeAll(); });
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets|fonts\.googleapis/.test(e));

const profileScript = p => `Object.defineProperty(navigator, 'userAgent', { get: () => ${JSON.stringify(PROFILE[p].ua)} });` +
  (PROFILE[p].sr === 'none' ? `Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true }); Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });` : '') +
  (PROFILE[p].sr === 'webkit' ? `Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });` : '');
// Fake microphones: a tone, silence, a faint tone, or a refusal. Every track and every recorder is counted.
const mic = kind => `window.__tracks = []; window.__recorders = 0; window.MediaRecorder = function () { window.__recorders++; };
  navigator.mediaDevices.getUserMedia = async () => {
    const kind = ${JSON.stringify(kind)};
    if (kind === 'denied') throw new DOMException('no', 'NotAllowedError'); if (kind === 'none') throw new DOMException('no', 'NotFoundError'); if (kind === 'busy') throw new DOMException('no', 'NotReadableError');
    const c = new AudioContext(), d = c.createMediaStreamDestination();
    if (kind !== 'silent') { const o = c.createOscillator(), g = c.createGain(); g.gain.value = kind === 'quiet' ? 0.004 : 0.3; o.connect(g); g.connect(d); o.start(); }
    d.stream.getTracks().forEach(t => window.__tracks.push(t)); return d.stream;
  };`;

async function open(profile, micKind, opts) {
  const init = profileScript(profile) + (micKind === 'unsupported' ? `Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });` : micKind ? mic(micKind) : '') + ((opts && opts.init) || '');
  const o = await H.openApp(browser, Object.assign({ base: srv.base, hash: '', recognition: PROFILE[profile].sr !== 'none', init }, opts && { width: opts.width, height: opts.height }));
  const seen = []; o.page.on('request', q => { if (q.method() !== 'GET' || !q.url().startsWith(srv.base)) seen.push(q.method() + ' ' + q.url()); }); o.seen = seen;
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.waitForSelector('#novaDevEmail'); await o.page.fill('#novaDevEmail', 'roshan@example.com'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  await o.page.evaluate(() => { location.hash = 'voice'; }); await o.page.waitForSelector('#ptt'); seen.length = 0; return o;
}

test('each browser gets one plain sentence about what works, with the fix', async () => {
  const want = { chrome: [/Chrome can both listen and speak.*Google/, false], edge: [/Edge can both listen and speak.*Microsoft/, false], safari: [/In Safari, listening works only partly.*Dictation.*Chrome or Edge/, false],
    firefox: [/Firefox cannot listen to your voice\. Type or paste your request below\..*read its answers aloud.*Chrome or Edge/, true], other: [/This browser cannot listen to your voice.*Type or paste/, true] };
  for (const [p, [rx, typing]] of Object.entries(want)) {
    const { page, ctx, errors } = await open(p);
    assert.match(await page.innerText('#vBrowser'), rx, p); assert.equal(await page.locator('#ptt').isDisabled(), typing, p + ': the talk button is ' + (typing ? 'off' : 'on'));
    if (typing) assert.equal(await page.evaluate(() => document.querySelector('#main .panel h2').textContent), 'Type or paste your request', p + ': the type box is the first panel');
    assert.equal((await page.innerText('label[for="vTranscript"]')).startsWith(typing ? 'Type or paste' : 'Your words'), true, p);
    assert.deepEqual(clean(errors), [], p); await ctx.close();
  }
});

test('Firefox: the type-or-paste box comes first, sends like speech, and the approval rules are the same: small changes by typing "approve", the rest need the button', async () => {
  const { page, ctx, errors } = await open('firefox');
  assert.equal(await page.evaluate(() => document.querySelector('#main .panel h2').textContent), 'Type or paste your request', 'it is the first panel');
  assert.match(await page.innerText('#main'), /Typing follows the same rules as speaking.*only works for small changes that can be undone/);
  const send = async text => { await page.fill('#vTranscript', text); const n = await page.locator('#vLog .msg').count(); await page.click('button[data-act="vSend"]'); await page.waitForFunction(k => document.querySelectorAll('#vLog .msg').length >= k + 2, n); };
  const tasks = () => page.evaluate(() => fetch('/api/tasks').then(r => r.json()).then(j => j.tasks.map(t => t.title)));
  await send('add a task to call HR'); assert.equal(await page.evaluate(() => !!NOVA.voicePending), true, 'a preview is waiting'); assert.deepEqual(await tasks(), [], 'nothing changed before approval');
  await send('approve'); await page.waitForFunction(() => !NOVA.voicePending); assert.deepEqual(await tasks(), ['call HR']);
  await send('delete the task call HR'); assert.equal(await page.evaluate(() => !!NOVA.voicePending), true);
  await send('approve'); assert.match(await page.locator('#vLog .msg.bot').last().innerText(), /I cannot approve that by voice.*button press/); assert.deepEqual(await tasks(), ['call HR'], 'a risky change is not approved by typing "approve"');
  await page.evaluate(() => J.render(false)); await page.click('#vPending button[data-act="novaApproveRun"]'); await page.waitForFunction(() => !NOVA.voicePending); assert.deepEqual(await tasks(), [], 'the button works');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('microphone test with a tone: the meter moves, it ends with a plain verdict, the microphone is released, nothing is recorded or sent', async () => {
  const { page, ctx, errors, seen } = await open('chrome', 'tone');
  assert.equal(await page.evaluate(() => NOVA.mic.duration), 10000, 'ten seconds by default'); assert.match(await page.innerText('#micPanel'), /Speak for 10 seconds.*does not record or send anything/);
  await page.evaluate(() => { NOVA.mic.duration = 1500; });
  await page.click('#micBtn'); await page.waitForSelector('#micMeter'); assert.equal(await page.innerText('#micBtn'), 'Stop the test');
  await page.waitForFunction(() => +document.getElementById('micMeter').getAttribute('aria-valuenow') > 10); assert.match(await page.innerText('#micRead'), /Speak now\. Level \d+% · \d+ s left/);
  assert.equal(await page.getAttribute('#micMeter', 'aria-label'), 'Microphone level'); assert.equal(await page.getAttribute('#micMeter', 'role'), 'meter');
  await page.waitForSelector('#micBody .mic-result.ok'); assert.match(await page.innerText('#micBody'), /Your microphone works\..*loudest moment reached \d+%/); assert.equal(await page.innerText('#micBtn'), 'Test my microphone again');
  assert.deepEqual(await page.evaluate(() => __tracks.map(t => t.readyState)), ['ended'], 'the microphone is let go'); assert.equal(await page.evaluate(() => __recorders), 0, 'nothing is recorded'); assert.deepEqual(seen, [], 'nothing was sent anywhere');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('the full ten seconds really are ten seconds', async () => {
  const { page, ctx } = await open('chrome', 'tone'); const t0 = Date.now();
  await page.click('#micBtn'); await page.waitForSelector('#micBody .mic-result', { timeout: 20000 }); const took = Date.now() - t0;
  assert.ok(took >= 9500 && took < 13000, 'took ' + took + ' ms'); await ctx.close();
});

test('silent, faint, refused, missing, busy and unsupported microphones each say what to do', async () => {
  const cases = [['silent', /NOVA heard almost nothing\.[\s\S]*not muted/, false], ['quiet', /Your microphone is very quiet\.[\s\S]*raise the microphone volume/, false],
    ['denied', /Microphone access is blocked\./, true], ['none', /No microphone was found\./, true], ['busy', /The microphone is busy\.[\s\S]*Close other apps/, true], ['unsupported', /This browser cannot test the microphone\./, true]];
  for (const [kind, rx] of cases) {
    const { page, ctx, errors } = await open('chrome', kind);
    await page.evaluate(() => { NOVA.mic.duration = 1200; J.render(false); });
    if (kind === 'unsupported') { assert.match(await page.innerText('#micPanel'), rx, kind); assert.equal(await page.locator('#micBtn').count(), 0); }
    else { await page.click('#micBtn'); await page.waitForSelector('#micBody .mic-result, #micBody .load-error'); assert.match(await page.innerText('#micBody'), rx, kind); }
    assert.doesNotMatch(await page.innerText('#micPanel'), /undefined|\[object|Error|DOMException/, kind);
    if (kind === 'silent' || kind === 'quiet') assert.deepEqual(await page.evaluate(() => __tracks.map(t => t.readyState)), ['ended']);
    assert.deepEqual(clean(errors), [], kind); await ctx.close();
  }
});

test('Stop ends the test without a verdict, and leaving the page lets go of the microphone', async () => {
  const a = await open('chrome', 'tone'); await a.page.click('#micBtn'); await a.page.waitForSelector('#micMeter'); await a.page.waitForTimeout(400);
  await a.page.click('#micBtn'); await a.page.waitForFunction(() => !document.querySelector('#micMeter')); assert.equal(await a.page.locator('#micBody .mic-result').count(), 0);
  assert.deepEqual(await a.page.evaluate(() => __tracks.map(t => t.readyState)), ['ended']); await a.ctx.close();
  const b = await open('chrome', 'tone'); await b.page.click('#micBtn'); await b.page.waitForSelector('#micMeter'); await b.page.waitForTimeout(300);
  await b.page.evaluate(() => { location.hash = 'dashboard'; }); await b.page.waitForFunction(() => J.current() === 'dashboard'); await b.page.waitForTimeout(300);
  assert.deepEqual(await b.page.evaluate(() => __tracks.map(t => t.readyState)), ['ended'], 'the microphone is released when you leave'); assert.equal(await b.page.evaluate(() => NOVA.mic.running), false); await b.ctx.close();
});

test('the test works by keyboard', async () => {
  const { page, ctx } = await open('chrome', 'tone'); await page.evaluate(() => { NOVA.mic.duration = 1200; });
  await page.focus('#micBtn'); await page.keyboard.press('Enter'); await page.waitForSelector('#micBody .mic-result'); await ctx.close();
});

for (const theme of ['dark', 'light']) for (const width of [390, 768, 1024, 1440]) for (const p of ['chrome', 'firefox']) {
  test('layout and accessibility at ' + width + ' px, ' + (theme === 'light' ? 'Daylight' : 'Deep Space') + ', ' + p + ' profile: the Voice page with the microphone test', async () => {
    const { page, ctx, errors } = await open(p, 'tone', { width, height: 900, init: theme === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : '' });
    await page.evaluate(() => { NOVA.mic.duration = 1200; }); await page.click('#micBtn'); await page.waitForSelector('#micMeter'); await page.waitForTimeout(300);
    const axeRun = async () => { await page.evaluate(src => { if (!window.axe) (0, eval)(src); }, AXE); const ax = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })); return ax.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')); };
    assert.deepEqual(await axeRun(), [], 'during the test'); await page.waitForSelector('#micBody .mic-result'); await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(checkLayout), []); assert.deepEqual(await axeRun(), [], 'with the verdict'); assert.deepEqual(clean(errors), []); await ctx.close();
  });
}

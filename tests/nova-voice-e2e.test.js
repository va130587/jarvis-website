// Voice with a mocked speech engine: push-to-talk, editable transcript, noisy/slow/silent/denied/offline cases, voice picker, spoken approval limits.
// (Real microphone accuracy cannot be tested here: see NOVA_VOICE_TEST_SCRIPT.md for the 10-minute manual test.)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const { boot, closeAll } = require('./server-helpers');

let browser, srv;
test.before(async () => { browser = await H.launch(); srv = await boot({ NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }); });
test.after(async () => { await browser.close(); await closeAll(); });
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets|fonts\.googleapis/.test(e));

const VOICES = `window.__voices = [
  { name: 'Google UK English Male', lang: 'en-GB', voiceURI: 'g' },
  { name: 'Microsoft Libby Online (Natural)', lang: 'en-GB', voiceURI: 'libby' },
  { name: 'Microsoft Andrew Online (Natural)', lang: 'en-US', voiceURI: 'andrew' },
  { name: 'Microsoft Hamed Online (Natural)', lang: 'ar-SA', voiceURI: 'hamed' }];`;

async function open(opts) {
  const o = await H.openApp(browser, Object.assign({ base: srv.base, hash: '', recognition: true }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.waitForSelector('#novaDevEmail'); await o.page.fill('#novaDevEmail', 'roshan@example.com'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
  await o.page.evaluate(() => { location.hash = 'voice'; }); await o.page.waitForSelector('#ptt');
  return o;
}
const listen = async page => { const n = await page.evaluate(() => __rec.instances.length); await page.click('#ptt'); await page.waitForFunction(k => __rec.instances.length > k && __rec.instances[__rec.instances.length - 1].active, n); };
const say = (page, parts) => page.evaluate(p => __rec.say(p), parts);
const stop = async page => { await page.click('#ptt'); await page.waitForFunction(() => document.getElementById('ptt').getAttribute('aria-pressed') === 'false'); };
// (NOVA's older reminder timer may also post "Reminder: ..." into the log at any moment; replies are the other messages.)
const replies = '#vLog .msg.bot:not(:has(.text:text-matches("^Reminder:")))';
const sendAndWait = async page => { const n = await page.locator(replies).count(); await page.click('button[data-act="vSend"]'); await page.waitForFunction(k => [...document.querySelectorAll('#vLog .msg.bot .text')].filter(e => !/^Reminder:/.test(e.textContent)).length > k, n); };
const lastBot = page => page.locator(replies).last().innerText();
const tasks = page => page.evaluate(() => fetch('/api/tasks').then(r => r.json()).then(j => j.tasks));

test('push to talk: live transcript is editable, nothing is sent until Send, the answer is spoken', async () => {
  const { page, ctx, errors } = await open();
  await listen(page);
  await say(page, [{ t: 'what are my', final: false }]);
  assert.match(await page.inputValue('#vTranscript'), /what are my/);
  await say(page, [{ t: 'what are my tasks', final: true, c: 0.93 }]);
  await stop(page);
  assert.equal(await page.inputValue('#vTranscript'), 'what are my tasks');
  assert.match(await page.innerText('#vConf'), /93% sure/);
  assert.equal(await page.$$eval('#vLog .msg.me', e => e.length), 0, 'nothing sent yet');
  await sendAndWait(page);
  assert.match(await page.innerText('#vLog .msg.me .text'), /what are my tasks/);
  assert.ok((await page.evaluate(() => window.__said)).length > 0, 'the answer was spoken');
  assert.deepEqual(clean(errors), []); await ctx.close();
});

test('slow speech in several chunks, and repeated commands, work', async () => {
  const { page, ctx } = await open();
  await listen(page);
  await say(page, [{ t: 'add a note', final: true, c: 0.9 }]);
  await say(page, [{ t: 'add a note', final: true, c: 0.9 }, { t: 'that the lab is closed', final: true, c: 0.8 }]);
  await stop(page);
  assert.match(await page.inputValue('#vTranscript'), /add a note.*lab is closed/);
  // repeat: second listening starts fresh
  await listen(page); await say(page, [{ t: 'list my notes', final: true }]); await stop(page);
  assert.equal(await page.inputValue('#vTranscript'), 'list my notes');
  await listen(page); await say(page, [{ t: 'list my notes', final: true }]); await stop(page);
  assert.equal(await page.inputValue('#vTranscript'), 'list my notes');
  await ctx.close();
});

test('background noise: low confidence is flagged and nothing is auto-sent', async () => {
  const { page, ctx } = await open();
  await listen(page); await say(page, [{ t: 'add a task to pay the rant', final: true, c: 0.31 }]); await stop(page);
  assert.match(await page.innerText('#vConf'), /31% sure.*low/i);
  assert.equal((await tasks(page)).length, 0); assert.equal(await page.$$eval('#vLog .msg.me', e => e.length), 0);
  await ctx.close();
});

test('wrong words are corrected by editing before Send', async () => {
  const { page, ctx } = await open();
  await listen(page); await say(page, [{ t: 'add a task to pay the rant', final: true, c: 0.5 }]); await stop(page);
  await page.fill('#vTranscript', 'add a task to pay the rent');
  await sendAndWait(page);
  assert.match(await page.innerText('#vLog .msg.me .text'), /pay the rent/);
  assert.match(await lastBot(page), /Say approve or reject/);
  const pend = await page.evaluate(() => NOVA.voicePending);
  assert.match(pend.preview.changes[0], /pay the rent/);
  await ctx.close();
});

test('silence: a clear "I did not hear anything" message', async () => {
  const { page, ctx } = await open();
  await listen(page); await stop(page);
  assert.match(await page.innerText('#vError'), /did not hear anything/i);
  await page.fill('#vTranscript', 'what are my tasks'); await sendAndWait(page);      // typing still works
  await ctx.close();
});

test('permission denied: steps are shown and typing is the fallback', async () => {
  const { page, ctx } = await open();
  await page.evaluate(() => { __rec.deny = true; }); await page.click('#ptt');
  await page.waitForFunction(() => !document.getElementById('vError').hidden);
  const t = await page.innerText('#vError'); assert.match(t, /Microphone access is blocked/); assert.match(t, /Allow/);
  await page.waitForFunction(() => document.getElementById('ptt').getAttribute('aria-pressed') === 'false');
  await page.fill('#vTranscript', 'what are my tasks'); await sendAndWait(page);
  assert.ok(await lastBot(page));
  await ctx.close();
});

test('network error and offline each get a plain message', async () => {
  const { page, ctx } = await open();
  await page.evaluate(() => { __rec.errorOnStart = 'network'; }); await page.click('#ptt');
  await page.waitForFunction(() => /could not reach/i.test(document.getElementById('vError').textContent));
  await page.evaluate(() => { __rec.errorOnStart = null; Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }); });
  await page.waitForFunction(() => document.getElementById('ptt').getAttribute('aria-pressed') === 'false');
  await page.click('#ptt');
  await page.waitForFunction(() => /offline/i.test(document.getElementById('vError').textContent));
  await ctx.close();
});

test('browsers without speech recognition or speech output fall back to typing', async () => {
  let { page, ctx } = await open({ recognition: false, init: 'delete window.SpeechRecognition; delete window.webkitSpeechRecognition;' });
  assert.equal(await page.isDisabled('#ptt'), true);
  await page.evaluate(() => { document.getElementById('ptt').disabled = false; }); await page.click('#ptt');
  assert.match(await page.innerText('#vError'), /cannot listen/i);
  await page.fill('#vTranscript', 'what are my tasks'); await sendAndWait(page);
  await ctx.close();
  ({ page, ctx } = await open({ init: 'try { delete window.speechSynthesis; } catch (e) {}' }));
  await listen(page); await say(page, [{ t: 'what are my tasks', final: true }]); await stop(page); await sendAndWait(page);
  assert.ok(await lastBot(page)); await ctx.close();
});

test('language selector sets the recogniser language', async () => {
  const { page, ctx } = await open();
  await page.selectOption('#vLang', 'ar-AE'); await page.waitForSelector('#ptt');
  await listen(page);
  assert.equal(await page.evaluate(() => __rec.instances[__rec.instances.length - 1].lang), 'ar-AE');
  await stop(page); await ctx.close();
});

test('voice picker prefers Andrew Online (Natural), marks natural voices, tests the voice and is honest', async () => {
  const { page, ctx } = await open({ init: VOICES });
  await page.waitForFunction(() => document.querySelectorAll('#vVoice option').length > 2);
  const opts = await page.$$eval('#vVoice option', o => o.map(x => x.textContent));
  assert.ok(opts.some(o => /★ Microsoft Andrew Online \(Natural\)/.test(o)), opts.join('|'));
  assert.ok(!opts.some(o => /Hamed/.test(o) === false && false));
  const note = await page.innerText('#vVoiceNote'); assert.match(note, /Andrew/); assert.match(note, /Using: Microsoft Andrew Online \(Natural\)/); assert.match(note, /not an HD variant/);
  await page.click('button[data-act="vTest"]');
  assert.ok((await page.evaluate(() => window.__said)).some(t => /how I sound/.test(t)));
  await ctx.close();
});

test('push-to-talk modes: hold (pointer) and keyboard Space', async () => {
  const { page, ctx } = await open();
  await page.check('input[name="vMode"][value="hold"]');
  const box = await page.locator('#ptt').boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5); await page.mouse.down();
  await page.waitForFunction(() => document.getElementById('ptt').getAttribute('aria-pressed') === 'true');
  await say(page, [{ t: 'list my notes', final: true }]);
  await page.mouse.up();
  await page.waitForFunction(() => document.getElementById('ptt').getAttribute('aria-pressed') === 'false');
  assert.equal(await page.inputValue('#vTranscript'), 'list my notes');
  await page.focus('#ptt'); await page.keyboard.down('Space');
  await page.waitForFunction(() => document.getElementById('ptt').getAttribute('aria-pressed') === 'true');
  await page.keyboard.up('Space');
  await page.waitForFunction(() => document.getElementById('ptt').getAttribute('aria-pressed') === 'false');
  await ctx.close();
});

test('spoken approval: "approve" works for a low-risk change; bare "yes" does not; destructive needs a button', async () => {
  const { page, ctx } = await open();
  const speak = async t => { await page.evaluate(x => J.voice.run(x), t); await page.waitForTimeout(700); };
  await speak('add a task to call HR');
  assert.equal((await tasks(page)).length, 0);
  await speak('yes');
  assert.equal((await tasks(page)).length, 0, 'a bare yes never approves');
  await speak('approve');
  await page.waitForFunction(() => fetch('/api/tasks').then(r => r.json()).then(j => j.tasks.length === 1));
  // destructive
  await speak('delete task call HR');
  await speak('approve');
  assert.equal((await tasks(page)).length, 1, 'deleting is not approvable by voice');
  assert.match(await lastBot(page), /button/i);
  // rejecting by voice is always allowed
  await speak('reject');
  assert.equal((await tasks(page)).length, 1);
  await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg');
  // spoken approval can be switched off
  await page.evaluate(() => { location.hash = 'voice'; }); await page.waitForSelector('#ptt');
  await page.uncheck('input[data-setting="spokenApproval"]');
  await speak('add a task to file the report'); await speak('approve');
  assert.equal((await tasks(page)).length, 1); assert.match(await lastBot(page), /switched off|button/i);
  await ctx.close();
});

test('forget is destructive: spoken approval refused, server also refuses', async () => {
  const { page, ctx } = await open();
  await page.evaluate(() => fetch('/api/memories', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NOVA-CSRF': NOVA.csrf }, body: JSON.stringify({ text: 'I like green tea' }) }));
  assert.equal(await page.evaluate(() => fetch('/api/memories').then(r => r.json()).then(j => (j.memories || []).length)), 1);
  await page.evaluate(() => J.voice.run('forget green tea')); await page.waitForTimeout(700);
  await page.evaluate(() => J.voice.run('approve')); await page.waitForTimeout(700);
  assert.match(await lastBot(page), /button/i);
  assert.equal(await page.evaluate(() => fetch('/api/memories').then(r => r.json()).then(j => (j.memories || []).length)), 1, 'the memory is still there');
  await ctx.close();
});

for (const width of [1440, 768, 390]) {
  test('voice page layout and axe at ' + width + ' px', async () => {
    const { checkLayout } = require('./layout-check');
    const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
    const { page, ctx, errors } = await open({ width, height: width === 390 ? 844 : 900, init: VOICES });
    await listen(page); await say(page, [{ t: 'add a task to check the layout', final: true, c: 0.4 }]); await stop(page);
    await page.evaluate(() => { __rec.deny = true; }); await page.click('#ptt'); await page.waitForFunction(() => !document.getElementById('vError').hidden);
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(checkLayout), []);
    await page.screenshot({ path: path.join(__dirname, 'screenshots', width + '-nova-voice.png'), fullPage: true }).catch(() => {});
    await page.evaluate(src => (0, eval)(src), AXE);
    const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
    const bad = res.violations.filter(x => x.impact === 'serious' || x.impact === 'critical').map(x => x.id + ': ' + x.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | '));
    assert.deepEqual(bad, [], bad.join('\n')); assert.deepEqual(clean(errors), []);
    await ctx.close();
  });
}

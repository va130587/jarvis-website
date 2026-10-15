// Smart mode (optional on-device AI) with mocked models: detection, consent, progress, fallback, suggest-only.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const F = require('./fixtures/jobs-data');

const NOW = Date.parse('2026-10-15T08:00:00+04:00');
const PROFILE = { name: 'Roshan', degree: 'BSc Computer Science', skills: ['Python', 'SQL', 'Excel', 'Power BI'], titles: ['Data Analyst'], languages: ['English'], cities: ['Dubai'], nationality: 'Indian', visa: 'resident', yearsExp: '0' };
const DATA = () => ({ v: 3, profile: Object.assign({}, PROFILE), tasks: [], notes: [], skills: [], wins: [], apps: [], people: [], settings: { voice: true }, alertsReady: true, alertsSeen: F.build().jobs.map(j => j.key) });

// Chrome's built-in AI, pretended. The test decides when the "download" ends and what the model answers.
const CHROME_AI = `
  window.__ai = { created: 0, prompts: [], answer: '1', fail: false, availability: 'downloadable' };
  window.LanguageModel = {
    availability: async () => window.__ai.availability,
    create: async (opts) => {
      window.__ai.created++;
      if (window.__ai.fail) throw new Error('model crashed');
      if (opts && opts.monitor) {
        const m = new EventTarget(); opts.monitor(m);
        m.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: 0.5 }));
        await new Promise(r => { window.__ai.finish = r; });
        m.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: 1 }));
      }
      return { prompt: async p => { window.__ai.prompts.push(p); return typeof window.__ai.answer === 'function' ? window.__ai.answer(p) : window.__ai.answer; } };
    }
  };`;

let browser, server;
test.before(async () => {
  if (!process.env.BASE_URL) { server = await H.startServer(); process.env.BASE_URL = server.url; }
  browser = await H.launch();
});
test.after(async () => { await browser.close(); if (server) server.close(); });
async function open(init, data) {
  const o = await H.openApp(browser, { now: NOW, data: data || DATA(), jobs: () => F.build(), hash: 'settings', init });
  await o.page.waitForFunction(() => J.jobs.cache() && J.smart);
  return o;
}
const ask = (page, t) => H.ask(page, t);

test('off by default: no model is created, jobs and voice still work, unknown phrases get the normal reply', async () => {
  const { page, ctx, errors } = await open(CHROME_AI);
  assert.equal(await page.isChecked('#smartToggle'), false);
  assert.equal(await page.evaluate(() => window.__ai.created), 0);
  assert.equal(await page.evaluate(() => J.smart.ready()), false);
  assert.match(await ask(page, 'what jobs can hire me'), /You can apply for \d+ jobs/);
  assert.match(await ask(page, 'gimme the stuff that suits me'), /didn't catch that/);
  assert.equal(await page.evaluate(() => window.__ai.prompts.length), 0);
  await page.evaluate(() => J.actions.smartExplain());
  assert.match(await page.innerText('#toast'), /Turn on Smart mode in Settings first/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('turning it on asks for consent first; saying no keeps it off and downloads nothing', async () => {
  const { page, ctx, errors } = await open(CHROME_AI);
  await page.click('label.switch:has(#smartToggle)');
  await page.waitForSelector('#confirmDialog[open]');
  const t = await page.innerText('#confirmDialog');
  assert.match(t, /downloads a small AI model/); assert.match(t, /once/); assert.match(t, /nothing you type is sent anywhere/); assert.match(t, /only makes suggestions/);
  assert.equal(await page.evaluate(() => window.__ai.created), 0);
  await page.click('#confirmNo');
  await page.waitForFunction(() => J.data.settings.smart === false);
  assert.equal(await page.isChecked('#smartToggle'), false);
  assert.equal(await page.evaluate(() => window.__ai.created), 0);
  assert.match(await page.innerText('#smartStatus'), /stays off/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('consented download shows progress, then Smart mode is ready; it only suggests and asks before acting', async () => {
  const { page, ctx, errors } = await open(CHROME_AI);
  await page.click('label.switch:has(#smartToggle)');
  await page.click('#confirmYes');
  await page.waitForFunction(() => /Downloading the built-in AI model… 50%/.test(document.getElementById('smartStatus').textContent));
  assert.equal(await page.$eval('#smartBar', e => e.value), 50);
  assert.equal(await page.$eval('#smartBar', e => e.hidden), false);
  await page.evaluate(() => window.__ai.finish());
  await page.waitForFunction(() => J.smart.ready());
  assert.match(await page.innerText('#smartStatus'), /Smart mode is on \(Chrome built-in AI\)/);
  assert.equal(await page.$eval('#smartBar', e => e.hidden), true);
  // an unclear request: the model picks a command, Jarvis asks, nothing runs until yes
  const q = await ask(page, 'gimme the stuff that suits me');
  assert.match(q, /Smart mode thinks you meant "what jobs can hire me"\. Run it\? Say yes or no\./);
  assert.equal(await page.evaluate(() => J.current()), 'settings');          // nothing happened yet
  assert.match(await ask(page, 'no'), /left it as it is/);
  assert.equal(await page.evaluate(() => J.current()), 'settings');
  await ask(page, 'gimme the stuff that suits me');
  await ask(page, 'yes');
  await page.waitForFunction(() => J.current() === 'matches');
  // the prompt that was sent contained only the phrase and the command list
  const prompt = await page.evaluate(() => window.__ai.prompts[0]);
  assert.match(prompt, /gimme the stuff that suits me/); assert.doesNotMatch(prompt, /Roshan|BSc|Indian/);
  // the model says nothing fits: normal "didn't catch" reply
  await page.evaluate(() => { window.__ai.answer = '0'; });
  assert.match(await ask(page, 'purple monkey dishwasher'), /didn't catch that/);
  // the model answers rubbish: still safe
  await page.evaluate(() => { window.__ai.answer = 'I think maybe delete everything'; });
  assert.match(await ask(page, 'purple monkey dishwasher'), /didn't catch that/);
  assert.equal(await page.evaluate(() => J.data.apps.length + J.data.tasks.length + J.data.rules.length), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('"Explain with Smart mode" and cover-letter polish are shown as suggestions; data is unchanged', async () => {
  const { page, ctx, errors } = await open(CHROME_AI, Object.assign(DATA(), { settings: { voice: true, smart: true } }));
  await page.evaluate(() => window.__ai.finish && 0);
  // a model that was approved earlier starts again without asking
  await page.waitForFunction(() => window.__ai.created === 1);
  await page.evaluate(() => window.__ai.finish());
  await page.waitForFunction(() => J.smart.ready());
  await page.evaluate(() => { window.__ai.answer = 'This job fits because you know SQL and Excel.'; });
  const before = await page.evaluate(() => JSON.stringify(J.data));
  await page.goto(page.url().replace(/#.*/, '#matches'));
  await page.waitForSelector('.match-card');
  await page.click('button:has-text("Explain with Smart mode")');
  await page.waitForSelector('#formDialog[open]');
  const t = await page.innerText('#formDialog');
  assert.match(t, /Suggestion from on-device AI/); assert.match(t, /It can be wrong/); assert.match(t, /Nothing was changed/);
  assert.match(t, /This job fits because you know SQL and Excel/);
  assert.match(await page.evaluate(() => window.__ai.prompts[0]), /Use ONLY these facts/);
  await page.click('#dialogSave');
  assert.equal(await page.evaluate(() => JSON.stringify(J.data)), before);
  // cover letter polish
  await page.evaluate(() => { const j = J.matches.sections().best[0]; J.jobs.save(j); });
  const id = await page.evaluate(() => J.data.apps[0].id);
  await page.evaluate(i => J.actions.smartCover(i), id);
  await page.waitForFunction(() => /Smart cover letter draft/.test(document.getElementById('formTitle').textContent));
  assert.match(await page.evaluate(() => window.__ai.prompts.slice(-1)[0]), /Keep every fact exactly as written/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('no AI available: a clear message, the switch goes back off, matching still works', async () => {
  const { page, ctx, errors } = await open("Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });");
  assert.match(await page.innerText('#smartStatus'), /Not available here/);
  await page.click('label.switch:has(#smartToggle)');
  await page.waitForFunction(() => J.data.settings.smart === false);
  assert.equal(await page.isChecked('#smartToggle'), false);
  assert.match(await page.innerText('#smartStatus'), /not available on this browser or device/);
  assert.match(await ask(page, 'what jobs can hire me'), /You can apply for \d+ jobs/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a model that fails to start falls back to normal matching with a message', async () => {
  const { page, ctx, errors } = await open(CHROME_AI);
  await page.evaluate(() => { window.__ai.fail = true; });
  await page.click('label.switch:has(#smartToggle)');
  await page.click('#confirmYes');
  await page.waitForFunction(() => /could not start/.test(document.getElementById('smartStatus').textContent));
  assert.equal(await page.evaluate(() => J.data.settings.smart), false);
  assert.equal(await page.evaluate(() => J.smart.ready()), false);
  assert.match(await ask(page, 'what jobs can hire me'), /You can apply for \d+ jobs/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('WebLLM route (no built-in AI, WebGPU present): loads the pinned module only after consent', async () => {
  const gpu = "Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });";
  const o = await H.openApp(browser, { now: NOW, data: DATA(), jobs: () => F.build(), hash: 'settings', init: gpu });
  const { page, ctx, errors } = o;
  const hits = [];
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@mlc-ai\/web-llm@/, r => {
    hits.push(r.request().url());
    r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: `
      export async function CreateMLCEngine(model, opts) { opts.initProgressCallback({ progress: 0.4 }); opts.initProgressCallback({ progress: 1 });
        return { chat: { completions: { create: async () => ({ choices: [{ message: { content: '2' } }] }) } } }; }` });
  });
  await page.waitForFunction(() => J.smart);
  assert.deepEqual(hits, []);                                    // nothing is downloaded before the person agrees
  await page.click('label.switch:has(#smartToggle)');
  assert.deepEqual(hits, []);
  await page.click('#confirmYes');
  await page.waitForFunction(() => J.smart.ready());
  assert.equal(hits.length, 1); assert.match(hits[0], /web-llm@\d+\.\d+\.\d+/);   // pinned version
  assert.match(await page.innerText('#smartStatus'), /WebLLM/);
  assert.match(await ask(page, 'gimme the stuff that suits me'), /thinks you meant "show my best matches"/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('turning it off stops it', async () => {
  const { page, ctx } = await open(CHROME_AI, Object.assign(DATA(), { settings: { voice: true, smart: true } }));
  await page.waitForFunction(() => window.__ai.created === 1);
  await page.evaluate(() => window.__ai.finish());
  await page.waitForFunction(() => J.smart.ready());
  await page.click('label.switch:has(#smartToggle)');
  await page.waitForFunction(() => !J.smart.ready());
  assert.equal(await page.evaluate(() => J.data.settings.smart), false);
  await ctx.close();
});

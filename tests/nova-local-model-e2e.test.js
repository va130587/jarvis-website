// The free local model in the browser: understanding everyday phrasing, the "where did this run" badge, clarifying questions, setup help when Ollama is not running.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const H = require('./helpers');
const { boot, closeAll } = require('./server-helpers');

let browser; const extra = [];
test.before(async () => { browser = await H.launch(); });
test.after(async () => { await browser.close(); extra.forEach(s => { s.closeAllConnections && s.closeAllConnections(); s.close(); }); await closeAll(); });
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets|fonts\.googleapis/.test(e));

// A stand-in Ollama that "understands" three phrasings like a good model would.
function standIn() {
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }] }));
      const body = JSON.parse(b), last = body.messages[body.messages.length - 1];
      let msg;
      if (last.role === 'tool') msg = { role: 'assistant', content: 'Done.' };
      else if (/phone the bank/i.test(last.content)) msg = { role: 'assistant', content: '', tool_calls: [{ function: { name: 'tasks_create', arguments: { title: 'Phone the bank' } } }] };
      else if (/do the thing/i.test(last.content)) msg = { role: 'assistant', content: '', tool_calls: [{ function: { name: 'ask_clarify', arguments: { question: 'Which task do you mean?' } } }] };
      else msg = { role: 'assistant', content: 'I can help with tasks, notes and memories.' };
      res.end(JSON.stringify({ message: msg, prompt_eval_count: 100, eval_count: 12 }));
    });
  });
  extra.push(srv);
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + srv.address().port)));
}
async function open(srv, email) {
  const o = await H.openApp(browser, { base: srv.base, hash: '' });
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.waitForSelector('#novaDevEmail'); await o.page.fill('#novaDevEmail', email || 'roshan@example.com'); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && J.current() === 'dashboard');
  return o;
}
const say = async (page, t) => { const n = await page.$$eval('.msg.bot', e => e.length); await page.fill('#novaMsg', t); await page.click('#novaChatForm button'); await page.waitForFunction(k => document.querySelectorAll('.msg.bot').length > k && !document.querySelector('.typing'), n); };

test('a normal sentence becomes an approved task through the local model; the badge says where it ran', async () => {
  const url = await standIn(); const srv = await boot({ NOVA_AI_PROVIDER: 'ollama', NOVA_OLLAMA_URL: url, NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  const { page, ctx, errors } = await open(srv);
  await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg');
  assert.match(await page.innerText('main'), /local model \(Ollama, free/i);
  await page.evaluate(() => { window.__o = []; new MutationObserver(() => { const s = document.body.getAttribute('data-nova'); if (window.__o[window.__o.length - 1] !== s) window.__o.push(s); }).observe(document.body, { attributes: true, attributeFilter: ['data-nova'] }); });
  await say(page, 'I should phone the bank sometime');
  assert.match(await page.innerText('.msg.bot:last-child .who'), /local model/i);
  assert.match(await page.innerText('.preview'), /Create a task[\s\S]*Phone the bank/);
  assert.ok((await page.evaluate(() => window.__o)).includes('planning'));                    // the orb shows planning while a model plans
  await page.click('.preview button:has-text("Approve")'); await page.waitForSelector('.msg.bot:last-child .text:has-text("Checked by NOVA")');
  assert.match(await page.innerText('.msg.bot:last-child .text'), /Done\.[\s\S]*Checked by NOVA: Read back from the database: task #\d+ "Phone the bank" exists/);
  await say(page, 'do the thing');
  assert.equal((await page.innerText('.msg.bot:last-child .text')).trim(), 'Which task do you mean?');
  assert.equal(await page.locator('.msg.bot:last-child .preview').count(), 0);
  await say(page, 'tell me about yourself'); assert.match(await page.innerText('.msg.bot:last-child .text'), /tasks, notes and memories/);
  await page.evaluate(() => { location.hash = 'usage'; }); await page.waitForSelector('table.cmds');
  assert.match(await page.innerText('main'), /Local model \(free\)/i);
  await page.evaluate(() => { location.hash = 'dashboard'; }); await page.waitForSelector('.stats');
  assert.match(await page.innerText('.stats'), /local model, free/i);
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('Connected Apps shows the real model status; with Ollama missing it gives a setup checklist and chat explains instead of failing silently', async () => {
  const url = await standIn(); const up = await boot({ NOVA_AI_PROVIDER: 'ollama', NOVA_OLLAMA_URL: url, NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  let { page, ctx, errors } = await open(up);
  await page.evaluate(() => { location.hash = 'connections'; }); await page.waitForSelector('text=Local model (Ollama, free): qwen2.5:7b');
  assert.match(await page.innerText('.sources'), /Ready/i); assert.equal(await page.locator('ol[aria-label="Setup checklist"]').count(), 0);
  await ctx.close();
  const down = await boot({ NOVA_AI_PROVIDER: 'ollama', NOVA_OLLAMA_URL: 'http://127.0.0.1:1', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
  ({ page, ctx, errors } = await open(down));
  await page.evaluate(() => { location.hash = 'connections'; }); await page.waitForSelector('ol[aria-label="Setup checklist"]');
  assert.match(await page.innerText('.sources'), /Not reachable/i); const list = await page.innerText('ol[aria-label="Setup checklist"]');
  assert.match(list, /Install Ollama/); assert.match(list, /ollama pull qwen2\.5:7b/); assert.match(list, /qwen2\.5:3b/);
  await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg');
  await say(page, 'what should I focus on this week'); assert.match(await page.innerText('.msg.bot:last-child .text'), /not reachable at http:\/\/127\.0\.0\.1:1[\s\S]*ollama pull/);
  await say(page, 'add a task to keep working'); assert.equal(await page.locator('.preview').count(), 1);          // built-in actions still work
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

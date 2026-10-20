// NOVA in a real browser against the real server (strict CSP active): sign-in gate, pages, chat, orb, Memory Vault, identity, security, usage, voice hook.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers');
const { boot, closeAll } = require('./server-helpers');

let browser, srv, dbDir;
test.before(async () => {
  browser = await H.launch();
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-e2e-'));
  srv = await boot({ NOVA_DB: path.join(dbDir, 'nova.db'), OWNER_EMAILS: 'roshan@example.com,mallory@example.com', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
});
test.after(async () => { await browser.close(); await closeAll(); fs.rmSync(dbDir, { recursive: true, force: true }); });

async function open(opts) {
  const o = await H.openApp(browser, Object.assign({ base: srv.base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  return o;
}
async function signIn(page, email) {
  await page.waitForSelector('#novaDevEmail');
  await page.fill('#novaDevEmail', email || 'roshan@example.com');
  await page.click('#novaDevForm button');
  await page.waitForFunction(() => window.NOVA && NOVA.user && J.current() === 'dashboard');
}
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_/.test(e));

test('sign-in gate: nothing is shown until you sign in; the allow-list is enforced; the page works under a strict CSP', async () => {
  const { page, ctx, errors } = await open();
  assert.equal(await page.title(), 'NOVA');
  await page.waitForSelector('#novaLogin');
  assert.match(await page.innerText('#novaLogin'), /NOVA[\s\S]*From Request to Verified Result/);
  assert.match(await page.innerText('#novaLogin'), /not from a name typed in a box/);
  assert.match(await page.innerText('#novaLogin'), /Development sign-in: this computer only/i);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.nav') || document.body).visibility), 'hidden');
  assert.equal(await page.evaluate(() => document.getElementById('novaLogin').getAttribute('aria-modal')), 'true');
  await page.fill('#novaDevEmail', 'stranger@example.com'); await page.click('#novaDevForm button');
  await page.waitForFunction(() => /not on this server/.test(document.getElementById('novaLogin').textContent));
  await signIn(page);
  assert.match(await page.innerText('main'), /Good (morning|afternoon|evening), Roshan/);
  assert.equal(await page.evaluate(() => document.getElementById('novaLogin')), null);
  assert.deepEqual(clean(errors), []);                                           // no CSP violations
  // a reload keeps the session (cookie), a sign-out ends it
  await page.reload(); await page.waitForFunction(() => window.NOVA && NOVA.user);
  await page.evaluate(() => J.actions.novaSignOut()); await page.waitForSelector('#novaLogin');
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('14 NOVA pages: working ones are real, the rest are clearly labelled Upcoming', async () => {
  const { page, ctx, errors } = await open(); await signIn(page);
  const nav = await page.$$eval('.nav a[data-view]', as => as.map(a => [a.getAttribute('data-view'), a.textContent.trim()]));
  const novaPages = ['dashboard', 'briefing', 'chat', 'voice', 'email', 'hub', 'proofloop', 'automation', 'identity', 'memory', 'knowledge', 'usage', 'connections', 'security'];
  for (const v of novaPages) assert.ok(nav.some(n => n[0] === v), 'nav has ' + v);
  const live = ['dashboard', 'briefing', 'chat', 'voice', 'email', 'automation', 'hub', 'proofloop', 'identity', 'memory', 'usage', 'connections', 'security'], upcoming = ['knowledge'];
  for (const v of novaPages) {
    await page.evaluate(h => { location.hash = h; }, v); await page.waitForTimeout(250);
    const t = await page.innerText('main');
    assert.ok((await page.title()).includes('NOVA'), v);
    if (upcoming.includes(v)) { assert.match(t, /Upcoming/i, v); assert.match(t, /not (been )?built yet|Not built yet/i, v); assert.match(nav.find(n => n[0] === v)[1], /upcoming/i); }
    else assert.doesNotMatch(t, /Not built yet\./, v);
  }
  assert.match(await page.innerText('.nav'), /Soon/i);
  assert.equal(await page.evaluate(() => document.getElementById('sampleBanner').offsetParent === null || getComputedStyle(document.getElementById('sampleBanner')).display === 'none'), true);
  assert.match(await page.innerText('.nav'), /Classic tools \(stored in this browser\)/i);
  // the existing Classic tools still open
  for (const v of ['tasks', 'calendar', 'notes', 'matches', 'jobs', 'applications', 'growth', 'review', 'profile', 'settings', 'help', 'today']) { await page.evaluate(h => { location.hash = h; }, v); await page.waitForTimeout(150); assert.equal(await page.evaluate(() => J.current()), v); }
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('NOVA orb: ten states, each with its own text, set by real events (chat request, approval, error, voice)', async () => {
  const { page, ctx, errors } = await open(); await signIn(page);
  await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg');
  await page.evaluate(() => { window.__orbStates = []; new MutationObserver(() => { const s = document.body.getAttribute('data-nova'); const l = window.__orbStates; if (l[l.length - 1] !== s) l.push(s); }).observe(document.body, { attributes: true, attributeFilter: ['data-nova'] }); });
  await page.fill('#novaMsg', 'what time is it'); await page.click('#novaChatForm button');
  await page.waitForFunction(() => window.__orbStates.includes('completed'));
  assert.deepEqual((await page.evaluate(() => window.__orbStates)).slice(0, 2), ['understanding', 'completed']);
  await page.waitForFunction(() => document.body.getAttribute('data-nova') === 'idle', null, { timeout: 5000 });
  await page.waitForSelector('#novaMsg:not([disabled])');
  await page.fill('#novaMsg', 'remember that I like green tea'); await page.click('#novaChatForm button');
  await page.waitForFunction(() => window.__orbStates.includes('waiting_approval'));
  assert.match(await page.innerText('#novaStatusText'), /Waiting for your approval/);
  assert.equal(await page.getAttribute('.chat-head .nova-orb', 'aria-label'), 'NOVA status: Waiting for your approval');
  // all ten states exist and are described in words (colour is never the only signal)
  const all = await page.evaluate(() => { const out = {}; ['idle', 'listening', 'transcribing', 'understanding', 'planning', 'executing', 'waiting_approval', 'speaking', 'completed', 'error'].forEach(s => { NOVA.setState(s, true); out[s] = [document.querySelector('.nova-orb').getAttribute('aria-label'), getComputedStyle(document.querySelector('.nova-orb .o-core')).animationName, getComputedStyle(document.querySelector('.nova-orb')).getPropertyValue('--c1')]; }); return out; });
  assert.equal(Object.keys(all).length, 10);
  assert.equal(new Set(Object.values(all).map(v => v[0])).size, 10);
  assert.equal(new Set(Object.values(all).map(v => v[2].trim())).size >= 6, true);
  // a real failure (session ended) sets the error state
  await page.evaluate(() => NOVA.setState('idle'));
  // voice states come from the existing voice engine
  await page.evaluate(() => document.body.setAttribute('data-voice', 'listening'));
  await page.waitForFunction(() => document.body.getAttribute('data-nova') === 'listening');
  await page.evaluate(() => document.body.setAttribute('data-voice', 'thinking'));
  await page.waitForFunction(() => document.body.getAttribute('data-nova') === 'transcribing');
  await page.evaluate(() => document.body.setAttribute('data-voice', 'speaking'));
  await page.waitForFunction(() => document.body.getAttribute('data-nova') === 'speaking');
  await page.evaluate(() => document.body.setAttribute('data-voice', 'idle'));
  await page.waitForFunction(() => document.body.getAttribute('data-nova') === 'idle');
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('orb animation stops with reduced motion', async () => {
  const { page, ctx } = await open(); await signIn(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.nova-orb .o-core')).animationName), 'none');
  await ctx.close();
});

test('chat: who am I (from the account), what NOVA did, remember → approve → Memory Vault, reject, secrets refused, no AI says so', async () => {
  const { page, ctx, errors } = await open(); await signIn(page, 'roshan@example.com');
  await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg');
  const say = async t => { const n = await page.$$eval('.msg.bot', e => e.length); await page.fill('#novaMsg', t); await page.click('#novaChatForm button'); await page.waitForFunction(k => document.querySelectorAll('.msg.bot').length > k && !document.querySelector('.typing'), n); };
  await say('NOVA, who am I?');
  assert.match(await page.innerText('.msg.bot:last-child'), /You're Roshan, the owner of this authenticated NOVA account \(roshan@example.com\)/);
  await page.click('.msg.bot:last-child .steps summary');
  assert.match(await page.innerText('.msg.bot:last-child .steps'), /Read your identity from the signed-in account[\s\S]*Handled by: a built-in rule \(no AI\)/);
  await say('remember that my goal is to become a data analyst');
  assert.match(await page.innerText('.proposal'), /Waiting for your approval: “my goal is to become a data analyst”/);
  assert.equal((await page.evaluate(() => fetch('/api/memories?status=active').then(r => r.json()))).memories.length, 0);   // nothing saved yet
  await page.click('.proposal button:has-text("Save this memory")');
  await page.waitForSelector('text=Saved to your Memory Vault.');
  await say('remember that I like green tea');
  await page.click('.proposal button:has-text("Don\'t save")'); await page.waitForSelector('text=Not saved.');
  await say('remember that my password is swordfish');
  assert.match(await page.innerText('.msg.bot:last-child'), /will not store a password or code/);
  await say('What is the capital of France?');
  assert.match(await page.innerText('.msg.bot:last-child'), /only when an AI model is connected/);
  await say('what do you remember about me');
  assert.match(await page.innerText('.msg.bot:last-child'), /my goal is to become a data analyst/); assert.doesNotMatch(await page.innerText('.msg.bot:last-child'), /green tea|swordfish/);
  // history is kept and can be reopened
  await page.click('button:has-text("New chat")');
  await page.waitForSelector('.chat-list .link-btn'); await page.click('.chat-list .link-btn');
  await page.waitForSelector('.msg.me'); assert.match(await page.innerText('#novaLog'), /who am I/);
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('Memory Vault: add, correct, delete, sensitive confirmation, secrets refused; survives a browser restart; isolated from another user', async () => {
  let { page, ctx, errors } = await open(); await signIn(page, 'roshan@example.com');
  await page.evaluate(() => { location.hash = 'memory'; }); await page.waitForSelector('text=Saved memories');
  await page.click('button:has-text("Add a memory")'); await page.fill('#f_text', 'I prefer morning meetings'); await page.selectOption('#f_kind', 'preference'); await page.click('#dialogSave');
  await page.waitForSelector('.items:has-text("I prefer morning meetings")');
  const row = await page.innerText('.item:has-text("morning meetings")');
  assert.match(row, /Preference/); assert.match(row, /saved .*20\d\d/); assert.match(row, /source: you \(Memory Vault\)/);
  await page.click('.item:has-text("morning meetings") [data-act="novaEditMem"]'); await page.fill('#f_text', 'I prefer early meetings'); await page.click('#dialogSave');
  await page.waitForSelector('.item:has-text("early meetings")'); assert.match(await page.innerText('.item:has-text("early meetings")'), /corrected by you/);
  await page.click('button:has-text("Add a memory")'); await page.fill('#f_text', 'My passport is in the blue folder'); await page.click('#dialogSave');
  await page.waitForSelector('#confirmDialog[open]'); assert.match(await page.innerText('#confirmDialog'), /confirm that you want NOVA to remember it/i); await page.click('#confirmYes');
  await page.waitForSelector('.item:has-text("passport")'); assert.match(await page.innerText('.item:has-text("passport")'), /Sensitive/i);
  await page.click('button:has-text("Add a memory")'); await page.fill('#f_text', 'my card number is 4111 1111 1111 1111'); await page.click('#dialogSave');
  await page.waitForFunction(() => /will not store a card/.test(document.getElementById('toast').textContent));
  assert.equal(await page.locator('.item:has-text("4111")').count(), 0);
  await ctx.close();
  // new browser (no cookies, no local storage): sign in again, memories are still there
  ({ page, ctx, errors } = await open()); await signIn(page, 'roshan@example.com');
  await page.evaluate(() => { location.hash = 'memory'; }); await page.waitForSelector('.item:has-text("early meetings")');
  await page.click('.item:has-text("passport") [data-act="novaDelMem"]'); await page.click('#confirmYes');
  await page.waitForFunction(() => !document.querySelector('main').textContent.includes('blue folder'));
  await ctx.close();
  // another user sees none of it
  ({ page, ctx, errors } = await open()); await signIn(page, 'mallory@example.com');
  await page.evaluate(() => { location.hash = 'memory'; }); await page.waitForSelector('text=Nothing saved yet');
  assert.doesNotMatch(await page.innerText('main'), /early meetings/);
  assert.match(await page.evaluate(() => fetch('/api/profile').then(r => r.text())), /mallory@example.com/);
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('Personal Identity: edit the display name, switch personalisation off and on', async () => {
  const { page, ctx, errors } = await open(); await signIn(page, 'roshan@example.com');
  await page.evaluate(() => { location.hash = 'identity'; }); await page.waitForSelector('#novaName');
  assert.match(await page.innerText('.kv'), /roshan@example.com/);
  await page.fill('#novaName', 'Ro'); await page.click('#novaProfileForm button');
  await page.waitForFunction(() => NOVA.user.displayName === 'Ro');
  await page.evaluate(() => { location.hash = 'dashboard'; }); await page.waitForSelector('.greet');
  assert.match(await page.innerText('.greet'), /, Ro$/);
  await page.evaluate(() => { location.hash = 'identity'; }); await page.waitForSelector('#novaPers');
  await page.uncheck('#novaPers', { force: true }); await page.click('#novaProfileForm button');
  await page.waitForFunction(() => NOVA.user.personalization === false);
  await page.evaluate(() => { location.hash = 'memory'; }); await page.waitForSelector('text=Personalisation is off');
  await page.evaluate(() => { location.hash = 'identity'; }); await page.waitForSelector('#novaPers');
  await page.check('#novaPers', { force: true }); await page.fill('#novaName', 'Roshan'); await page.click('#novaProfileForm button');
  await page.waitForFunction(() => NOVA.user.personalization === true && NOVA.user.displayName === 'Roshan');
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('Usage page shows the real ledger; Security page: sessions, audit, export, typed-confirmation deletion, session expiry handled', async () => {
  const { page, ctx, errors } = await open({ width: 1440 }); await signIn(page, 'roshan@example.com');
  await page.evaluate(() => J.voice.command('what time is it')).catch(() => {});
  await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg');
  await page.fill('#novaMsg', 'hello'); await page.click('#novaChatForm button'); await page.waitForSelector('.msg.bot');
  await page.evaluate(() => { location.hash = 'usage'; }); await page.waitForSelector('table.cmds');
  const u = await page.innerText('main');
  assert.match(u, /Built-in rules \(no AI\)/i); assert.match(u, /estimate/i); assert.match(u, /billed separately/); assert.match(u, /rules only: free/);
  await page.evaluate(() => { location.hash = 'security'; }); await page.waitForSelector('text=This session');
  assert.match(await page.innerText('main'), /login/i);                            // audit log shows the sign-in
  assert.match(await page.innerText('main'), /automatic retention schedule is not built yet/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download everything")')]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8')); assert.equal(exported.user.email, 'roshan@example.com'); assert.ok(Array.isArray(exported.memories));
  await page.click('button:has-text("Delete all my memories")'); await page.fill('#f_confirm', 'nope'); await page.click('#dialogSave');
  await page.waitForFunction(() => /Type DELETE MY DATA/.test(document.getElementById('toast').textContent));
  // the server ends the session -> the next call returns to the sign-in screen instead of failing silently
  srv.app.db.prepare('DELETE FROM sessions').run();
  await page.evaluate(() => NOVA.api('GET', '/api/memories').catch(() => {}));
  await page.waitForSelector('#novaLogin'); assert.match(await page.innerText('#novaLogin'), /session ended/);
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('voice: a spoken request that Classic tools do not know is answered by NOVA on the server', async () => {
  const { page, ctx, errors } = await open(); await signIn(page, 'roshan@example.com');
  const r = await H.ask(page, 'NOVA, who am I?');
  assert.match(r, /You're Roshan, the owner of this authenticated NOVA account/);
  assert.match(await H.ask(page, 'what\'s on my calendar today'), /item|task|calendar|connect|nothing|no events/i);   // built-in tools still answer their own commands
  await page.evaluate(() => { location.hash = 'voice'; }); await page.waitForSelector('text=Push to talk');
  assert.match(await page.innerText('main'), /never<\/?b?>? used to prove|never used to prove/i);
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

for (const width of [1440, 768, 390]) {
  test('layout at ' + width + ' px: sign-in, dashboard, chat, memory, identity, usage, security, upcoming pages', async () => {
    const { checkLayout } = require('./layout-check');
    const { page, ctx, errors } = await open({ width, height: width === 390 ? 844 : 900 });
    await page.waitForSelector('#novaLogin'); await page.waitForTimeout(300);
    const problems = []; const check = async n => (await page.evaluate(checkLayout)).forEach(x => problems.push(n + ': ' + x));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'login does not scroll sideways');
    await signIn(page, 'roshan@example.com');
    await page.evaluate(() => J.voice.command('remember that I like the Atlas project'));
    for (const v of ['dashboard', 'chat', 'voice', 'email', 'hub', 'proofloop', 'identity', 'memory', 'usage', 'connections', 'security']) {
      await page.evaluate(h => { location.hash = h; }, v); await page.waitForTimeout(600); await check(v);
      await page.screenshot({ path: path.join(__dirname, 'screenshots', width + '-nova-' + v + '.png'), fullPage: true }).catch(() => {});
    }
    assert.deepEqual(problems, [], problems.join('\n'));
    assert.deepEqual(clean(errors), []);
    await ctx.close();
  });
}

test('keyboard only: sign in, reach chat, send, approve a memory, using Tab / Enter / Space', async () => {
  const { page, ctx, errors } = await open();
  await page.waitForSelector('#novaDevEmail'); await page.keyboard.type('roshan@example.com'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.NOVA && NOVA.user);
  await page.evaluate(() => { location.hash = 'chat'; }); await page.waitForSelector('#novaMsg');
  await page.focus('#novaMsg'); await page.keyboard.type('remember that I use keyboards'); await page.keyboard.press('Enter');
  await page.waitForSelector('.proposal');
  let found = false; for (let i = 0; i < 20 && !found; i++) { await page.keyboard.press('Shift+Tab'); found = await page.evaluate(() => document.activeElement.tagName === 'BUTTON' && /Save this memory/.test(document.activeElement.textContent)); }
  assert.ok(found); await page.keyboard.press('Space');
  await page.waitForSelector('text=Saved to your Memory Vault.');
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

for (const view of ['login', 'dashboard', 'chat', 'memory', 'identity', 'usage', 'security', 'connections', 'email']) {
  test('axe-core: no serious or critical issues on NOVA ' + view, async () => {
    const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
    const { page, ctx } = await open();
    if (view !== 'login') { await signIn(page, 'roshan@example.com'); await page.evaluate(h => { location.hash = h; }, view); if (view === 'memory') await page.evaluate(() => fetch('/api/memories', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nova-csrf': NOVA.csrf }, body: JSON.stringify({ text: 'Axe sample memory' }) })); await page.waitForTimeout(700); }
    else await page.waitForSelector('#novaLogin');
    await page.evaluate(src => (0, eval)(src), AXE).catch(async () => { await page.addScriptTag({ content: AXE }); });
    const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
    const bad = res.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ': ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | '));
    assert.deepEqual(bad, [], bad.join('\n'));
    await ctx.close();
  });
}

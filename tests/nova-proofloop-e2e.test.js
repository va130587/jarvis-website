// ProofLoop in the browser: Mission Control, demo scenarios, the typed and spoken path from a sentence to a tracked commitment, evidence rules, receipts, a11y and layout.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const { boot, closeAll } = require('./server-helpers');

let browser, srv;
test.before(async () => { browser = await H.launch(); srv = await boot({ OWNER_EMAILS: 'proof1@example.com,proof2@example.com,proof3@example.com,proof4@example.com,proof5@example.com', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' }); });
test.after(async () => { await browser.close(); await closeAll(); });
const clean = errors => errors.filter(e => !/Failed to load resource|ERR_|preload assets|fonts\.googleapis/.test(e));
async function open(email, opts) {
  const o = await H.openApp(browser, Object.assign({ base: srv.base, hash: '' }, opts || {}));
  await o.page.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown');
  await o.page.waitForSelector('#novaDevEmail'); await o.page.fill('#novaDevEmail', email); await o.page.click('#novaDevForm button');
  await o.page.waitForFunction(() => window.NOVA && NOVA.user && J.current() === 'dashboard');
  return o;
}
const go = async (page, v) => { await page.evaluate(h => { location.hash = h; }, v); await page.waitForTimeout(500); };
const toast = page => page.evaluate(() => document.getElementById('toast').textContent);
const api = (page, p) => page.evaluate(u => fetch(u).then(r => r.json()), p);

test('Mission Control: an empty account offers the labelled demo; 9 scenarios load with the real states; filters and lanes work; reset and remove', async () => {
  const { page, ctx, errors } = await open('proof1@example.com'); await go(page, 'proofloop');
  assert.match(await page.innerText('main'), /No commitments yet/); assert.match(await page.innerText('main'), /fictional, clearly labelled/);
  assert.equal(await page.locator('.nav a[data-view="proofloop"] .count.soon').count(), 0);                          // ProofLoop is live: no "Soon" badge
  await page.click('button:has-text("load 9 demo scenarios")'); await page.waitForSelector('text=9 fictional demo commitments are showing');
  const t = await page.innerText('main');
  for (const lane of ['Needs your attention', 'In progress', 'Submitted, waiting for confirmation', 'Verified and completed', 'Failed or cancelled']) assert.match(t, new RegExp(lane, 'i'), lane);
  assert.equal(await page.locator('.item .tag.sample').count(), 9);                                                    // every card says Demo
  assert.equal((await page.locator('.item').count()), 9);
  const tiles = await page.$$eval('.stats .stat', e => e.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
  assert.match(tiles[0], /I OWE 4/i); assert.match(tiles[1], /OWED TO ME 1/i); assert.match(tiles[2], /AWAITING APPROVAL 1/i); assert.match(tiles[3], /OVERDUE 1/i); assert.match(tiles[4], /AWAITING CONFIRMATION 2/i); assert.match(tiles[5], /VERIFIED 1/i);
  await page.click('.tab:has-text("Overdue")'); assert.equal(await page.locator('.item').count(), 1); assert.match(await page.innerText('.item'), /scholarship form[\s\S]*Overdue/i);
  await page.click('.tab:has-text("Owed to me")'); assert.match(await page.innerText('.item'), /lab equipment quote/);
  await page.click('.tab:has-text("All")');
  await page.click('button:has-text("Reset demo")'); await page.waitForFunction(() => /Demo reset/.test(document.getElementById('toast').textContent)); assert.equal(await page.locator('.item').count(), 9);
  await page.click('button:has-text("Remove demo data")'); await page.click('#confirmYes'); await page.waitForSelector('text=No commitments yet');
  assert.deepEqual((await api(page, '/api/commitments')).commitments, []);
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('a sentence becomes a tracked commitment: preview, approve, "NOT verified yet", evidence chain, refusal to verify without proof, then your confirmation closes it as self-reported', async () => {
  const { page, ctx, errors } = await open('proof2@example.com');
  await go(page, 'chat'); await page.waitForSelector('#novaMsg');
  await page.fill('#novaMsg', 'remind me to send the proposal to the client by friday'); await page.click('#novaChatForm button');
  await page.waitForSelector('.preview'); assert.match(await page.innerText('.msg.bot:last-child'), /ProofLoop is tracking this as commitment #\d+|Waiting for your approval/i);
  await go(page, 'proofloop'); await page.waitForSelector('.item:has-text("send the proposal to the client")');
  assert.match(await page.innerText('.panel:has-text("Needs your attention")'), /Awaiting Approval/i);
  await go(page, 'chat'); await page.waitForSelector('.preview'); await page.click('.preview button:has-text("Approve")');
  await page.waitForSelector('.msg.bot:last-child .text:has-text("NOT verified yet")');
  assert.match(await page.innerText('.msg.bot:last-child .text'), /cannot see whether you did it/);
  await go(page, 'proofloop'); await page.waitForSelector('.panel:has-text("Submitted, waiting for confirmation") .item:has-text("send the proposal")');
  await page.click('.item:has-text("send the proposal") button:has-text("Open")'); await page.waitForSelector('#formDialog[open] .why');
  const d = await page.innerText('#formDialog'); assert.match(d, /Awaiting Confirmation/i); assert.match(d, /Submitted \(an action was taken\)/); assert.doesNotMatch(d, /independent check/i);
  assert.match(d, /Task #\d+ was created/); assert.match(d, /Waiting for you to do it/);
  // the machine refuses to verify without proof, and says why
  await page.click('#formDialog button[data-to="verified"]'); await page.waitForFunction(() => /Verified needs evidence[\s\S]*not proof of acceptance/.test(document.getElementById('toast').textContent));
  // add your own confirmation as evidence, then move it on
  await page.selectOption('#plEvKind', 'verified'); await page.fill('#plEvText', 'Client replied that the proposal arrived'); await page.click('#plEvForm button[data-act="plAddEvidence"]');
  await page.waitForSelector('#formDialog[open] .why-list li.yes'); assert.match(await page.innerText('#formDialog .why-list li.yes'), /self-reported/);
  await page.click('#formDialog button[data-to="verified"]'); await page.waitForSelector('#formDialog button[data-to="completed"]'); await page.click('#formDialog button[data-to="completed"]');
  await page.waitForSelector('#formDialog .verdict:has-text("Completed")'); assert.match(await page.innerText('#formDialog'), /This commitment is finished/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#formDialog button:has-text("Export proof receipt")')]);
  const md = fs.readFileSync(await dl.path(), 'utf8'); assert.match(md, /# Proof receipt: send the proposal to the client/); assert.match(md, /Verified only by your own confirmation \(self-reported\)/); assert.match(md, /## Timeline/); assert.match(md, /Awaiting Confirmation/);
  const cid = (await api(page, '/api/commitments')).commitments[0].id;
  const html = await page.evaluate(i => fetch('/api/commitments/' + i + '/receipt?format=html').then(r => r.text()), cid); assert.match(html, /Proof receipt: send the proposal to the client/); assert.match(html, /self-reported/);
  await page.keyboard.press('Escape');
  await go(page, 'dashboard'); await page.waitForSelector('#plPanel .mini-list, #plPanel .empty'); assert.match(await page.innerText('#plPanel'), /1 verified/i);
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

test('the spoken/typed voice path creates the same commitment (with approval); manual add, owed-to-me and cancel-with-reason work', async () => {
  const { page, ctx, errors } = await open('proof3@example.com');
  const r = await H.ask(page, 'remind me to submit the thesis draft by friday');
  assert.match(r, /need your approval before I do this: Create a task/);
  await go(page, 'proofloop'); await page.waitForSelector('.item:has-text("submit the thesis draft")');
  await page.click('button:has-text("Add a commitment")'); await page.fill('#f_title', 'Lab to send me the results'); await page.selectOption('#f_direction', 'owed_to_me'); await page.fill('#f_counterparty', 'Dr Noor'); await page.fill('#f_deadline', '2026-12-01'); await page.click('#dialogSave');
  await page.waitForSelector('#formDialog[open] .why'); await page.keyboard.press('Escape');
  await page.waitForSelector('.item:has-text("Lab to send me the results")'); assert.match(await page.innerText('.item:has-text("Lab to send me")'), /Owed to me[\s\S]*Dr Noor[\s\S]*due 2026-12-01/i);
  await page.click('.item:has-text("Lab to send me") button:has-text("Open")'); await page.waitForSelector('#formDialog[open] .why');
  await page.click('#formDialog button[data-to="cancelled"]'); await page.waitForSelector('#f_note');
  await page.click('#dialogSave'); await page.waitForTimeout(300);                                               // empty reason is refused by the form
  assert.equal(await page.isVisible('#f_note'), true);
  await page.fill('#f_note', 'Not needed any more'); await page.click('#dialogSave');
  await page.waitForSelector('#formDialog .verdict:has-text("Cancelled")'); assert.match(await page.innerText('#formDialog .verdict'), /Not needed any more/);
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

for (const width of [1440, 768, 390]) {
  test('layout at ' + width + ' px: Mission Control with demo data, a commitment dialog and the dashboard panel', async () => {
    const { checkLayout } = require('./layout-check');
    const { page, ctx, errors } = await open('proof4@example.com', { width, height: width === 390 ? 844 : 900 });
    await page.evaluate(() => fetch('/api/demo/load', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nova-csrf': NOVA.csrf }, body: '{}' }));
    const problems = []; const check = async n => (await page.evaluate(checkLayout)).forEach(x => problems.push(n + ': ' + x));
    for (const v of ['proofloop', 'dashboard']) { await go(page, v); await page.waitForTimeout(400); await check(v); await page.screenshot({ path: path.join(__dirname, 'screenshots', width + '-nova-' + v + '-pl.png'), fullPage: true }).catch(() => {}); }
    await go(page, 'proofloop'); await page.click('.item:has-text("updated project proposal") button:has-text("Open")'); await page.waitForSelector('#formDialog[open] .why'); await page.waitForTimeout(300);
    const fits = await page.evaluate(() => { const d = document.getElementById('formDialog').getBoundingClientRect(); return d.right <= innerWidth + 1 && d.left >= -1; }); assert.ok(fits, 'dialog fits');
    assert.equal(await page.evaluate(() => { const w = document.querySelector('#formDialog .why'); return w.scrollWidth <= w.clientWidth + 1; }), true);
    await page.screenshot({ path: path.join(__dirname, 'screenshots', width + '-nova-commitment.png') });
    assert.deepEqual(problems, [], problems.join('\n')); assert.deepEqual(clean(errors), []);
    await ctx.close();
  });
}

test('axe-core on Mission Control, the commitment dialog and the dashboard panel; keyboard-only open and close', async () => {
  const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
  const { page, ctx, errors } = await open('proof5@example.com');
  await page.evaluate(() => fetch('/api/demo/load', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nova-csrf': NOVA.csrf }, body: '{}' }));
  await page.evaluate(src => (0, eval)(src), AXE);
  const scan = async label => { const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })); const bad = res.violations.filter(x => x.impact === 'serious' || x.impact === 'critical').map(x => label + ' ' + x.id + ': ' + x.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')); assert.deepEqual(bad, [], bad.join('\n')); };
  await go(page, 'proofloop'); await scan('mission control'); await go(page, 'dashboard'); await scan('dashboard'); await go(page, 'proofloop');
  await page.focus('.item button:has-text("Open")'); await page.keyboard.press('Enter'); await page.waitForSelector('#formDialog[open] .why'); await page.waitForTimeout(300); await scan('dialog');
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.getElementById('formDialog').open), false);
  assert.deepEqual(clean(errors), []);
  await ctx.close();
});

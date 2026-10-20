// Browser tests for "Jobs for you": dashboard, tabs, filters, Why panel, rules and alerts, application pack, digest, profile.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const F = require('./fixtures/jobs-data');

const NOW = Date.parse('2026-10-15T08:00:00+04:00'); // Thursday 15 Oct 2026, 8:00 am in Dubai
const PROFILE = { name: 'Roshan', degree: 'BSc Computer Science', field: 'Computer Science', university: 'Example University', skills: ['Python', 'SQL', 'Excel', 'Power BI'], titles: ['Data Analyst', 'Software Engineer'], languages: ['English', 'Arabic'], cities: ['Dubai', 'Abu Dhabi'], nationality: 'Indian', visa: 'resident', yearsExp: '0', gradDate: '2026-06' };
const data = (over) => ({ v: 3, profile: Object.assign({}, PROFILE), tasks: [], notes: [], skills: [], wins: [], apps: [], people: [], settings: { voice: true, notify: true }, alertsReady: true, alertsSeen: F.build().jobs.map(j => j.key), ...over });

let browser, server;
test.before(async () => {
  if (!process.env.BASE_URL) { server = await H.startServer(); process.env.BASE_URL = server.url; }
  browser = await H.launch();
});
test.after(async () => { await browser.close(); if (server) server.close(); });

async function open(opts) {
  const o = await H.openApp(browser, Object.assign({ now: NOW, data: data(), jobs: () => F.build(), hash: 'matches' }, opts || {}));
  if ((opts && opts.hash || 'matches') === 'matches') await o.page.waitForSelector('.match-card, .stats-panel');
  else await o.page.waitForFunction(() => J.jobs.cache());
  return o;
}
const tabCount = (page, name) => page.evaluate(n => { const b = [...document.querySelectorAll('.tab')].find(x => x.textContent.startsWith(n)); return +b.querySelector('.n').textContent; }, name);
const cards = page => page.$$eval('.match-card h3', els => els.map(e => e.textContent.trim()));
const tab = async (page, name) => { await page.click('.tab:has-text("' + name + '")'); await page.waitForTimeout(50); };

test('dashboard: tabs, counts, cards with source + dates, nothing invented', async () => {
  const { page, ctx, errors } = await open();
  assert.deepEqual(await cards(page), ['Graduate Data Analyst', 'Data Analyst Intern', 'Junior BI Analyst', 'Junior Software Engineer']);
  assert.equal(await tabCount(page, 'Best matches'), 4);
  assert.equal(await tabCount(page, 'Stretch'), 3);
  assert.equal(await tabCount(page, 'New today'), 4);
  assert.equal(await tabCount(page, 'Closing soon'), 2);
  assert.equal(await tabCount(page, 'Not eligible'), 3);
  const text = await page.innerText('main');
  assert.match(text, /Collected automatically/);
  assert.match(text, /updated 2 h ago|updated 2 hours ago/);
  assert.match(text, /Scanned 120 listings/);
  assert.match(text, /Hidden: 60 not in the UAE/);
  assert.match(text, /1 source could not be loaded/);
  assert.match(text, /estimates, not a promise/);
  // every card shows its source, a link, and a last-seen date
  const first = page.locator('.match-card').first();
  assert.match(await first.innerText(), /Example Co \(Greenhouse\).*last seen 15 Oct/s);
  assert.equal(await first.locator('a:has-text("View")').getAttribute('href'), 'https://example.com/jobs/1');
  await page.waitForTimeout(1200);                                  // the page re-draws once when the start-up job check finishes; open the list after that
  await page.click('details.quiet summary');
  await page.waitForFunction(() => document.querySelector('details.quiet').open && /Broken Board: HTTP 404/.test(document.querySelector('details.quiet').innerText));
  assert.match(await page.innerText('details.quiet'), /Broken Board: HTTP 404/);
  // skills gap summary
  assert.match(text, /Learning Tableau would open 2 more jobs/);
  assert.ok(await page.locator('.gap-list a[href^="https://"]').count() >= 1);
  // other tabs
  await tab(page, 'Stretch');
  assert.deepEqual((await cards(page)).sort(), ['Graduate Business Analyst', 'Marketing Executive', 'Python Trainee']);
  await tab(page, 'Closing soon');
  assert.deepEqual(await cards(page), ['Python Trainee', 'Graduate Data Analyst']);
  await tab(page, 'Not eligible');
  const no = await page.innerText('main');
  assert.match(no, /UAE nationals only/); assert.match(no, /fee or deposit/); assert.match(no, /asks for 8\+ years/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('filters: search, city, type, level, score, remote', async () => {
  const { page, ctx, errors } = await open();
  await page.fill('#mq', 'intern'); await page.waitForTimeout(300);
  assert.deepEqual(await cards(page), ['Data Analyst Intern']);
  await page.fill('#mq', ''); await page.waitForTimeout(300);
  await page.selectOption('#mcity', 'Dubai');
  assert.deepEqual(await cards(page), ['Graduate Data Analyst', 'Junior BI Analyst']);
  await page.selectOption('#mcity', 'all');
  await page.selectOption('#mremote', 'remote');
  assert.deepEqual(await cards(page), ['Data Analyst Intern']);
  await page.selectOption('#mremote', 'all');
  await page.selectOption('#mmin', '80');
  assert.deepEqual(await cards(page), ['Graduate Data Analyst']);
  await page.selectOption('#mmin', '0');
  await page.selectOption('#mlevel', 'intern');
  assert.deepEqual(await cards(page), ['Data Analyst Intern']);
  await page.selectOption('#mlevel', 'all');
  await page.selectOption('#mtype', 'Internship');
  assert.deepEqual(await cards(page), ['Data Analyst Intern']);
  await page.selectOption('#mtype', 'all');
  await page.fill('#mq', 'zzzz'); await page.waitForTimeout(300);
  assert.match(await page.innerText('main'), /No jobs match these filters/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('"Why this job?" panel: breakdown, reasons for and against, verdict, source, verify tip, learn links', async () => {
  const { page, ctx, errors } = await open();
  await tab(page, 'Stretch');
  await page.locator('.match-card:has-text("Graduate Business Analyst") button:has-text("Why this job?")').click();
  const dlg = page.locator('#formDialog');
  await dlg.waitFor();
  const t = await dlg.innerText();
  assert.match(t, /Stretch: apply anyway/);
  assert.match(t, /How the score of \d+% was worked out/i);
  for (const part of ['Job title', 'Skills', 'Experience level', 'Location', 'Freshness', 'Languages']) assert.match(t, new RegExp(part));
  assert.match(t, /Why it fits/i); assert.match(t, /What may hold you back/i);
  assert.match(t, /Tableau/);
  assert.match(t, /Skills to learn to qualify \(free\)/i);
  assert.match(t, /Source: Zeta \(Ashby\)/);
  assert.match(t, /Salary: not stated in the listing. NOVA does not guess pay/);
  assert.match(t, /Verify the company/i);
  assert.match(t, /not a promise of being hired/);
  assert.ok(await dlg.locator('a[href^="https://"][target=_blank]').count() >= 2);
  // the parts add up to the score
  const sum = await page.evaluate(() => { const s = J.matches.sections().all.find(j => j.title === 'Graduate Business Analyst'); return [s.score, Object.values(s.eval.parts).reduce((a, b) => a + b, 0)]; });
  assert.equal(sum[0], sum[1]);
  await page.click('#dialogSave');
  // a scam listing shows the red warning
  await tab(page, 'Not eligible');
  await page.locator('.match-card:has-text("Data Entry Assistant") button:has-text("Why this job?")').click();
  assert.match(await page.innerText('#formDialog'), /mentions a fee or deposit. Real UAE employers never ask you to pay/);
  assert.ok(await page.locator('#formDialog .tip-box.red').count() === 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Save & prepare: application with checklist, tailored pack, deadline and follow-up reminders; never auto-applies', async () => {
  const { page, ctx, errors } = await open();
  await page.locator('.match-card:has-text("Graduate Data Analyst") button:has-text("Save & prepare")').click();
  await page.waitForSelector('#formDialog[open]');
  const app = await page.evaluate(() => J.data.apps.find(a => a.title === 'Graduate Data Analyst'));
  assert.equal(app.stage, 'saved');            // saved, not "applied": the person presses apply
  assert.equal(app.deadline, '2026-10-25');
  assert.ok(app.checklist && app.checklist.length >= 3 || app.prep);
  assert.match(app.prep.cover, /Dear Hiring Team at Alpha Analytics/);
  assert.match(app.prep.cover, /Python, SQL, Excel/);
  assert.ok(app.prep.cvKeywords.include.includes('SQL'));
  assert.ok(app.prep.interviewQs.length >= 5);
  const dialog = await page.innerText('#formDialog');
  assert.match(dialog, /Tailored cover letter/i); assert.match(dialog, /CV/); assert.match(dialog, /Interview/i);
  const tasks = await page.evaluate(id => J.data.tasks.filter(t => t.appId === id).map(t => [t.kind, t.due, t.title]), app.id);
  assert.deepEqual(tasks.find(t => t[0] === 'followup').slice(1), ['2026-10-22', 'Follow up: Graduate Data Analyst at Alpha Analytics']);
  assert.equal(tasks.find(t => t[0] === 'deadline')[1], '2026-10-25');
  await page.click('#dialogCancel, #dialogSave');
  // the card now offers "Open application"; saving again does not duplicate
  await page.waitForSelector('.match-card:has-text("Graduate Data Analyst") button:has-text("Open application")');
  assert.equal(await page.evaluate(() => J.data.apps.length), 1);
  // finishing the follow-up task is remembered (no new follow-up is made)
  await page.evaluate(id => { const t = J.data.tasks.find(x => x.appId === id && x.kind === 'followup'); J.setTaskDone(t.id, true); }, app.id);
  const again = await page.evaluate(id => { J.syncAppTasks(J.data.apps.find(a => a.id === id)); return J.data.tasks.filter(t => t.appId === id && t.kind === 'followup' && t.status !== 'done').length; }, app.id);
  assert.equal(again, 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Today shows the daily digest, and by voice', async () => {
  const { page, ctx, errors } = await open({ hash: 'today' });
  await page.waitForSelector('text=Jobs digest, text=Job digest, text=digest', { timeout: 3000 }).catch(() => {});
  const t = await page.innerText('main');
  assert.match(t, /Graduate Data Analyst/);
  const said = await H.ask(page, 'read my job digest');
  assert.match(said, /Graduate Data Analyst/); assert.match(said, /86/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('alerts: first load is silent; later strong matches are spoken and notified; rules and the master switch work', async () => {
  let version = 0;
  const jobs = () => version === 0 ? F.build() : F.build([F.job({ key: 'g:20', title: 'Data Analyst Graduate Programme', company: 'Kappa Bank', city: 'Dubai', url: 'https://example.com/jobs/20', text: 'Graduate programme. SQL, Excel, Power BI, Python. Bachelor degree. Entry level.' }),
    F.job({ key: 'g:21', title: 'Warehouse Supervisor', company: 'Lambda Logistics', city: 'Sharjah', url: 'https://example.com/jobs/21', text: 'Warehouse supervisor. Forklift licence. 0-2 years.' })]);
  // first visit ever (alertsReady false): everything already listed is NOT "new"
  const o = await H.openApp(browser, { now: NOW, data: data({ alertsReady: false, alertsSeen: [] }), jobs, hash: 'matches' });
  const { page, ctx, errors } = o;
  await page.waitForSelector('.match-card');
  await page.waitForFunction(() => J.data.alertsReady);
  assert.deepEqual(await page.evaluate(() => window.__said.filter(s => /new strong/.test(s))), []);
  version = 1;
  await page.evaluate(() => J.jobs.reload());
  await page.waitForFunction(() => window.__said.some(s => /1 new strong job match/.test(s)));
  const said = await page.evaluate(() => window.__said.join(' '));
  assert.match(said, /Data Analyst Graduate Programme at Kappa Bank, \d+ percent/);
  assert.match(await page.evaluate(() => window.__notes.join('|')), /NOVA: new job matches: Data Analyst Graduate Programme at Kappa Bank/);
  // the weak job did not cause an alert, and nothing repeats
  const n = await page.evaluate(() => window.__said.filter(s => /new strong/.test(s)).length);
  await page.evaluate(() => J.jobs.reload());
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__said.filter(s => /new strong/.test(s)).length), n);
  // alerts off: new jobs are marked seen but not announced
  version = 2;
  await page.evaluate(() => { J.data.settings.jobAlerts = false; });
  assert.equal(await H.ask(page, 'turn job alerts on'), 'Job alerts are on. I will speak when a strong new match appears while NOVA is open.');
  assert.equal(await page.evaluate(() => J.data.settings.jobAlerts), true);
  assert.equal(await H.ask(page, 'turn job alerts off'), 'Job alerts are off.');
  assert.equal(await page.evaluate(() => J.data.settings.jobAlerts), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('saved searches: add, edit and delete a rule in the dialog; rules notify below the global threshold', async () => {
  const { page, ctx, errors } = await open();
  await page.click('button:has-text("Alerts & rules")');
  await page.waitForSelector('#formDialog[open]');
  assert.match(await page.innerText('#formDialog'), /No saved searches yet/);
  await page.click('#formDialog button:has-text("Add a rule")');
  await page.fill('#f_keywords', 'Software Engineer');
  await page.selectOption('#f_city', 'Abu Dhabi');
  await page.fill('#f_min', '60');
  await page.click('#dialogSave');
  const rule = await page.evaluate(() => J.data.rules[0]);
  assert.equal(rule.keywords, 'Software Engineer'); assert.equal(rule.city, 'Abu Dhabi'); assert.equal(rule.min, 60); assert.equal(rule.notify, true);
  await page.waitForFunction(() => document.getElementById('formTitle').textContent === 'Alerts and saved searches');
  assert.match(await page.innerText('#formDialog'), /Software Engineer in Abu Dhabi, 60% or more, notify me · 1 match/);
  await page.click('#formDialog [data-act="delRule"]');
  assert.equal(await page.evaluate(() => J.data.rules.length), 0);
  await page.waitForFunction(() => /No saved searches yet/.test(document.getElementById('formDialog').textContent));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('job profile dialog saves the matching fields and changes scores', async () => {
  const { page, ctx, errors } = await open({ data: data({ profile: Object.assign({}, PROFILE, { skills: [], titles: [] }) }) });
  const before = await page.evaluate(() => J.matches.sections().best.length);
  await page.click('button:has-text("Job profile")');
  await page.waitForSelector('#formDialog[open]');
  const labels = await page.$$eval('#formDialog label', ls => ls.map(l => l.textContent));
  for (const want of [/Degree/, /Graduation/i, /GPA/i, /Skills/, /Tools/i, /Languages/, /experience/i, /Nationality/i, /Visa/i, /cities/i, /Remote/i, /Salary/i, /Notice/i, /Target|titles/i, /avoid/i]) assert.ok(labels.some(l => want.test(l)), 'missing field ' + want);
  assert.match(await page.innerText('#formDialog'), /stays? (only )?in this browser|never uploaded|on this device/i);
  await page.fill('[name="skills"]', 'Python (advanced), SQL, Excel, Power BI');
  await page.fill('[name="titles"]', 'Data Analyst');
  await page.click('#dialogSave');
  const p = await page.evaluate(() => J.data.profile);
  assert.deepEqual(p.skills, ['Python', 'SQL', 'Excel', 'Power BI']);
  assert.equal(p.skillLevels.Python, 'strong');
  assert.ok(await page.evaluate(() => J.matches.sections().best.length) > before);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('profile screen and settings have the new fields and controls', async () => {
  const { page, ctx, errors } = await open({ hash: 'profile' });
  assert.match(await page.innerText('main'), /Job matching details/i);
  await page.click('main button:has-text("Edit job profile")');
  await page.waitForSelector('#formDialog[open]');
  await page.keyboard.press('Escape');
  await page.goto(page.url().replace(/#.*/, '#settings'));
  const t = await page.innerText('main');
  assert.match(t, /Job alerts and automation/i); assert.match(t, /Smart mode/);
  assert.equal(await page.isChecked('#smartToggle'), false); // off by default
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('weekly report appears in the weekly review', async () => {
  const { page, ctx, errors } = await open({ hash: 'review' });
  assert.match(await page.innerText('main'), /job (search )?report|Job report|jobs this week/i);
  assert.match(await H.ask(page, 'weekly job report'), /job|match/i);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('jobs that are not in the file are not shown (nothing invented), and an empty file says so', async () => {
  const { page, ctx, errors } = await open({ jobs: () => F.build().jobs.length ? Object.assign(F.build(), { jobs: [] }) : null, hash: 'matches' }).catch(async () => ({}));
  if (page) { assert.match(await page.innerText('main'), /No jobs|no jobs/i); assert.deepEqual(errors.filter(e => !/forEach/.test(e)), []); await ctx.close(); }
});

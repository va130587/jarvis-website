// Every job voice command, typed (the same command system the microphone uses).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const F = require('./fixtures/jobs-data');

const NOW = Date.parse('2026-10-15T08:00:00+04:00');
const PROFILE = { name: 'Roshan', degree: 'BSc Computer Science', field: 'Computer Science', skills: ['Python', 'SQL', 'Excel', 'Power BI'], titles: ['Data Analyst', 'Software Engineer'], languages: ['English', 'Arabic'], cities: ['Dubai', 'Abu Dhabi'], nationality: 'Indian', visa: 'resident', yearsExp: '0' };
const DATA = { v: 3, profile: PROFILE, tasks: [], notes: [], skills: [], wins: [], apps: [], people: [], settings: { voice: true }, alertsReady: true, alertsSeen: F.build().jobs.map(j => j.key) };

let browser, server, page, ctx, errors;
test.before(async () => {
  if (!process.env.BASE_URL) { server = await H.startServer(); process.env.BASE_URL = server.url; }
  browser = await H.launch();
  ({ page, ctx, errors } = await H.openApp(browser, { now: NOW, data: DATA, jobs: () => F.build(), hash: 'today' }));
  await page.waitForFunction(() => J.jobs.cache());
});
test.after(async () => { await ctx.close(); await browser.close(); if (server) server.close(); });
const ask = t => H.ask(page, t);

test('"What jobs can hire me?" and its other wordings', async () => {
  for (const q of ['What jobs can hire me?', 'Find jobs I can get', 'Show my best matches']) {
    const r = await ask(q);
    assert.match(r, /You can apply for 4 jobs/, q);
    assert.match(r, /1\. Graduate Data Analyst at Alpha Analytics, 86 percent/, q);
    assert.match(r, /3 more jobs are a stretch/, q);
  }
  assert.equal(await page.evaluate(() => J.current()), 'matches');
});

test('"Why did you match this job?" and "What am I missing for this job?"', async () => {
  await ask('What jobs can hire me?');
  const why = await ask('Why did you match this job?');
  assert.match(why, /Graduate Data Analyst at Alpha Analytics scores 86 percent/);
  assert.match(why, /You can apply/);
  assert.match(why, /It fits because/);
  const miss = await ask('What am I missing for this job?');
  assert.match(miss, /Graduate Data Analyst/);
  assert.match(miss, /missing Data analysis|Your skills cover this job/);
  // a stretch job names the gap
  await page.evaluate(() => { J.ctx.job = J.matches.sections().stretch.find(j => j.title === 'Graduate Business Analyst'); });
  assert.match(await ask('What am I missing for this job?'), /missing Tableau/);
});

test('new jobs, read the top three, which to apply to first', async () => {
  const n = await ask('Show new jobs since yesterday');
  assert.match(n, /\d+ new jobs? since yesterday|new/i);
  assert.equal(await page.evaluate(() => J.current()), 'matches');
  const top = await ask('Read the top three');
  assert.match(top, /1\. Graduate Data Analyst.*2\. Data Analyst Intern.*3\. Junior BI Analyst/s);
  const first = await ask('Which job should I apply to first?');
  assert.match(first, /Apply first to Graduate Data Analyst at Alpha Analytics/);
  assert.match(first, /closes on|posted recently|best score/);
  assert.match(first, /prepare an application/);
});

test('"What should I learn to get more jobs?" names a skill, a count, and a free link', async () => {
  const r = await ask('What should I learn to get more jobs?');
  assert.match(r, /Learning Tableau would open 2 more jobs\. A free place to start is/);
});

test('"Set an alert for data analyst jobs in Dubai above 70 percent" asks first, then saves a rule', async () => {
  const q = await ask('Set an alert for data analyst jobs in Dubai above 70 percent');
  assert.match(q, /\?|yes or no/i);
  assert.equal(await page.evaluate(() => J.data.rules.length), 0);      // nothing changed yet
  assert.match(await ask('no'), /left it as it is/);
  assert.equal(await page.evaluate(() => J.data.rules.length), 0);
  await ask('Set an alert for data analyst jobs in Dubai above 70 percent');
  assert.match(await ask('yes'), /Done\. I will tell you when a new matching job appears/);
  const r = await page.evaluate(() => J.data.rules[0]);
  assert.equal(r.city, 'Dubai'); assert.equal(r.min, 70); assert.match(r.keywords, /data analyst/i); assert.equal(r.notify, true);
});

test('alerts on/off, run the search now, when did you last check', async () => {
  assert.match(await ask('Turn job alerts off'), /off/);
  assert.equal(await page.evaluate(() => J.data.settings.jobAlerts), false);
  assert.match(await ask('Turn job alerts on'), /on/);
  assert.equal(await page.evaluate(() => J.data.settings.jobAlerts), true);
  assert.match(await ask('Run the job search now'), /Done\. 10 jobs from 3 sources, collected automatically 2 h ago|Done\. 10 jobs from 3 sources, collected automatically/);
  const last = await ask('When did you last check?');
  assert.match(last, /I last checked .* ago, automatically\. 3 sources worked and 1 could not be reached\. I found 10 jobs\./);
});

test('"Prepare an application for this job" asks first, then saves the pack and reminders', async () => {
  await ask('What jobs can hire me?');
  const q = await ask('Prepare an application for this job');
  assert.match(q, /Prepare an application for Graduate Data Analyst at Alpha Analytics\? .*Say yes or no/);
  assert.equal(await page.evaluate(() => J.data.apps.length), 0);
  assert.match(await ask('no'), /left it as it is/);
  assert.equal(await page.evaluate(() => J.data.apps.length), 0);
  await ask('Prepare an application for this job');
  const done = await ask('yes');
  assert.match(done, /Done\. I saved Graduate Data Analyst at Alpha Analytics with your tailored pack and a follow-up reminder for/);
  assert.match(done, /I never apply for you/);
  const a = await page.evaluate(() => J.data.apps[0]);
  assert.equal(a.stage, 'saved'); assert.ok(a.prep && a.prep.cover);
  assert.match(await ask('Prepare an application for this job'), /already in your applications/);
});

test('digest, weekly report, no-experience jobs, set up my job profile (asks short questions)', async () => {
  assert.match(await ask('read my job digest'), /Graduate Data Analyst/);
  assert.match(await ask('weekly job report'), /job|match/i);
  assert.match(await ask('which jobs can I get without experience'), /need no experience|no jobs that clearly/);
  const first = await ask('set up my job profile');
  assert.match(first, /Let's set up your job profile\. These answers stay on this device\./);
  let q = first, n = 0;
  while (n++ < 30 && !/^(All set|Done|That's|Your job profile)/i.test(q)) { q = await ask('skip'); if (/saved|all set|done/i.test(q)) break; }
  assert.match(q, /saved|all set|done/i);
  // cancel works midway
  await ask('set up my job profile');
  await ask('cancel');
  assert.match(await ask('test voice'), /Voice systems are working/);
  assert.match(await page.evaluate(() => document.body.textContent), /Cancelled\./);
});

test('typed in the chat panel works the same, and nothing crashed', async () => {
  await page.evaluate(() => J.voice.run('what jobs can hire me'));
  await page.waitForFunction(() => /You can apply for/.test(document.getElementById('chatLog') ? document.getElementById('chatLog').textContent : document.body.textContent));
  assert.deepEqual(errors, []);
});

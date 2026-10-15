// The job collector: normalising, filtering, de-duplicating, expiring, failed sources, alerts, the workflow file.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../scripts/collect-jobs.js');

const ROOT = path.join(__dirname, '..');
const NOW = new Date('2026-10-15T06:00:00Z'); // 10:00 in Dubai, a Thursday

/* ---------- fixtures shaped like the real API answers ---------- */
const GH = { jobs: [
  { id: 1, title: 'Graduate Data Analyst', absolute_url: 'https://boards.greenhouse.io/careem/jobs/1', location: { name: 'Dubai, United Arab Emirates' }, first_published: '2026-10-13T10:00:00Z', updated_at: '2026-10-14T10:00:00Z', departments: [{ name: 'Data' }], content: '&lt;p&gt;Use SQL and Python.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Fresh graduates welcome&lt;/li&gt;&lt;/ul&gt;' },
  { id: 2, title: 'Senior Data Engineer', absolute_url: 'https://boards.greenhouse.io/careem/jobs/2', location: { name: 'Dubai' }, first_published: '2026-10-10T10:00:00Z', content: '5+ years of experience' },
  { id: 3, title: 'Software Engineering Intern', absolute_url: 'https://boards.greenhouse.io/careem/jobs/3', location: { name: 'Abu Dhabi, UAE' }, first_published: '2026-10-12T10:00:00Z', content: 'JavaScript and Git' },
  { id: 4, title: 'Junior Python Developer', absolute_url: 'https://boards.greenhouse.io/careem/jobs/4', location: { name: 'Berlin, Germany' }, first_published: '2026-10-12T10:00:00Z', content: 'Python' },
  { id: 5, title: 'Marketing Associate', absolute_url: 'https://boards.greenhouse.io/careem/jobs/5', location: { name: 'Dubai' }, first_published: '2026-10-12T10:00:00Z', content: 'You have at least 6 years of experience in brand marketing.' },
  { id: 6, title: 'Operations Analyst', absolute_url: 'https://boards.greenhouse.io/careem/jobs/6', location: { name: 'Dubai' }, first_published: '2026-10-11T10:00:00Z', content: 'No experience required. We train you.' },
  { id: 7, title: 'Data Entry Trainee', absolute_url: 'https://boards.greenhouse.io/careem/jobs/7', location: { name: 'Dubai' }, first_published: '2026-10-11T10:00:00Z', content: 'A registration fee of AED 300 applies.' },
  { id: 8, title: 'Finance Intern', absolute_url: 'https://boards.greenhouse.io/careem/jobs/8', location: { name: 'Dubai' }, first_published: '2026-08-01T10:00:00Z', content: 'Excel' },
  { id: 9, title: 'Account Executive', absolute_url: 'https://boards.greenhouse.io/careem/jobs/9', location: { name: 'Dubai' }, first_published: '2026-10-11T10:00:00Z', content: 'Sell our product.' },
  { id: 10, title: 'Graduate Data Analyst', absolute_url: 'https://boards.greenhouse.io/careem/jobs/10', location: { name: 'Dubai' }, first_published: '2026-10-12T10:00:00Z', content: 'Same job posted twice. SQL.' },
  { id: 11, title: 'Software Engineering Intern', absolute_url: 'https://boards.greenhouse.io/careem/jobs/11', location: { name: 'Remote - EMEA' }, first_published: '2026-10-12T10:00:00Z', content: 'JavaScript' },
  { id: 12, title: 'Intern', absolute_url: 'http://insecure.example/12', location: { name: 'Dubai' }, first_published: '2026-10-12T10:00:00Z', content: 'Link is not https, so it is not trusted.' }
] };
const LEVER = [
  { id: 'a1', text: 'Trainee Customer Support', hostedUrl: 'https://jobs.lever.co/binance/a1', categories: { location: 'Dubai', commitment: 'Full-time', team: 'Support' }, createdAt: Date.parse('2026-10-10T00:00:00Z'), descriptionPlain: 'Fresh graduates welcome. Arabic is required.' },
  { id: 'a2', text: 'Junior SQL Analyst', hostedUrl: 'https://jobs.lever.co/binance/a2', categories: { location: 'Remote - US' }, workplaceType: 'remote', createdAt: Date.parse('2026-10-11T00:00:00Z'), descriptionPlain: 'SQL.' },
  { id: 'a3', text: 'Junior Analyst', hostedUrl: 'https://jobs.lever.co/binance/a3', categories: { location: 'Dubai', allLocations: ['Dubai', 'London'] }, createdAt: Date.parse('2026-10-11T00:00:00Z'), descriptionPlain: 'Excel and SQL.', salaryRange: { currency: 'AED', min: 8000, max: 10000, interval: 'per-month-salary' } },
  { id: 'a4', text: 'Graduate Analyst', hostedUrl: 'https://jobs.lever.co/binance/a4', categories: { location: 'Abu Dhabi' }, createdAt: Date.parse('2026-10-12T00:00:00Z'), descriptionPlain: 'This role is open to UAE nationals only.' }
];
const ASHBY = { jobs: [
  { id: 'z1', title: 'Associate Software Engineer', location: 'Dubai', employmentType: 'FullTime', publishedAt: '2026-10-09T00:00:00Z', jobUrl: 'https://jobs.ashbyhq.com/deel/z1', isRemote: false, descriptionPlain: 'JavaScript, Python. 0-2 years.' },
  { id: 'z2', title: 'Staff Engineer', location: 'Remote - Worldwide', employmentType: 'FullTime', publishedAt: '2026-10-09T00:00:00Z', jobUrl: 'https://jobs.ashbyhq.com/deel/z2', isRemote: true, descriptionPlain: 'Lead teams.' },
  { id: 'z3', title: 'Graduate Programme', location: 'Remote - EMEA', employmentType: 'FullTime', publishedAt: '2026-10-08T00:00:00Z', jobUrl: 'https://jobs.ashbyhq.com/deel/z3', isRemote: true, descriptionPlain: 'Start your career.', compensation: { compensationTierSummary: 'AED 9,000 - 11,000' } }
] };
const REMOTIVE = { jobs: [
  { id: 901, url: 'https://remotive.com/remote-jobs/data/junior-data-analyst-901', title: 'Junior Data Analyst', company_name: 'Globex', category: 'Data', job_type: 'full_time', publication_date: '2026-10-14T08:00:00', candidate_required_location: 'Worldwide', salary: '', description: '<p>Entry level. SQL.</p>' },
  { id: 902, url: 'https://remotive.com/remote-jobs/support/support-intern-902', title: 'Customer Support Intern', company_name: 'Initech', category: 'Support', job_type: 'internship', publication_date: '2026-10-14T08:00:00', candidate_required_location: 'USA Only', description: 'Help customers.' }
] };

const SOURCES = { sources: [
  { id: 'greenhouse:careem', type: 'greenhouse', slug: 'careem', name: 'Careem', enabled: true },
  { id: 'lever:binance', type: 'lever', slug: 'binance', name: 'Binance', enabled: true },
  { id: 'ashby:deel', type: 'ashby', slug: 'deel', name: 'Deel', enabled: true },
  { id: 'remotive:all', type: 'remotive', slug: 'all', name: 'Remotive', enabled: true, everyHours: 24 },
  { id: 'greenhouse:nosuchco', type: 'greenhouse', slug: 'nosuchco', name: 'No Such Co', enabled: true },
  { id: 'lever:slowco', type: 'lever', slug: 'slowco', name: 'Slow Co', enabled: true },
  { id: 'ashby:off', type: 'ashby', slug: 'off', name: 'Turned off', enabled: false }
] };

function setup(sources) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-collect-'));
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify(sources || SOURCES));
  return dir;
}
function fakeFetch(map, calls) {
  return async url => {
    calls && calls.push(url);
    for (const k of Object.keys(map)) if (url.includes(k)) {
      const v = map[k];
      if (v instanceof Error) throw v;
      return { data: JSON.parse(JSON.stringify(v)), http: 200 };
    }
    throw Object.assign(new Error('Board not found (HTTP 404)'), { http: 404 });
  };
}
const responses = () => ({ '/boards/careem/': GH, 'postings/binance': LEVER, 'job-board/deel': ASHBY, 'remotive.com': REMOTIVE, 'postings/slowco': Object.assign(new Error('Timed out'), { http: 0 }) });
const run = (dir, o) => C.runCollect(Object.assign({ dataDir: dir, now: NOW, delay: 0, env: {} }, o));
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f || 'jobs.json'), 'utf8'));

test('html from Greenhouse is turned into plain text', () => {
  assert.equal(C.htmlToText('&lt;p&gt;Use SQL &amp;amp; Python.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Fresh graduates&lt;/li&gt;&lt;li&gt;Team player&lt;/li&gt;&lt;/ul&gt;'), 'Use SQL & Python.\n• Fresh graduates\n• Team player');
  assert.equal(C.htmlToText('<script>alert(1)</script><p>Hello<br>world &nbsp;&#39;x&#39;</p>'), "Hello\nworld 'x'");
  assert.equal(C.htmlToText(null), '');
});

test('endpoints for each kind of source', () => {
  assert.equal(C.endpoint({ type: 'greenhouse', slug: 'careem' }), 'https://boards-api.greenhouse.io/v1/boards/careem/jobs?content=true');
  assert.equal(C.endpoint({ type: 'greenhouse-eu', slug: 'huspy' }), 'https://boards-api.eu.greenhouse.io/v1/boards/huspy/jobs?content=true');
  assert.equal(C.endpoint({ type: 'lever', slug: 'binance' }), 'https://api.lever.co/v0/postings/binance?mode=json');
  assert.equal(C.endpoint({ type: 'ashby', slug: 'deel' }), 'https://api.ashbyhq.com/posting-api/job-board/deel?includeCompensation=true');
  assert.equal(C.endpoint({ type: 'remotive', slug: 'all' }), 'https://remotive.com/api/remote-jobs');
});

test('first run: normalises, filters, de-duplicates and reports every source', async () => {
  const dir = setup(), calls = [];
  const r = await run(dir, { fetchJson: fakeFetch(responses(), calls) });
  assert.equal(r.wrote, true);
  const out = read(dir);
  const titles = out.jobs.map(j => j.company + ': ' + j.title).sort();
  assert.deepEqual(titles, [
    'Binance: Graduate Analyst', 'Binance: Junior Analyst', 'Binance: Trainee Customer Support',
    'Careem: Graduate Data Analyst', 'Careem: Operations Analyst', 'Careem: Software Engineering Intern', 'Careem: Software Engineering Intern',
    'Deel: Associate Software Engineer', 'Deel: Graduate Programme', 'Globex: Junior Data Analyst'
  ]);
  assert.deepEqual(out.stats.hidden, { 'not-uae': 3, 'not-fresher': 1, senior: 3, scam: 1, old: 1, duplicate: 1 }, 'why jobs were hidden');
  assert.equal(out.stats.scanned, 12 + 4 + 3 + 2);
  assert.equal(out.stats.kept, 10);
  assert.equal(out.stats.newCount, 10);
  // Details of normalisation
  const gda = out.jobs.find(j => j.key === 'greenhouse:careem:1');
  assert.deepEqual([gda.city, gda.level, gda.date, gda.dept, gda.source, gda.sourceName, gda.firstSeen, gda.lastSeen], ['Dubai', 'graduate', '2026-10-13', 'Data', 'greenhouse:careem', 'Greenhouse', '2026-10-15', '2026-10-15']);
  assert.equal(gda.text, 'Use SQL and Python.\n• Fresh graduates welcome');
  assert.equal(out.jobs.find(j => j.key === 'greenhouse:careem:11').city, 'Remote');
  assert.equal(out.jobs.find(j => j.key === 'greenhouse:careem:11').remote, true);
  assert.equal(out.jobs.find(j => j.key === 'lever:binance:a3').salary, 'AED 8000–10000 per month');
  assert.equal(out.jobs.find(j => j.key === 'lever:binance:a3').location, 'Dubai / Dubai / London');
  assert.equal(out.jobs.find(j => j.key === 'ashby:deel:z3').salary, 'AED 9,000 - 11,000');
  assert.equal(out.jobs.find(j => j.key === 'ashby:deel:z1').type, 'Full time');
  assert.equal(out.jobs.find(j => j.key === 'remotive:all:901').sourceName, 'Remotive');
  assert.ok(out.jobs.every(j => /^https:\/\//.test(j.url)), 'only https links are kept');
  assert.ok(!out.jobs.some(j => j.key.endsWith(':12')), 'an http link is rejected');
  assert.ok(!out.jobs.some(j => /Registration fee/i.test(j.text)), 'scams are dropped');
  // Sources
  const st = Object.fromEntries(out.sources.map(s => [s.id, s]));
  assert.deepEqual([st['greenhouse:careem'].status, st['greenhouse:careem'].listed, st['greenhouse:careem'].kept], ['ok', 12, 5]);
  assert.equal(st['greenhouse:nosuchco'].status, 'failed');
  assert.match(st['greenhouse:nosuchco'].error, /404/);
  assert.equal(st['lever:slowco'].error, 'Timed out');
  assert.equal(st['ashby:off'].status, 'off');
  assert.equal(calls.filter(u => u.includes('/off')).length, 0, 'a source that is turned off is never fetched');
  // Files
  const md = fs.readFileSync(path.join(dir, 'SOURCES.md'), 'utf8');
  assert.match(md, /\| Careem \| greenhouse \| `careem` \| 2026-10-15 06:00 UTC \| ✅ works \| 12 \| 5 \|/);
  assert.match(md, /\| No Such Co \| greenhouse \| `nosuchco` \|.*❌ Board not found/);
  assert.match(md, /\| Turned off .*turned off/);
  assert.match(md, /5 of 7 sources work|4 of 7 sources work/);
});

test('second run: removed and old jobs are archived, first-seen dates stay, failed sources keep their jobs', async () => {
  const dir = setup();
  await run(dir, { fetchJson: fakeFetch(responses()) });
  // Four days later: Careem removed the intern job; Binance is down; one Deel job became too old.
  const gh2 = JSON.parse(JSON.stringify(GH)); gh2.jobs = gh2.jobs.filter(j => j.id !== 3);
  const later = new Date('2026-10-19T06:00:00Z');
  const map = Object.assign(responses(), { '/boards/careem/': gh2, 'postings/binance': Object.assign(new Error('HTTP 503'), { http: 503 }) });
  const r = await run(dir, { fetchJson: fakeFetch(map), now: later });
  const out = r.out;
  const keys = out.jobs.map(j => j.key);
  assert.ok(!keys.includes('greenhouse:careem:3'), 'job taken down by the company is gone from the live list');
  assert.deepEqual(out.archived.filter(a => a.key === 'greenhouse:careem:3').map(a => [a.reason, a.archivedAt, a.firstSeen]), [['removed', '2026-10-19', '2026-10-15']]);
  assert.ok(keys.includes('lever:binance:a1') && keys.includes('lever:binance:a3'), 'jobs of an unreachable source are kept, not deleted');
  assert.equal(out.jobs.find(j => j.key === 'lever:binance:a1').lastSeen, '2026-10-15', 'but their last-seen date does not move');
  assert.equal(out.jobs.find(j => j.key === 'greenhouse:careem:1').firstSeen, '2026-10-15');
  assert.equal(out.jobs.find(j => j.key === 'greenhouse:careem:1').lastSeen, '2026-10-19');
  assert.equal(out.stats.newCount, 0);
  assert.equal(out.sources.find(s => s.id === 'lever:binance').failStreak, 0, 'a 503 is the service being down, not the board\'s fault');
  // Nothing is ever lost: expired jobs stay in the archive for 90 days, then are forgotten.
  const much = new Date('2027-02-01T06:00:00Z');
  const r3 = await run(dir, { fetchJson: fakeFetch(responses()), now: much });
  assert.ok(!r3.out.archived.some(a => a.key === 'greenhouse:careem:3'), 'archive is pruned after 90 days');
});

test('jobs older than 45 days expire into the archive (still listed by the company, but stale)', async () => {
  const dir = setup({ sources: [{ id: 'ashby:deel', type: 'ashby', slug: 'deel', name: 'Deel' }] });
  const r1 = await run(dir, { fetchJson: fakeFetch(responses()) });
  assert.ok(r1.out.jobs.some(j => j.key === 'ashby:deel:z1'));
  const r2 = await run(dir, { fetchJson: fakeFetch(responses()), now: new Date('2026-12-05T06:00:00Z') });
  assert.deepEqual(r2.out.jobs.map(j => j.key), []);
  assert.deepEqual(r2.out.archived.map(a => [a.key, a.reason]).sort(), [['ashby:deel:z1', 'old'], ['ashby:deel:z3', 'old']]);
  assert.equal(r2.out.stats.hidden.old, 2);
});

test('nothing is overwritten when no source can be reached', async () => {
  const dir = setup();
  await run(dir, { fetchJson: fakeFetch(responses()) });
  const before = fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8');
  const down = async () => { throw Object.assign(new Error('fetch failed'), { http: 0 }); };
  const r = await run(dir, { fetchJson: down, now: new Date('2026-10-16T06:00:00Z') });
  assert.equal(r.wrote, false);
  assert.match(r.reason, /No source could be reached/);
  assert.equal(r.out, null);
  assert.equal(fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8'), before, 'file untouched');
});

test('a network outage stops the run early instead of grinding through every source', async () => {
  const dir = setup(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sources.json'), 'utf8')));
  let tries = 0;
  const r = await run(dir, { fetchJson: async () => { tries++; throw Object.assign(new Error('fetch failed'), { http: 0 }); } });
  assert.equal(r.wrote, false);
  assert.equal(tries, 6, 'gave up after 6 failures in a row');
  assert.ok(r.statuses.filter(s => /network looked down/.test(s.error)).length > 40);
  assert.ok(r.statuses.every(s => s.failStreak === 0), 'a network problem does not count against the board');
});

test('unchanged results are not rewritten (no noisy commits), until a day has passed', async () => {
  const dir = setup({ sources: SOURCES.sources.filter(s => !/nosuchco|slowco/.test(s.id)) });
  await run(dir, { fetchJson: fakeFetch(responses()) });
  const f = path.join(dir, 'jobs.json'), t0 = fs.statSync(f).mtimeMs;
  await new Promise(r => setTimeout(r, 30));
  const r = await run(dir, { fetchJson: fakeFetch(responses()), now: new Date('2026-10-15T12:00:00Z') });
  assert.equal(r.wrote, false);
  assert.equal(fs.statSync(f).mtimeMs, t0);
  const r2 = await run(dir, { fetchJson: fakeFetch(responses()), now: new Date('2026-10-16T08:00:00Z') });
  assert.equal(r2.wrote, true, 'refreshed after 24 hours so the site can say "updated today"');
});

test('a source that keeps failing is skipped, then retried on Mondays; --all retries everything', async () => {
  const dir = setup();
  let day = new Date('2026-10-13T06:00:00Z'); // a Tuesday
  const calls = [];
  for (let i = 0; i < 5; i++) { await run(dir, { fetchJson: fakeFetch(responses(), calls), now: new Date(day.getTime() + i * 6 * 3600e3) }); }
  const nos = u => u.includes('nosuchco');
  assert.equal(calls.filter(nos).length, 4, 'tried 4 times, then skipped');
  const st = read(dir).sources.find(s => s.id === 'greenhouse:nosuchco');
  assert.deepEqual([st.status, st.failStreak], ['failed', 4]);
  await run(dir, { fetchJson: fakeFetch(responses(), calls), now: new Date('2026-10-19T06:00:00Z') }); // Monday
  assert.equal(calls.filter(nos).length, 5, 'retried on Monday');
  await run(dir, { fetchJson: fakeFetch(responses(), calls), now: new Date('2026-10-21T06:00:00Z'), all: true });
  assert.equal(calls.filter(nos).length, 6, '--all retries it');
});

test('sources with "everyHours" (Remotive allows only a few requests a day) are not fetched too often', async () => {
  const dir = setup(), calls = [];
  await run(dir, { fetchJson: fakeFetch(responses(), calls) });
  const n = () => calls.filter(u => u.includes('remotive')).length;
  assert.equal(n(), 1);
  const r = await run(dir, { fetchJson: fakeFetch(responses(), calls), now: new Date('2026-10-15T12:00:00Z') });
  assert.equal(n(), 1, 'not fetched again 6 hours later');
  assert.ok(r.out.jobs.some(j => j.source === 'remotive:all'), 'its jobs are kept');
  assert.equal(r.out.sources.find(s => s.id === 'remotive:all').status, 'skipped');
  await run(dir, { fetchJson: fakeFetch(responses(), calls), now: new Date('2026-10-16T08:00:00Z') });
  assert.equal(n(), 2, 'fetched again after a day');
});

test('an unexpected answer is reported, not trusted', async () => {
  const dir = setup({ sources: [{ id: 'greenhouse:x', type: 'greenhouse', slug: 'x', name: 'X' }, { id: 'ashby:deel', type: 'ashby', slug: 'deel', name: 'Deel' }] });
  const r = await run(dir, { fetchJson: fakeFetch({ '/boards/x/': { oops: true }, 'job-board/deel': ASHBY }) });
  assert.equal(r.out.sources[0].status, 'failed');
  assert.match(r.out.sources[0].error, /Unexpected response/);
});

test('phone alert: only new, eligible, strong matches; the message is built correctly', async () => {
  const dir = setup(), posts = [];
  const env = { NTFY_TOPIC: 'secret-topic-9f3a', ALERT_TITLES: 'Data Analyst, Software Engineer', ALERT_SKILLS: 'Python (strong), SQL, JavaScript', ALERT_CITIES: 'Dubai, Abu Dhabi', ALERT_MIN_SCORE: '70', ALERT_VISA: 'resident', SITE_URL: 'https://va130587.github.io/jarvis-website/' };
  const r = await run(dir, { fetchJson: fakeFetch(responses()), env, post: async (u, b) => posts.push([u, b]) });
  assert.equal(posts.length, 1);
  const [url, body] = posts[0];
  assert.equal(url, 'https://ntfy.sh/');
  assert.equal(body.topic, 'secret-topic-9f3a');
  assert.match(body.title, /^Jarvis: \d+ new job matches?$/);
  assert.match(body.message, /^• \d+%  Graduate Data Analyst at Careem \(Dubai\)/m);
  assert.ok(!/Graduate Analyst at Binance/.test(body.message), 'a UAE-nationals-only job is not sent to a non-national');
  assert.match(body.click, /^https:\/\//);
  assert.deepEqual(body.actions, [{ action: 'view', label: 'Open Jarvis', url: 'https://va130587.github.io/jarvis-website/#matches' }]);
  assert.ok(r.strongCount >= 2);
  // The topic is never written to any file.
  for (const f of fs.readdirSync(dir)) assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes('secret-topic-9f3a'), f + ' must not contain the topic');
  // A second run has nothing new, so nothing is sent.
  posts.length = 0;
  await run(dir, { fetchJson: fakeFetch(responses()), env, post: async (u, b) => posts.push([u, b]), now: new Date('2026-10-15T12:00:00Z') });
  assert.equal(posts.length, 0, 'no repeat alerts');
  // No topic: nothing is sent.
  const dir2 = setup();
  await run(dir2, { fetchJson: fakeFetch(responses()), env: Object.assign({}, env, { NTFY_TOPIC: '' }), post: async (u, b) => posts.push([u, b]) });
  assert.equal(posts.length, 0);
  // A failing alert never breaks the run
  const dir3 = setup();
  const ok = await run(dir3, { fetchJson: fakeFetch(responses()), env, post: async () => { throw new Error('ntfy answered HTTP 500'); } });
  assert.equal(ok.wrote, true);
});

test('ntfy message: top five, "and N more", no message when empty', () => {
  const mk = i => ({ job: { title: 'Role ' + i, company: 'Co', city: 'Dubai', url: 'https://x.example/' + i }, score: 90 - i });
  const m = C.buildNtfy({ topic: 't', jobs: [1, 2, 3, 4, 5, 6, 7].map(mk), server: 'https://ntfy.example.org/' });
  assert.equal(m.url, 'https://ntfy.example.org/');
  assert.equal(m.body.message.split('\n').length, 6);
  assert.match(m.body.message, /…and 2 more$/);
  assert.equal(m.body.title, 'Jarvis: 7 new job matches');
  assert.equal(C.buildNtfy({ topic: 't', jobs: [mk(1)] }).body.title, 'Jarvis: 1 new job match');
  assert.equal(C.buildNtfy({ topic: '', jobs: [mk(1)] }), null);
  assert.equal(C.buildNtfy({ topic: 't', jobs: [] }), null);
});

test('data/sources.json: at least 50 candidate sources, valid and unique', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sources.json'), 'utf8'));
  assert.ok(cfg.sources.length >= 50, cfg.sources.length + ' sources');
  const ids = new Set();
  for (const s of cfg.sources) {
    assert.ok(['greenhouse', 'greenhouse-eu', 'lever', 'ashby', 'remotive'].includes(s.type), s.id);
    assert.match(s.slug, /^[a-z0-9._-]+$/i, s.id);
    assert.equal(s.id, s.type + ':' + s.slug);
    assert.ok(s.name && !ids.has(s.id), 'unique ' + s.id);
    ids.add(s.id);
    assert.match(C.endpoint(s), /^https:\/\/(boards-api(\.eu)?\.greenhouse\.io|api\.lever\.co|api\.ashbyhq\.com|remotive\.com)\//);
  }
  assert.ok(cfg.sources.filter(s => s.type === 'greenhouse').length >= 10 && cfg.sources.some(s => s.type === 'lever') && cfg.sources.some(s => s.type === 'ashby') && cfg.sources.some(s => s.type === 'greenhouse-eu'));
});

test('the committed starting files are valid', () => {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'jobs.json'), 'utf8'));
  assert.equal(j.schema, 1);
  assert.ok(Array.isArray(j.jobs) && Array.isArray(j.archived) && Array.isArray(j.sources));
  assert.match(fs.readFileSync(path.join(ROOT, 'data', 'SOURCES.md'), 'utf8'), /^# Job sources/);
});

test('GitHub Action workflow is valid, runs every 6 hours, and keeps secrets out of files', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'collect-jobs.yml'), 'utf8');
  assert.ok(!/\t/.test(y), 'no tab characters in YAML');
  assert.match(y, /^name: Collect jobs$/m);
  const cron = y.match(/- cron: '([^']+)'/);
  assert.ok(cron, 'has a schedule');
  const f = cron[1].split(' ');
  assert.equal(f.length, 5, 'cron has 5 fields');
  assert.match(f[1], /^\*\/6$/, 'every 6 hours');
  assert.match(f[0], /^\d{1,2}$/, 'a fixed minute (not :00, which is busy)');
  assert.match(y, /^\s+workflow_dispatch:/m, 'can be run by hand');
  assert.match(y, /^permissions:\n\s+contents: write/m);
  assert.match(y, /uses: actions\/checkout@v4/);
  assert.match(y, /uses: actions\/setup-node@v4/);
  assert.match(y, /run: node scripts\/collect-jobs\.js/);
  assert.match(y, /NTFY_TOPIC: \$\{\{ secrets\.NTFY_TOPIC \|\| vars\.NTFY_TOPIC \}\}/, 'topic comes from secrets or variables');
  assert.ok(!/ntfy\.sh\/[a-z0-9_-]{4,}/i.test(y), 'no literal topic in the workflow');
  assert.ok(!/(api[_-]?key|token|password)\s*[:=]\s*['"]?[A-Za-z0-9]{12,}/i.test(y), 'no hard-coded secrets');
  assert.match(y, /git add data\/jobs\.json data\/SOURCES\.md data\/links-status\.json/);
  assert.match(y, /\[skip ci\]/);
  // Structure check with a real YAML parser when one is available.
  const { spawnSync } = require('child_process');
  const py = spawnSync('python3', ['-c', 'import sys,yaml;d=yaml.safe_load(open(sys.argv[1]));assert "jobs" in d and ("on" in d or True);print("yaml ok", list(d["jobs"]))', path.join(ROOT, '.github', 'workflows', 'collect-jobs.yml')], { encoding: 'utf8' });
  if (py.status === 0) assert.match(py.stdout, /yaml ok \['collect'\]/); else if (!/No module named/.test(py.stderr)) assert.fail('YAML did not parse: ' + py.stderr);
});

test('no secret or personal profile is committed in data files, scripts or workflow', () => {
  const files = ['data/jobs.json', 'data/sources.json', 'data/SOURCES.md', 'scripts/collect-jobs.js', 'scripts/check-links.js', '.github/workflows/collect-jobs.yml'];
  for (const f of files) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/roshan|va130587@gmail/i.test(t.replace(/va130587\.github\.io\/jarvis-website/g, '')), f + ' has no personal details');
  }
});

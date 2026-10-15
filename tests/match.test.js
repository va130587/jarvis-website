// Unit tests for the matching engine (match.js): eligibility, visa and nationality phrases, years of
// experience, skill aliases and scam detection, with expected verdicts, score ranges and reasons.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../match.js');

const TODAY = '2026-10-15';
const ROSHAN = {
  titles: ['Data Analyst', 'Software Engineer'], field: 'Computer Science', degree: 'BSc Computer Science',
  skills: ['Python', 'SQL', 'JavaScript', 'Excel', 'Data analysis', 'Communication'], skillLevels: { Python: 'strong', SQL: 'working', JavaScript: 'working', Excel: 'working', 'Data analysis': 'working', Communication: 'working' },
  languages: ['English', 'Hindi', 'Arabic (basic)'], yearsExp: 0, visa: 'resident', nationality: 'Indian', cities: ['Dubai', 'Abu Dhabi'], remote: 'open'
};
const job = (o) => Object.assign({ title: '', text: '', company: 'Acme', city: 'Dubai', level: '', date: '2026-10-13', remote: false }, o);
const ev = (j, p) => M.evaluate(job(j), Object.assign({}, ROSHAN, p || {}), { today: TODAY });

// [name, job, profile overrides, expected]
// expected: verdict, min / max score, reason / gap / blocker text patterns that must be present.
const CASES = [
  ['perfect graduate analyst role', { title: 'Graduate Data Analyst', level: 'graduate', text: 'Use SQL, Python and Excel to build dashboards. Fresh graduates welcome.' }, {}, { verdict: 'apply', min: 85, reason: /title matches your target role "Data Analyst"/, reason2: /You have 4 of the 4 skills it mentions/ }],
  ['software intern with your skills', { title: 'Software Engineering Intern', level: 'intern', text: 'Work with JavaScript, Python and Git on our web platform.' }, {}, { verdict: 'apply', min: 70, reason: /an internship/ }],
  ['junior developer, 0-2 years', { title: 'Junior Developer', level: 'junior', text: 'JavaScript and SQL. 0-2 years of experience.' }, {}, { verdict: 'apply', min: 70, reason: /entry-level|experience asked for/ }],
  ['senior role is not eligible', { title: 'Senior Data Analyst', text: 'Minimum of 5 years experience with SQL, Python and Tableau.' }, {}, { verdict: 'no', blocker: /5\+ years/ }],
  ['3+ years is not eligible for a fresher', { title: 'Data Analyst', text: 'We need 3+ years of experience in analytics.' }, {}, { verdict: 'no', blocker: /3\+ years/ }],
  ['2 years is a stretch', { title: 'Data Analyst', text: 'Requires 2 years of experience using SQL and Python.' }, {}, { verdict: 'stretch', gap: /2\+ years|2 years/ }],
  ['1-3 years is a stretch', { title: 'Software Engineer', text: '1-3 years of experience. JavaScript, Python.' }, {}, { verdict: 'stretch', gap: /1–3 years/ }],
  ['two years written in words', { title: 'Data Analyst', text: 'At least two years of relevant experience with SQL.' }, {}, { verdict: 'stretch', gap: /2\+ years/ }],
  ['no experience required', { title: 'Data Analyst Trainee', level: 'trainee', text: 'No experience required. We will train you in SQL and Excel.' }, {}, { verdict: 'apply', min: 75 }],
  ['UAE nationals only', { title: 'Graduate Data Analyst', level: 'graduate', text: 'This opportunity is open to UAE nationals only. SQL, Python.' }, {}, { verdict: 'no', blocker: /UAE nationals only/ }],
  ['Emiratis only', { title: 'Graduate Engineer', level: 'graduate', text: 'Emiratis only. Join our graduate programme.' }, {}, { verdict: 'no', blocker: /UAE nationals only/ }],
  ['Emiratisation programme', { title: 'Management Trainee', level: 'trainee', text: 'Our Emiratisation programme for fresh graduates.' }, {}, { verdict: 'no', blocker: /UAE nationals only/ }],
  ['UAE nationals preferred is not a block', { title: 'Graduate Data Analyst', level: 'graduate', text: 'UAE nationals are preferred. SQL and Python required.' }, {}, { verdict: 'apply' }],
  ['UAE national applicant sees nationals-only roles', { title: 'Graduate Data Analyst', level: 'graduate', text: 'Open to UAE nationals only. SQL and Python.' }, { visa: 'national', nationality: 'Emirati' }, { verdict: 'apply', reason: /open to UAE nationals, which you are/ }],
  ['visit visa and residence required', { title: 'Data Analyst', level: 'junior', text: 'Must be based in the UAE with a valid UAE residence visa. SQL.' }, { visa: 'visit' }, { verdict: 'no', blocker: /visit visa/ }],
  ['needs sponsorship, no sponsorship offered', { title: 'Junior Data Analyst', level: 'junior', text: 'We do not offer visa sponsorship. SQL and Python.' }, { visa: 'needs-sponsorship' }, { verdict: 'no', blocker: /sponsorship is not available/ }],
  ['needs sponsorship, employer sponsors', { title: 'Graduate Data Analyst', level: 'graduate', text: 'Visa sponsorship and relocation support provided. SQL, Python.' }, { visa: 'needs-sponsorship' }, { verdict: 'apply', reason: /visa support/ }],
  ['resident, residence required is fine', { title: 'Junior Data Analyst', level: 'junior', text: 'Applicants must currently be based in Dubai. SQL, Excel.' }, {}, { verdict: 'apply', reason: /residence, which you have/ }],
  ['masters required is a stretch', { title: 'Data Analyst', level: 'junior', text: "Master's degree required. SQL, Python. Fresh graduates welcome." }, {}, { verdict: 'stretch', gap: /master/ }],
  ['PhD asked for', { title: 'Data Scientist', text: 'A PhD is required. Python, machine learning.' }, {}, { verdict: 'stretch', gap: /PhD/ }],
  ['bachelor degree asked, you have one', { title: 'Graduate Software Engineer', level: 'graduate', text: 'Bachelor degree in computer science. JavaScript.' }, {}, { verdict: 'apply', reason: /degree, which you have/ }],
  ['Arabic fluent required, you are basic', { title: 'Customer Support Graduate', level: 'graduate', text: 'Fluent Arabic is required. Excel and communication skills.' }, {}, { verdict: 'stretch', gap: /Arabic is listed as required; your profile says basic/ }],
  ['Arabic required, not on profile', { title: 'Graduate Data Analyst', level: 'graduate', text: 'Arabic required. SQL, Python.' }, { languages: ['English'] }, { verdict: 'stretch', gap: /Arabic is listed as required, and it is not on your profile/ }],
  ['English required matches', { title: 'Graduate Data Analyst', level: 'graduate', text: 'Fluent English required. SQL.' }, {}, { verdict: 'apply' }],
  ['scam: registration fee', { title: 'Data Entry Trainee', level: 'trainee', text: 'Registration fee of AED 500 required to start. Excel.' }, {}, { verdict: 'no', blocker: /fee or deposit/ }],
  ['scam: security deposit', { title: 'Customer Service Graduate', level: 'graduate', text: 'A refundable deposit is needed before training.' }, {}, { verdict: 'no', blocker: /fee or deposit/ }],
  ['scam: pay for your own visa', { title: 'Junior Analyst', level: 'junior', text: 'You must pay for your visa. Excel.' }, {}, { verdict: 'no', blocker: /fee or deposit/ }],
  ['scam flag from the collector', { title: 'Graduate Analyst', level: 'graduate', text: 'SQL.', scam: true }, {}, { verdict: 'no', blocker: /fee or deposit/ }],
  ['unrelated role scores low', { title: 'Warehouse Operative', level: 'junior', text: 'Lifting and packing goods. Forklift licence.' }, {}, { verdict: 'no', max: 45 }],
  ['no tools named: neutral skills', { title: 'Software Engineer Intern', level: 'intern', text: 'Join our team and learn.' }, {}, { verdict: 'apply', reason: /names no specific tools/ }],
  ['skill aliases: pandas = Python, js = JavaScript, postgres = SQL', { title: 'Junior Developer', level: 'junior', text: 'You will use pandas, JS and Postgres daily.' }, {}, { verdict: 'apply', reason: /3 of the 3/ }],
  ['missing skills are listed with learning links', { title: 'Graduate Data Analyst', level: 'graduate', text: 'Power BI, Tableau, SQL and Python.' }, {}, { verdict: 'apply', gap: /Power BI, Tableau/, learn: ['Power BI', 'Tableau'] }],
  ['Docker and AWS missing', { title: 'Software Engineering Intern', level: 'intern', text: 'Docker, AWS, JavaScript and Python.' }, {}, { verdict: 'apply', learn: ['AWS', 'Docker'] }],
  ['remote role open to the region', { title: 'Graduate Data Analyst', level: 'graduate', city: 'Remote', remote: true, text: 'SQL and Python.' }, { cities: ['Sharjah'] }, { verdict: 'apply', reason: /remotely/ }],
  ['remote preference vs office job', { title: 'Graduate Data Analyst', level: 'graduate', text: 'SQL and Python.' }, { remote: 'remote' }, { verdict: 'apply', gap: /prefer remote/ }],
  ['preferred city', { title: 'Data Analyst Intern', level: 'intern', city: 'Abu Dhabi', text: 'SQL.' }, {}, { verdict: 'apply', reason: /Abu Dhabi, one of your preferred cities/ }],
  ['other UAE city', { title: 'Data Analyst Intern', level: 'intern', city: 'Sharjah', text: 'SQL.' }, {}, { verdict: 'apply', gap: /Sharjah, which is not one of your preferred/ }],
  ['old listing', { title: 'Graduate Data Analyst', level: 'graduate', date: '2026-08-01', text: 'SQL and Python.' }, {}, { verdict: 'apply', gap: /over 45 days ago/ }],
  ['fresh listing', { title: 'Graduate Data Analyst', level: 'graduate', date: '2026-10-15', text: 'SQL.' }, {}, { verdict: 'apply', reason: /posted today/ }],
  ['salary below your minimum', { title: 'Graduate Data Analyst', level: 'graduate', text: 'Salary AED 3,500 per month. SQL, Python.' }, { salaryFloor: 6000 }, { verdict: 'apply', gap: /below your minimum of AED 6000/ }],
  ['salary meets your minimum', { title: 'Graduate Data Analyst', level: 'graduate', text: 'Salary AED 8,000 - 10,000 per month. SQL.' }, { salaryFloor: 6000 }, { verdict: 'apply', reason: /meets your minimum/ }],
  ['industry to avoid', { title: 'Graduate Data Analyst', level: 'graduate', company: 'Gulf Tobacco Co', text: 'Analyse tobacco sales. SQL.' }, { avoidIndustries: ['tobacco'] }, { verdict: 'apply', gap: /"tobacco", an industry you want to avoid/ }],
  ['beginner level counts for less than strong', { title: 'Graduate Developer', level: 'graduate', text: 'Python.' }, { skillLevels: { Python: 'beginner' } }, { verdict: 'apply', max: 92 }],
  ['marketing role for a marketing profile', { title: 'Digital Marketing Intern', level: 'intern', text: 'SEO, social media and content marketing.' }, { titles: ['Digital Marketing'], skills: ['SEO', 'Social media'], degree: 'BA Marketing', field: 'Marketing' }, { verdict: 'apply', min: 75, reason: /title matches/ }],
  ['finance graduate', { title: 'Graduate Accountant', level: 'graduate', text: 'Accounting, IFRS, Excel and Tally.' }, { titles: ['Accountant'], skills: ['Accounting', 'Excel'], field: 'Accounting', degree: 'BCom' }, { verdict: 'apply', min: 70 }],
  ['empty profile still works', { title: 'Graduate Data Analyst', level: 'graduate', text: 'SQL.' }, { titles: [], skills: [], field: '', degree: '', languages: [], cities: [] }, { verdict: 'stretch', max: 75 }]
];

for (const [name, j, p, x] of CASES) {
  test(name, () => {
    const r = ev(j, p);
    const all = r.reasons.map(a => a.text).concat(r.gaps.map(a => a.text), r.blockers.map(a => a.text));
    const ctx = 'score ' + r.score + ', ' + r.verdict + ': ' + r.verdictText + '\n' + all.join('\n');
    assert.equal(r.verdict, x.verdict, 'verdict. ' + ctx);
    if (x.min != null) assert.ok(r.score >= x.min, 'score ' + r.score + ' should be at least ' + x.min + '\n' + ctx);
    if (x.max != null) assert.ok(r.score <= x.max, 'score ' + r.score + ' should be at most ' + x.max + '\n' + ctx);
    if (x.reason) assert.ok(r.reasons.some(a => x.reason.test(a.text)), 'reason ' + x.reason + '\n' + ctx);
    if (x.reason2) assert.ok(r.reasons.some(a => x.reason2.test(a.text)), 'reason ' + x.reason2 + '\n' + ctx);
    if (x.gap) assert.ok(r.gaps.some(a => x.gap.test(a.text)), 'gap ' + x.gap + '\n' + ctx);
    if (x.blocker) assert.ok(r.blockers.some(a => x.blocker.test(a.text)), 'blocker ' + x.blocker + '\n' + ctx);
    if (x.learn) assert.deepEqual(r.learn.map(l => l.name).sort(), x.learn.slice().sort(), 'skills to learn');
    if (x.learn) r.learn.forEach(l => { assert.ok(l.links.length >= 1); l.links.forEach(k => assert.match(k.url, /^https:\/\//)); });
    assert.ok(r.score >= 0 && r.score <= 100);
  });
}

test('the score adds up from its parts, and the parts stay within their limits', () => {
  const r = ev({ title: 'Graduate Data Analyst', level: 'graduate', text: 'SQL, Python, Excel.' });
  const sum = Object.keys(r.parts).reduce((s, k) => s + r.parts[k], 0);
  assert.equal(r.score, Math.min(100, sum));
  Object.keys(r.parts).forEach(k => assert.ok(r.parts[k] >= 0 && r.parts[k] <= M.PART_MAX[k], k + ' within 0..' + M.PART_MAX[k]));
});

test('years of experience are read in many ways', () => {
  const y = t => M.parseYears(t);
  assert.deepEqual([y('0-2 years of experience').min, y('0-2 years of experience').max], [0, 2]);
  assert.equal(y('0-2 years of experience').fresh, true, '0-2 years counts as fresher friendly');
  assert.equal(y('3+ years').min, 3);
  assert.equal(y('Minimum of 4 years experience').min, 4);
  assert.equal(y('at least two years of relevant experience').min, 2);
  assert.equal(y('5 years in a similar role').min, 5);
  assert.equal(y('2–4 years experience').min, 2, 'en dash');
  assert.equal(y('no experience required').min, null);
  assert.equal(y('no experience required').fresh, true);
  assert.equal(y('We are a team of 5 people').min, null, 'numbers that are not experience are ignored');
});

test('skill names people type map to the same skill', () => {
  for (const [typed, id] of [['Python', 'python'], ['pandas', 'python'], ['MS Excel', 'excel'], ['power bi', 'powerbi'], ['PostgreSQL', 'sql'], ['js', 'javascript'], ['React.js', 'react'], ['Microsoft Azure', 'azure']]) assert.equal(M.skillId(typed), id, typed);
  assert.equal(M.skillId('Underwater basket weaving'), '');
  assert.deepEqual(M.extractSkills('You know C++ and C# and Node.js, with Power BI dashboards').sort(), ['analysis', 'cpp', 'csharp', 'javascript', 'powerbi'].sort());
  assert.deepEqual(M.extractSkills('Scripting in a Java environment').sort(), ['java'], '"JavaScript" is not "Java"');
  assert.ok(!M.extractSkills('Cascading style sheets').length, 'no false matches');
});

test('skill lists with levels are parsed', () => {
  assert.deepEqual(M.parseSkillList('Python (strong), SQL (working), Excel, Figma (beginner), Docker - basic'),
    [{ name: 'Python', level: 'strong' }, { name: 'SQL', level: 'working' }, { name: 'Excel', level: 'working' }, { name: 'Figma', level: 'beginner' }, { name: 'Docker', level: 'beginner' }]);
});

test('scam signs', () => {
  for (const t of ['A registration fee applies', 'pay a deposit to secure your place', 'Visa charges to be paid by the candidate', 'send money via Western Union', 'guaranteed visa for all']) assert.ok(M.scamSign(t), t);
  for (const t of ['We offer visa sponsorship', 'Competitive salary and benefits', 'Fee earner role in our legal team'.replace('Fee earner', 'Billing')]) assert.equal(M.scamSign(t), '', t);
});

test('skills that would open the most jobs are ranked', () => {
  const rs = [
    ev({ title: 'Graduate Data Analyst', level: 'graduate', text: 'SQL, Power BI.' }), ev({ title: 'Data Analyst Intern', level: 'intern', text: 'Power BI, Python.' }),
    ev({ title: 'Junior Data Analyst', level: 'junior', text: 'Tableau, Power BI, SQL.' }), ev({ title: 'Senior Analyst', text: '8+ years. Tableau.' })
  ];
  const g = M.skillGaps(rs);
  assert.deepEqual([g[0].name, g[0].count], ['Power BI', 3]);
  assert.equal(g.find(x => x.name === 'Tableau').count, 1, 'jobs you cannot get do not count');
  assert.ok(g[0].links.length);
});

test('CV keywords and interview questions come from the job', () => {
  const j = job({ title: 'Graduate Data Analyst', company: 'Careem', level: 'graduate', text: 'SQL, Python and Tableau.' });
  const k = M.cvKeywords(j, ROSHAN);
  assert.deepEqual(k.include.sort(), ['Data analysis', 'Python', 'SQL']);
  assert.deepEqual(k.learn, ['Tableau']);
  assert.ok(k.alsoMention.length && k.alsoMention.every(x => !/python|sql/i.test(x)));
  const q = M.interviewQuestions(j, ROSHAN);
  assert.match(q[0], /Graduate Data Analyst role at Careem/);
  assert.ok(q.some(x => /project where you used SQL/.test(x)) && q.some(x => /Tableau\. How would you get up to speed/.test(x)));
});

test('every learning link is a well-formed https address', () => {
  const seen = new Set();
  for (const s of M.SKILLS) for (const [title, url] of s.learn) { assert.ok(title); assert.match(url, /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//i, s.id); seen.add(url); }
  assert.ok(seen.size >= 30);
});

// A small, made-up jobs.json for the browser tests. Dates are relative to the frozen test day (15 Oct 2026, Dubai).
'use strict';
const TODAY = '2026-10-15';
function job(o) {
  return Object.assign({ country: 'UAE', remote: false, type: 'Full-time', level: 'graduate', date: '2026-10-13', dept: '', salary: '', source: 'greenhouse', sourceName: 'Example Co (Greenhouse)', firstSeen: TODAY, firstSeenAt: '2026-10-15T01:00:00.000Z', lastSeen: TODAY, location: o.city }, o);
}
function build(extra, generated) {
  const jobs = [
    job({ key: 'g:1', title: 'Graduate Data Analyst', company: 'Alpha Analytics', city: 'Dubai', url: 'https://example.com/jobs/1', text: 'Graduate Data Analyst. Entry level, 0-1 years. You will use SQL, Excel and Power BI to build dashboards. Python is a plus. Bachelor degree in Computer Science or similar. Closing date: 25 October 2026. Salary AED 9,000 per month.', salary: 'AED 9,000 per month' }),
    job({ key: 'g:2', title: 'Junior Software Engineer', company: 'Beta Software', city: 'Abu Dhabi', url: 'https://example.com/jobs/2', text: 'Junior Software Engineer, 0-2 years. Python, JavaScript, Git, REST APIs. Graduate welcome. Bachelor degree in computer science.', firstSeenAt: '2026-10-12T01:00:00.000Z', firstSeen: '2026-10-12' }),
    job({ key: 'l:3', title: 'Data Analyst Intern', company: 'Gamma Remote', city: 'Remote', remote: true, level: 'intern', type: 'Internship', url: 'https://example.com/jobs/3', source: 'lever', sourceName: 'Gamma (Lever)', text: 'Internship for students and fresh graduates, open to candidates based in the UAE. Excel, SQL and basic statistics. Remote, no experience needed.' }),
    job({ key: 'g:4', title: 'Marketing Executive', company: 'Delta Media', city: 'Dubai', level: 'graduate', url: 'https://example.com/jobs/4', text: 'Marketing executive. Social media campaigns, copywriting, Canva, brand events. 0-2 years. Graduate welcome.' }),
    job({ key: 'g:5', title: 'Senior Data Engineer', company: 'Epsilon Cloud', city: 'Dubai', level: 'senior', url: 'https://example.com/jobs/5', text: 'Senior Data Engineer. 8+ years of experience with Spark, Airflow, AWS and Python. Lead a team.' }),
    job({ key: 'a:6', title: 'Graduate Business Analyst', company: 'Zeta Consulting', city: 'Dubai', url: 'https://example.com/jobs/6', source: 'ashby', sourceName: 'Zeta (Ashby)', text: 'Graduate Business Analyst, 1-2 years of experience preferred. Tableau, SQL and Excel. Present findings to clients. Strong English.' }),
    job({ key: 'g:7', title: 'Data Analyst (UAE Nationals only)', company: 'Eta Government Services', city: 'Abu Dhabi', url: 'https://example.com/jobs/7', text: 'Data analyst role. UAE nationals only. SQL, Excel, Power BI. Fresh graduates welcome.' }),
    job({ key: 'g:8', title: 'Data Entry Assistant', company: 'Quick Hire Services', city: 'Sharjah', url: 'https://example.com/jobs/8', text: 'Data entry from home. Pay a registration fee of AED 500 and a refundable security deposit to start. Excel basics.', scam: true }),
    job({ key: 'g:9', title: 'Python Trainee', company: 'Theta Labs', city: 'Sharjah', level: 'trainee', url: 'https://example.com/jobs/9', text: 'Trainee programme for graduates. Python, SQL and Git. No experience needed. Closing date: 20 October 2026.', firstSeenAt: '2026-10-08T01:00:00.000Z', firstSeen: '2026-10-08' }),
    job({ key: 'g:10', title: 'Junior BI Analyst', company: 'Iota Retail', city: 'Dubai', url: 'https://example.com/jobs/10', text: 'Junior BI Analyst, 0-2 years. Tableau, SQL, Excel. Graduates welcome.', firstSeenAt: '2026-10-14T01:00:00.000Z', firstSeen: '2026-10-14' })
  ].concat(extra || []);
  return {
    schema: 1, generatedAt: generated || '2026-10-15T02:00:00.000Z',
    stats: { scanned: 120 + (extra || []).length, kept: jobs.length, hidden: { 'not-uae': 60, senior: 30, 'not-fresher': 15, scam: 2, old: 3 }, newCount: 4, archived: 1 },
    sources: [
      { id: 'greenhouse:alpha', name: 'Alpha Analytics', type: 'greenhouse', slug: 'alpha', status: 'ok', listed: 8, kept: 6 },
      { id: 'lever:gamma', name: 'Gamma', type: 'lever', slug: 'gamma', status: 'ok', listed: 3, kept: 1 },
      { id: 'ashby:zeta', name: 'Zeta', type: 'ashby', slug: 'zeta', status: 'ok', listed: 2, kept: 1 },
      { id: 'greenhouse:broken', name: 'Broken Board', type: 'greenhouse', slug: 'broken', status: 'failed', error: 'HTTP 404' }
    ],
    jobs, archived: []
  };
}
module.exports = { build, job, TODAY };

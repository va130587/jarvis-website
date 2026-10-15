/* Jarvis matching engine: "which jobs can hire me?"
   A transparent, rule-based engine. No AI model, no network. Every score comes with plain-English reasons.
   Works in the browser (window.JarvisMatch), in Node (module.exports) for the tests and for the GitHub Action.
   Scores are estimates, not a promise of being hired. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JarvisMatch = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- skills dictionary (id, name, aliases, free learning links) ---------------- */
  var SKILLS = [
    { id: 'python', name: 'Python', al: ['python', 'pandas', 'numpy', 'django', 'flask', 'fastapi'], learn: [['Kaggle: Python', 'https://www.kaggle.com/learn/python'], ['freeCodeCamp: Python', 'https://www.freecodecamp.org/learn/scientific-computing-with-python/']] },
    { id: 'sql', name: 'SQL', al: ['sql', 'mysql', 'postgresql', 'postgres', 'sql server', 'oracle sql', 't-sql', 'sqlite', 'databases'], learn: [['SQLBolt', 'https://sqlbolt.com/'], ['Kaggle: Intro to SQL', 'https://www.kaggle.com/learn/intro-to-sql']] },
    { id: 'javascript', name: 'JavaScript', al: ['javascript', 'js', 'node.js', 'nodejs', 'node', 'ecmascript', 'es6'], learn: [['JavaScript.info', 'https://javascript.info/'], ['freeCodeCamp: JavaScript', 'https://www.freecodecamp.org/learn/javascript-algorithms-and-data-structures-v8/']] },
    { id: 'typescript', name: 'TypeScript', al: ['typescript'], learn: [['TypeScript handbook', 'https://www.typescriptlang.org/docs/handbook/intro.html']] },
    { id: 'java', name: 'Java', al: ['java', 'spring boot', 'spring'], learn: [['Dev.java', 'https://dev.java/learn/']] },
    { id: 'csharp', name: 'C#', al: ['c#', 'csharp', '.net', 'dotnet', 'asp.net'], learn: [['Tour of C#', 'https://learn.microsoft.com/en-us/dotnet/csharp/tour-of-csharp/']] },
    { id: 'cpp', name: 'C++', al: ['c++', 'cpp'], learn: [['Learn C++', 'https://www.learncpp.com/']] },
    { id: 'react', name: 'React', al: ['react', 'reactjs', 'react.js', 'next.js', 'nextjs', 'angular', 'vue', 'vue.js', 'frontend frameworks'], learn: [['React: Learn', 'https://react.dev/learn']] },
    { id: 'html', name: 'HTML and CSS', al: ['html', 'css', 'html5', 'css3', 'sass', 'tailwind', 'bootstrap'], learn: [['MDN: Learn web development', 'https://developer.mozilla.org/en-US/docs/Learn'], ['web.dev: Learn CSS', 'https://web.dev/learn/css']] },
    { id: 'git', name: 'Git', al: ['git', 'github', 'gitlab', 'version control'], learn: [['Pro Git book', 'https://git-scm.com/book/en/v2']] },
    { id: 'linux', name: 'Linux', al: ['linux', 'unix', 'bash', 'shell scripting'], learn: [['Linux Journey', 'https://linuxjourney.com/']] },
    { id: 'docker', name: 'Docker', al: ['docker', 'containers', 'kubernetes', 'k8s'], learn: [['Docker: Get started', 'https://docs.docker.com/get-started/']] },
    { id: 'aws', name: 'AWS', al: ['aws', 'amazon web services', 'ec2', 's3', 'lambda'], learn: [['AWS Skill Builder', 'https://explore.skillbuilder.aws/learn']] },
    { id: 'azure', name: 'Azure', al: ['azure', 'microsoft azure'], learn: [['Microsoft Learn: Azure', 'https://learn.microsoft.com/en-us/training/azure/']] },
    { id: 'excel', name: 'Excel', al: ['excel', 'microsoft excel', 'spreadsheets', 'google sheets', 'pivot tables', 'vlookup'], learn: [['Excel video training', 'https://support.microsoft.com/en-us/office/excel-video-training-9bc05390-e94c-46af-a5b3-d7c22f6990bb']] },
    { id: 'powerbi', name: 'Power BI', al: ['power bi', 'powerbi', 'dax'], learn: [['Microsoft Learn: Power BI', 'https://learn.microsoft.com/en-us/training/powerplatform/power-bi']] },
    { id: 'tableau', name: 'Tableau', al: ['tableau', 'looker', 'qlik', 'data visualisation tools'], learn: [['Tableau training', 'https://www.tableau.com/learn/training']] },
    { id: 'analysis', name: 'Data analysis', al: ['data analysis', 'data analytics', 'analytics', 'data analyst', 'business intelligence', 'bi', 'reporting', 'dashboards', 'data visualization', 'data visualisation', 'insights'], learn: [['Kaggle: Pandas', 'https://www.kaggle.com/learn/pandas'], ['Kaggle: Data visualization', 'https://www.kaggle.com/learn/data-visualization']] },
    { id: 'ml', name: 'Machine learning', al: ['machine learning', 'ml', 'deep learning', 'scikit-learn', 'tensorflow', 'pytorch', 'ai', 'artificial intelligence', 'nlp'], learn: [['Kaggle: Intro to ML', 'https://www.kaggle.com/learn/intro-to-machine-learning']] },
    { id: 'stats', name: 'Statistics', al: ['statistics', 'statistical', 'probability', 'regression', 'a/b testing', 'hypothesis testing'], learn: [['Khan Academy: Statistics', 'https://www.khanacademy.org/math/statistics-probability']] },
    { id: 'security', name: 'Cybersecurity', al: ['cybersecurity', 'cyber security', 'information security', 'infosec', 'security operations', 'soc', 'penetration testing', 'siem'], learn: [['Cisco Networking Academy: Cybersecurity', 'https://www.netacad.com/courses/cybersecurity']] },
    { id: 'networking', name: 'Networking', al: ['networking', 'tcp/ip', 'cisco', 'ccna', 'routing and switching', 'network administration'], learn: [['Cisco Networking Academy', 'https://www.netacad.com/courses/networking']] },
    { id: 'design', name: 'UI/UX design', al: ['figma', 'ui design', 'ux design', 'ui/ux', 'user experience', 'wireframes', 'adobe xd', 'photoshop', 'illustrator'], learn: [['Figma: Get started', 'https://help.figma.com/hc/en-us/articles/360040328273']] },
    { id: 'marketing', name: 'Digital marketing', al: ['digital marketing', 'social media', 'seo', 'sem', 'content marketing', 'google ads', 'email marketing', 'campaigns', 'brand'], learn: [['Google Digital Garage', 'https://learndigital.withgoogle.com/digitalgarage/course/digital-marketing'], ['Google SEO starter guide', 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide']] },
    { id: 'sales', name: 'Sales', al: ['sales', 'business development', 'lead generation', 'crm', 'salesforce', 'account management', 'cold calling'], learn: [['HubSpot Academy: Sales', 'https://academy.hubspot.com/courses/sales']] },
    { id: 'customer', name: 'Customer service', al: ['customer service', 'customer support', 'customer success', 'call center', 'client service', 'helpdesk', 'help desk'], learn: [['HubSpot Academy: Customer service', 'https://academy.hubspot.com/courses/customer-service']] },
    { id: 'finance', name: 'Finance and accounting', al: ['finance', 'financial analysis', 'accounting', 'bookkeeping', 'financial modelling', 'financial modeling', 'audit', 'accounts payable', 'accounts receivable', 'ifrs', 'budgeting', 'forecasting', 'tally', 'quickbooks'], learn: [['Khan Academy: Finance', 'https://www.khanacademy.org/economics-finance-domain/core-finance']] },
    { id: 'hr', name: 'HR and recruitment', al: ['human resources', 'hr', 'recruitment', 'talent acquisition', 'onboarding', 'payroll', 'recruiting', 'sourcing candidates'], learn: [['AIHR: HR learning', 'https://www.aihr.com/blog/']] },
    { id: 'pm', name: 'Project management', al: ['project management', 'project coordination', 'agile', 'scrum', 'jira', 'kanban', 'stakeholder management', 'project coordinator'], learn: [['Atlassian: Agile guide', 'https://www.atlassian.com/agile/project-management'], ['Scrum.org', 'https://www.scrum.org/resources/what-is-scrum']] },
    { id: 'communication', name: 'Communication', al: ['communication', 'communication skills', 'presentation', 'presentations', 'public speaking', 'writing skills', 'written communication', 'interpersonal skills', 'teamwork'], learn: [['Google Digital Garage', 'https://learndigital.withgoogle.com/digitalgarage/']] },
    { id: 'autocad', name: 'AutoCAD', al: ['autocad', 'cad', 'revit', 'solidworks', 'engineering drawings'], learn: [['Autodesk learning', 'https://www.autodesk.com/learn']] },
    { id: 'supply', name: 'Logistics and supply chain', al: ['logistics', 'supply chain', 'procurement', 'inventory', 'warehouse', 'freight', 'sap'], learn: [['edX: Supply chain', 'https://www.edx.org/learn/supply-chain-management']] },
    { id: 'legal', name: 'Legal and compliance', al: ['legal', 'compliance', 'contracts', 'aml', 'kyc', 'regulatory', 'risk'], learn: [['edX: Compliance', 'https://www.edx.org/learn/compliance']] },
    { id: 'arabic', name: 'Arabic', al: ['arabic'], learn: [['Duolingo: Arabic', 'https://www.duolingo.com/course/ar/en/Learn-Arabic']], language: true }
  ];
  var BY_ID = {};
  SKILLS.forEach(function (s) { BY_ID[s.id] = s; });
  var LEVEL_W = { strong: 1, working: 0.75, beginner: 0.4 };
  var LEVELS = ['beginner', 'working', 'strong'];

  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  var rxCache = {};
  function aliasRx(a) {
    if (rxCache[a]) return rxCache[a];
    // Word boundaries that also work next to symbols such as "c++" and "c#".
    return (rxCache[a] = new RegExp('(^|[^a-z0-9+#])' + esc(a) + '(?![a-z0-9+#])', 'i'));
  }
  function skillIn(skill, text) { return skill.al.some(function (a) { return aliasRx(a).test(text); }); }
  function extractSkills(text) {
    text = ' ' + String(text || '').toLowerCase().replace(/[’']/g, '\'') + ' ';
    return SKILLS.filter(function (s) { return !s.language && skillIn(s, text); }).map(function (s) { return s.id; });
  }
  // Find the dictionary id for something the person typed ("Pandas", "ms excel", "power bi").
  function skillId(name) {
    var n = String(name || '').toLowerCase().trim();
    if (!n) return '';
    for (var i = 0; i < SKILLS.length; i++) if (SKILLS[i].name.toLowerCase() === n || SKILLS[i].id === n) return SKILLS[i].id;
    for (var j = 0; j < SKILLS.length; j++) if (SKILLS[j].al.some(function (a) { return a === n; })) return SKILLS[j].id;
    n = n.replace(/^(ms|microsoft)\s+/, '');
    for (var k = 0; k < SKILLS.length; k++) if (SKILLS[k].al.some(function (a) { return a === n; }) || SKILLS[k].name.toLowerCase() === n) return SKILLS[k].id;
    return '';
  }

  /* ---------------- reading a job description ---------------- */
  var NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  function toNum(x) { x = String(x).toLowerCase(); return NUM[x] != null ? NUM[x] : parseFloat(x); }
  // Years of experience asked for: { min, max, fresh } (min null when the listing does not say).
  function parseYears(text) {
    var t = String(text || '').toLowerCase().replace(/–|—/g, '-'), best = null, m, rx;
    var fresh = /\b(fresh graduates?|recent graduates?|new graduates?|no (prior |previous |work )?experience( is)? (required|needed|necessary)|entry[- ]level|0 years|graduate programme|graduate program|graduates? welcome|early careers?)\b/.test(t);
    var N = '(\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten)';
    function take(min, max) { if (isNaN(min)) return; if (best === null || min > best.min) best = { min: min, max: isNaN(max) ? null : max }; }
    rx = new RegExp(N + '\\s*(?:-|to)\\s*' + N + '\\s*\\+?\\s*years?', 'g');
    while ((m = rx.exec(t))) take(toNum(m[1]), toNum(m[2]));
    t = t.replace(rx, ' '); // a range is read once; its numbers are not read again as single values
    rx = new RegExp('(?:at least|minimum(?: of)?|min\\.?|over|more than)\\s*' + N + '\\s*\\+?\\s*years?', 'g');
    while ((m = rx.exec(t))) take(toNum(m[1]), NaN);
    rx = new RegExp(N + '\\s*\\+\\s*years?', 'g');
    while ((m = rx.exec(t))) take(toNum(m[1]), NaN);
    rx = new RegExp(N + '\\s*years?(?:\\W+(?:of\\s+)?(?:relevant|proven|professional|hands-on|work|industry|prior|previous)?\\W*)?\\s*(?:of\\s+)?(?:relevant\\s+|proven\\s+|professional\\s+|hands-on\\s+|work\\s+|industry\\s+|prior\\s+)?(?:experience|exp\\b|in\\s+a|working)', 'g');
    while ((m = rx.exec(t))) take(toNum(m[1]), NaN);
    if (best === null) return { min: null, max: null, fresh: fresh };
    if (best.min === 0) fresh = true;
    return { min: best.min, max: best.max, fresh: fresh };
  }
  // "UAE nationals only" and similar. "Preferred" or "welcome" alone is not a block.
  function nationalsOnly(text) {
    var t = String(text || '').toLowerCase();
    if (/\bemiratis?\s+only\b|\bfor\s+emiratis?\b|\bemirati(?:s|sation|zation)\b[^.]{0,30}\b(programme|program|graduates?|talent)\b|\bnationals?\s+only\b/.test(t)) return true;
    var m = /\b(uae|emirati|gcc)\s+(nationals?|citizens?)\b/.exec(t);
    if (!m) return false;
    var win = t.slice(Math.max(0, m.index - 50), m.index + 90);
    if (/\bonly\b/.test(win)) return true;
    if (/\b(preferred|encouraged|welcome|priority|advantage|plus)\b/.test(win)) return false;
    return /\b(must be|required|restricted|exclusive|exclusively|reserved|open to|programme for|program for|available (only )?to)\b/.test(win);
  }
  function visaRules(text) {
    var t = String(text || '').toLowerCase();
    var no = /\b(no|not|unable to|cannot|can't|do not|don't|will not|won't|without)\b[^.]{0,25}\bsponsorship\b|\bsponsorship\s+(is\s+)?not\s+(available|provided|offered)\b/.test(t);
    return {
      needsResident: /\b(must|should)\s+(currently\s+)?(be\s+)?(based|located|resident|reside|living)\b[^.]{0,40}\b(uae|dubai|abu dhabi|sharjah)\b|\bvalid\s+uae\s+(residen(ce|cy)\s+)?(visa|residen(ce|cy)|driving licen[cs]e)\b|\buae\s+residen(ce|cy)\s+(is\s+)?(required|mandatory|a must)\b|\b(already|currently)\s+(in|based in)\s+(the\s+)?uae\b|\btransferable\s+(uae\s+)?visa\b|\bresident\s+visa\s+(is\s+)?required\b/.test(t),
      noSponsorship: no,
      offersSponsorship: !no && /\b(visa\s+(sponsorship|support)|we\s+(will\s+)?sponsor|sponsorship\s+(is\s+)?(available|provided|offered)|relocation\s+(support|package|assistance|allowance)|work\s+visa\s+(provided|included))\b/.test(t)
    };
  }
  function degreeNeeded(text) {
    var t = String(text || '').toLowerCase();
    if (/\b(ph\.?d|doctorate|doctoral)\b/.test(t) && /\b(required|must|essential|degree)\b/.test(t)) return 'phd';
    if (/\b(master'?s|msc|m\.sc|mba|postgraduate|post-graduate)\b[^.]{0,30}\b(required|must|essential|degree)\b|\b(requires?|require|need|needs)\b[^.]{0,20}\b(master'?s|msc|mba)\b|\bmaster'?s degree\b[^.]{0,25}\b(required|essential|must)\b/.test(t)) return 'masters';
    if (/\b(bachelor|bsc|b\.sc|degree|undergraduate|graduate)\b/.test(t)) return 'bachelors';
    return '';
  }
  function languagesNeeded(text) {
    var t = String(text || '').toLowerCase(), out = [];
    [['arabic', 'Arabic'], ['french', 'French'], ['hindi', 'Hindi'], ['urdu', 'Urdu'], ['german', 'German'], ['russian', 'Russian'], ['chinese', 'Chinese'], ['mandarin', 'Chinese']].forEach(function (l) {
      var rx = new RegExp('\\b' + l[0] + '\\b[^.]{0,40}\\b(required|fluent|fluency|essential|mandatory|native|a must|proficien\\w+)\\b|\\b(fluent|fluency|proficien\\w+|native|excellent|strong|written and spoken)\\b[^.]{0,25}\\b' + l[0] + '\\b|\\b' + l[0] + '\\s*(?:\\(|-)?\\s*(required|fluent)', 'i');
      if (rx.test(t) && out.indexOf(l[1]) < 0) out.push(l[1]);
    });
    return out;
  }
  function salaryAed(text) {
    var t = String(text || '').replace(/,/g, '');
    var m = t.match(/(?:aed|dhs?\.?)\s*(\d{3,6})(?:\s*(?:-|to)\s*(?:aed|dhs?\.?)?\s*(\d{3,6}))?/i);
    if (!m) return null;
    var a = +m[1], b = m[2] ? +m[2] : null;
    return { min: a, max: b || a };
  }

  /* ---------------- scam signs ---------------- */
  var SCAM_RX = /\b((?:registration|processing|visa|training|application|placement|joining|recruitment|medical|document)\s+(?:fee|charges?)s?|security deposit|refundable deposit|pay (?:a |the |an )?(?:fee|deposit)|upfront (?:payment|fee)|send money|western union|moneygram|pay for your (?:own )?visa|deposit required|guaranteed (?:job|visa))\b/i;
  function scamSign(text) { var m = String(text || '').match(SCAM_RX); return m ? m[0].toLowerCase() : ''; }

  /* ---------------- the profile as the engine reads it ---------------- */
  var TITLE_SYN = [
    ['software engineer', 'developer', 'programmer', 'software developer', 'swe', 'full stack', 'backend', 'frontend', 'web developer'],
    ['data analyst', 'analytics', 'business intelligence', 'bi analyst', 'reporting analyst', 'data analysis', 'insights analyst'],
    ['data scientist', 'machine learning', 'ml engineer', 'ai engineer', 'data science'],
    ['accountant', 'accounting', 'finance', 'financial analyst', 'auditor', 'audit', 'bookkeeper'],
    ['marketing', 'digital marketing', 'social media', 'content', 'seo', 'brand'],
    ['hr', 'human resources', 'recruiter', 'recruitment', 'talent acquisition'],
    ['sales', 'business development', 'account executive', 'account manager'],
    ['customer service', 'customer support', 'customer success', 'client services'],
    ['project coordinator', 'project manager', 'project management', 'programme coordinator', 'program coordinator', 'pmo'],
    ['engineer', 'engineering', 'graduate engineer', 'site engineer', 'mechanical', 'electrical', 'civil'],
    ['designer', 'ui', 'ux', 'product designer', 'graphic designer'],
    ['it support', 'system administrator', 'sysadmin', 'helpdesk', 'help desk', 'technical support', 'network engineer'],
    ['operations', 'logistics', 'supply chain', 'procurement', 'coordinator']
  ];
  var STOP = {};
  'the a an and or of for to in at with intern internship graduate trainee junior entry level associate fresher programme program role job position senior'.split(' ').forEach(function (w) { STOP[w] = 1; });
  function toks(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9+#\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1 && !STOP[w]; }); }
  function list(v) { return (Array.isArray(v) ? v : String(v || '').split(/[,;\n]+/)).map(function (x) { return String(x).trim(); }).filter(Boolean); }
  // "Python (strong), SQL (working), Excel" -> [{ name, level }]
  function parseSkillList(text) {
    return list(text).map(function (item) {
      var m = item.match(/^(.*?)\s*[\(:\-]\s*(beginner|basic|learning|working|intermediate|good|strong|advanced|expert|fluent)\s*\)?$/i);
      var name = (m ? m[1] : item).trim(), lv = m ? m[2].toLowerCase() : 'working';
      lv = /beginner|basic|learning/.test(lv) ? 'beginner' : /strong|advanced|expert|fluent/.test(lv) ? 'strong' : 'working';
      return name ? { name: name, level: lv } : null;
    }).filter(Boolean);
  }
  function normalizeProfile(p) {
    p = p || {};
    var levels = p.skillLevels && typeof p.skillLevels === 'object' ? p.skillLevels : {};
    var skills = [];
    list(p.skills).concat(list(p.tools)).forEach(function (name) {
      var lv = levels[name] || levels[name.toLowerCase()] || 'working', id = skillId(name);
      skills.push({ name: name, id: id, level: LEVELS.indexOf(lv) >= 0 ? lv : 'working' });
    });
    var langs = list(p.languages).map(function (l) { var m = l.match(/^([a-z ]+?)\s*(?:[\(\-:]\s*(.*?)\)?)?$/i); return { name: (m ? m[1] : l).trim().toLowerCase(), basic: m && m[2] ? /basic|beginner|learning|elementary/i.test(m[2]) : false }; });
    var years = parseFloat(p.yearsExp);
    return {
      __normalized: true,
      titles: list(p.titles), field: [p.field, p.degree].filter(Boolean).join(' '), degree: String(p.degree || '').toLowerCase(),
      skills: skills, languages: langs, years: isNaN(years) ? 0 : years,
      nationality: String(p.nationality || '').toLowerCase(), visa: p.visa || '', cities: list(p.cities), remote: p.remote || 'open',
      salaryFloor: parseFloat(p.salaryFloor) || 0, avoid: list(p.avoidIndustries).map(function (x) { return x.toLowerCase(); }),
      gradDate: p.gradDate || '', jobTypes: list(p.jobTypes)
    };
  }
  function isNational(P) { return P.visa === 'national' || /\b(emirati|uae national)\b/.test(P.nationality); }
  function hasLang(P, name) { return P.languages.filter(function (l) { return l.name.indexOf(name.toLowerCase()) === 0; })[0] || null; }

  /* ---------------- scoring ---------------- */
  var UAE_CITY = /\b(dubai|abu dhabi|sharjah|ajman|ras al[ -]khaimah|fujairah|umm al[ -]quwain|al ain)\b/i;
  function daysSince(dateIso, todayIso) {
    if (!dateIso) return null;
    var a = Date.parse(String(dateIso).slice(0, 10) + 'T12:00:00Z'), b = Date.parse((todayIso || new Date().toISOString().slice(0, 10)) + 'T12:00:00Z');
    return isNaN(a) ? null : Math.round((b - a) / 864e5);
  }
  function titleOverlap(title, P) {
    var jt = toks(title), best = 0, why = '';
    var targets = P.titles.length ? P.titles : (P.field ? [P.field] : []);
    targets.forEach(function (t) {
      var tt = toks(t);
      if (!tt.length) return;
      var hits = tt.filter(function (w) { return jt.some(function (x) { return x === w || (w.length > 3 && x.slice(0, 4) === w.slice(0, 4)); }); }).length;
      var score = hits / tt.length;
      TITLE_SYN.forEach(function (grp) {
        var inTarget = grp.some(function (g) { return String(t).toLowerCase().indexOf(g) >= 0; }), inJob = grp.some(function (g) { return String(title).toLowerCase().indexOf(g) >= 0; });
        if (inTarget && inJob) score = Math.max(score, 0.9);
      });
      if (score > best) { best = score; why = t; }
    });
    return { score: best, target: why, hasTargets: targets.length > 0 };
  }
  /**
   * Evaluate one job for one profile.
   * job: { title, text, dept, city, remote, level, type, company, salary, date, scam }.  opts: { today }
   * Returns { score, verdict: 'apply'|'stretch'|'no', verdictText, parts, reasons[], gaps[], blockers[], missingSkills[], matchedSkills[], years, learn[] }.
   */
  function evaluate(job, profile, opts) {
    opts = opts || {};
    var P = profile && profile.__normalized ? profile : normalizeProfile(profile);
    var text = [job.title, job.dept, job.text].filter(Boolean).join('\n');
    var reasons = [], gaps = [], blockers = [], parts = {};

    /* role fit (0-30) */
    var ro = titleOverlap(job.title, P);
    parts.role = ro.hasTargets ? Math.round(30 * ro.score) : 15;
    if (ro.score >= 0.9) reasons.push({ kind: 'role', text: 'The job title matches your target role "' + ro.target + '".' });
    else if (ro.score >= 0.5) reasons.push({ kind: 'role', text: 'The job title is close to your target role "' + ro.target + '".' });
    else if (ro.hasTargets) gaps.push({ kind: 'role', soft: true, text: 'The title does not match the roles you are aiming for.' });

    /* skills (0-35) */
    var jobSkills = extractSkills(text), matched = [], missing = [], weight = 0;
    jobSkills.forEach(function (id) {
      var mine = P.skills.filter(function (s) { return s.id === id; })[0];
      if (!mine) { var sk = BY_ID[id]; mine = P.skills.filter(function (s) { return !s.id && skillIn(sk, ' ' + s.name.toLowerCase() + ' '); })[0]; }
      if (mine) { matched.push(id); weight += LEVEL_W[mine.level] || 0.75; } else missing.push(id);
    });
    if (!jobSkills.length) { parts.skills = 17; reasons.push({ kind: 'skills', text: 'The listing names no specific tools, so skills could not be compared.' }); }
    else {
      parts.skills = Math.round(35 * weight / jobSkills.length);
      if (matched.length) reasons.push({ kind: 'skills', text: 'You have ' + matched.length + ' of the ' + jobSkills.length + ' skills it mentions: ' + matched.map(function (id) { return BY_ID[id].name; }).join(', ') + '.' });
      if (missing.length) gaps.push({ kind: 'skills', soft: true, text: 'Skills it mentions that are not on your profile: ' + missing.map(function (id) { return BY_ID[id].name; }).join(', ') + '.' });
      if (!matched.length) gaps.push({ kind: 'skills', soft: false, text: 'None of the skills it mentions are on your profile.' });
    }

    /* experience level (0-15) */
    var yrs = parseYears(text);
    var lvl = job.level || '';
    var gapYears = yrs.min != null ? yrs.min - P.years : 0;
    if (yrs.min != null && gapYears >= 3) {
      parts.level = 0;
      blockers.push({ kind: 'experience', text: 'It asks for ' + yrs.min + '+ years of experience; your profile has ' + P.years + '.' });
    } else if (yrs.min != null && gapYears >= 1) {
      parts.level = 5;
      gaps.push({ kind: 'experience', soft: true, text: 'It asks for ' + yrs.min + (yrs.max ? '–' + yrs.max : '+') + ' years of experience; your profile has ' + P.years + '. Internships and projects can help.' });
    } else if (lvl === 'intern' || lvl === 'graduate' || lvl === 'trainee') {
      parts.level = 15; reasons.push({ kind: 'level', text: 'It is ' + (lvl === 'intern' ? 'an internship' : lvl === 'graduate' ? 'a graduate role' : 'a trainee role') + ', made for people starting out.' });
    } else if (yrs.fresh || (yrs.min != null && yrs.min <= P.years)) {
      parts.level = 14; reasons.push({ kind: 'level', text: yrs.min != null ? 'The experience asked for (' + yrs.min + (yrs.max ? '–' + yrs.max : '') + ' years) fits your profile.' : 'It welcomes people at the start of their career.' });
    } else { parts.level = lvl === 'junior' ? 12 : 8; if (lvl === 'junior') reasons.push({ kind: 'level', text: 'It is an entry-level role.' }); }

    /* location (0-10) */
    var city = job.city || '';
    if (P.cities.some(function (c) { return c.toLowerCase() === city.toLowerCase(); })) { parts.location = 10; reasons.push({ kind: 'location', text: 'It is in ' + city + ', one of your preferred cities.' }); }
    else if (job.remote && P.remote !== 'onsite') { parts.location = 8; reasons.push({ kind: 'location', text: 'It can be done remotely.' }); }
    else if (UAE_CITY.test(city) || city === 'UAE') { parts.location = P.cities.length ? 5 : 8; if (P.cities.length) gaps.push({ kind: 'location', soft: true, text: 'It is in ' + city + ', which is not one of your preferred cities.' }); }
    else parts.location = 2;
    if (P.remote === 'remote' && !job.remote) { parts.location = Math.max(0, parts.location - 4); gaps.push({ kind: 'location', soft: true, text: 'You prefer remote work, and this role looks office-based.' }); }

    /* freshness (0-5) */
    var age = daysSince(job.date, opts.today);
    parts.recency = age == null ? 2 : age <= 7 ? 5 : age <= 21 ? 3 : age <= 45 ? 1 : 0;
    if (age != null && age <= 7) reasons.push({ kind: 'recency', text: 'It was posted ' + (age <= 0 ? 'today' : age + ' day' + (age === 1 ? '' : 's') + ' ago') + '.' });
    if (age != null && age > 45) gaps.push({ kind: 'recency', soft: true, text: 'It was posted over 45 days ago, so it may be filled.' });

    /* languages (0-5) */
    var langs = languagesNeeded(text), langScore = 5;
    langs.forEach(function (l) {
      var mine = hasLang(P, l);
      if (!mine) { langScore = Math.min(langScore, 0); gaps.push({ kind: 'language', soft: true, text: l + ' is listed as required, and it is not on your profile.' }); }
      else if (mine.basic) { langScore = Math.min(langScore, 2); gaps.push({ kind: 'language', soft: true, text: l + ' is listed as required; your profile says basic.' }); }
      else reasons.push({ kind: 'language', text: 'You speak ' + l + ', which it asks for.' });
    });
    parts.language = langScore;

    /* hard and soft eligibility rules */
    var natOnly = nationalsOnly(text);
    if (natOnly && !isNational(P)) blockers.push({ kind: 'nationality', text: 'The listing is for UAE nationals only.' });
    else if (natOnly && isNational(P)) reasons.push({ kind: 'nationality', text: 'It is open to UAE nationals, which you are.' });
    var visa = visaRules(text);
    if (P.visa === 'visit' && visa.needsResident) blockers.push({ kind: 'visa', text: 'It needs someone who already lives in the UAE with a residence visa; your profile says visit visa.' });
    else if (P.visa === 'visit' && !visa.offersSponsorship) gaps.push({ kind: 'visa', soft: true, text: 'You are on a visit visa. Check that the employer can hire from a visit visa and sponsor your visa.' });
    if (P.visa === 'needs-sponsorship' && visa.noSponsorship) blockers.push({ kind: 'visa', text: 'It says visa sponsorship is not available, and you need sponsorship.' });
    else if (P.visa === 'needs-sponsorship' && visa.offersSponsorship) reasons.push({ kind: 'visa', text: 'It mentions visa support, which you need.' });
    else if (P.visa === 'needs-sponsorship' && visa.needsResident) gaps.push({ kind: 'visa', soft: true, text: 'It asks for a UAE residence visa, and you need sponsorship.' });
    if ((P.visa === 'resident' || P.visa === 'golden' || P.visa === 'national') && visa.needsResident) reasons.push({ kind: 'visa', text: 'It asks for UAE residence, which you have.' });

    var deg = degreeNeeded(text), myDeg = P.degree;
    var has = /master|msc|mba/.test(myDeg) ? 2 : /phd|doctor/.test(myDeg) ? 3 : /bachelor|bsc|b\.sc|ba\b|beng|b\.eng|degree/.test(myDeg) ? 1 : 0;
    if (deg === 'phd' && has < 3) gaps.push({ kind: 'degree', soft: true, text: 'It asks for a PhD.' });
    else if (deg === 'masters' && has < 2) gaps.push({ kind: 'degree', soft: true, text: 'It asks for a master\'s degree; your profile lists ' + (has ? 'a bachelor\'s degree' : 'no degree') + '.' });
    else if (deg === 'bachelors' && has >= 1) reasons.push({ kind: 'degree', text: 'It asks for a degree, which you have.' });
    else if (deg === 'bachelors' && !has && myDeg === '') gaps.push({ kind: 'degree', soft: true, text: 'It asks for a degree. Add your degree to your profile.' });

    if (P.avoid.length) {
      var hay = (job.company + ' ' + text).toLowerCase(), hit = P.avoid.filter(function (a) { return hay.indexOf(a) >= 0; })[0];
      if (hit) { gaps.push({ kind: 'industry', soft: true, text: 'It mentions "' + hit + '", an industry you want to avoid.' }); parts.role = Math.max(0, parts.role - 10); }
    }
    var sal = job.salary ? salaryAed(job.salary) : salaryAed(text);
    if (sal && P.salaryFloor) {
      if (sal.max < P.salaryFloor) gaps.push({ kind: 'salary', soft: true, text: 'The pay in the listing (AED ' + sal.max + ') is below your minimum of AED ' + P.salaryFloor + '.' });
      else reasons.push({ kind: 'salary', text: 'The pay in the listing meets your minimum.' });
    }
    var scam = job.scam || scamSign(text);
    if (scam) blockers.push({ kind: 'scam', text: 'The listing mentions a fee or deposit ("' + (typeof scam === 'string' ? scam : 'fee') + '"). Real employers do not charge applicants.' });
    if (P.gradDate && /^\d{4}/.test(P.gradDate) && job.level !== 'intern' && yrs.min == null) { /* no extra rule: graduating soon is fine for graduate roles */ }

    var score = Math.max(0, Math.min(100, parts.role + parts.skills + parts.level + parts.location + parts.recency + parts.language));
    var soft = gaps.filter(function (g) { return g.soft; });
    var hard = blockers.length || (gaps.some(function (g) { return !g.soft; }) && score < 45);
    var verdict, text2;
    if (blockers.length) { verdict = 'no'; text2 = 'Probably not eligible: ' + blockers[0].text; }
    else if (score < 35) { verdict = 'no'; text2 = 'Probably not eligible: few of your skills or your target role appear in this listing.'; }
    else if (score < 60 || soft.some(function (g) { return g.kind === 'experience' || g.kind === 'degree' || g.kind === 'language' || g.kind === 'visa'; })) {
      verdict = 'stretch'; var why = soft.filter(function (g) { return g.kind !== 'recency' && g.kind !== 'location'; })[0];
      text2 = 'Stretch: apply anyway. ' + (why ? why.text : 'Some of your skills match, but not all.');
    } else { verdict = 'apply'; text2 = 'You can apply. ' + (reasons[0] ? reasons[0].text : 'Your profile fits this listing.'); }
    void hard;

    // Skills to learn, closest first
    var learn = missing.map(function (id) { return { id: id, name: BY_ID[id].name, links: BY_ID[id].learn.map(function (l) { return { title: l[0], url: l[1] }; }) }; });
    return {
      score: score, verdict: verdict, verdictText: text2, parts: parts, reasons: reasons, gaps: gaps, blockers: blockers,
      matchedSkills: matched.map(function (id) { return BY_ID[id].name; }), missingSkills: missing.map(function (id) { return BY_ID[id].name; }), missingIds: missing,
      years: yrs, learn: learn, jobSkills: jobSkills.map(function (id) { return BY_ID[id].name; }), scam: scam || ''
    };
  }
  var PART_MAX = { role: 30, skills: 35, level: 15, location: 10, recency: 5, language: 5 };
  var PART_NAME = { role: 'Job title', skills: 'Skills', level: 'Experience level', location: 'Location', recency: 'Freshness', language: 'Languages' };

  /** Skills that would open the most jobs: [{ id, name, count, links }] */
  function skillGaps(results) {
    var count = {};
    results.forEach(function (r) { r = r.eval || r; if (r.verdict === 'no') return; r.missingIds.forEach(function (id) { count[id] = (count[id] || 0) + 1; }); });
    return Object.keys(count).map(function (id) { return { id: id, name: BY_ID[id].name, count: count[id], links: BY_ID[id].learn.map(function (l) { return { title: l[0], url: l[1] }; }) }; })
      .sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
  }

  /** What the CV and cover letter should mention for this job. */
  function cvKeywords(job, profile) {
    var r = evaluate(job, profile), P = normalizeProfile(profile);
    var mine = r.matchedSkills.slice();
    var extra = P.skills.filter(function (s) { return mine.indexOf(s.name) < 0 && r.jobSkills.every(function (n) { return n.toLowerCase() !== s.name.toLowerCase(); }); }).slice(0, 3).map(function (s) { return s.name; });
    return { include: mine, alsoMention: extra, learn: r.missingSkills };
  }
  /** Interview questions built from the job description. */
  function interviewQuestions(job, profile) {
    var r = evaluate(job, profile), q = [];
    q.push('Tell me about yourself and why you are applying for the ' + job.title + ' role at ' + job.company + '.');
    q.push('What do you know about ' + job.company + ', and why do you want to work there?');
    r.jobSkills.slice(0, 4).forEach(function (s) { q.push('Tell me about a project where you used ' + s + '. What was your part, and what was the result?'); });
    if (r.missingSkills.length) q.push('This role uses ' + r.missingSkills.slice(0, 2).join(' and ') + '. How would you get up to speed quickly?');
    q.push('Describe a deadline you nearly missed. What did you do?');
    q.push('Where do you want to be in two years?');
    q.push('Do you have any questions for us?');
    return q;
  }

  return {
    SKILLS: SKILLS, evaluate: evaluate, normalizeProfile: normalizeProfile, extractSkills: extractSkills, skillId: skillId, parseYears: parseYears,
    nationalsOnly: nationalsOnly, visaRules: visaRules, degreeNeeded: degreeNeeded, languagesNeeded: languagesNeeded, salaryAed: salaryAed, scamSign: scamSign,
    parseSkillList: parseSkillList, skillGaps: skillGaps, cvKeywords: cvKeywords, interviewQuestions: interviewQuestions, daysSince: daysSince,
    PART_MAX: PART_MAX, PART_NAME: PART_NAME, SCAM_RX: SCAM_RX
  };
});

/* NOVA "Jobs for you": which jobs can hire me, and why.
   The dashboard, the "Why this job?" panel, the skills-gap summary, saved rules and alerts, the daily digest,
   the one-click application pack, the weekly report, profile onboarding (typing or voice) and the job voice commands.
   Scores come from match.js (rule-based, explainable). Scores are estimates, not a promise of being hired. */
(function () {
  'use strict';

  var J = window.J, M = window.NovaMatch;
  var esc = J.esc, $ = J.$, $$ = J.$$, ui = J.ui;
  ui.mTab = 'best'; ui.mq = ''; ui.mcity = 'all'; ui.mtype = 'all'; ui.mlevel = 'all'; ui.mmin = '0'; ui.mremote = 'all';

  /* ================= basics ================= */
  var HIDE_NAMES = { 'not-uae': 'not in the UAE or remote-friendly', 'not-fresher': 'not fresher friendly', senior: 'too senior', scam: 'looked like scams', old: 'older than 45 days', duplicate: 'duplicates' };
  var VERDICT = { apply: ['You can apply', ''], stretch: ['Stretch: apply anyway', 'gold'], no: ['Probably not eligible', 'red'] };
  function jobs() { return J.jobs ? J.jobs.all() : []; }
  function dubaiDay(iso) { var t = Date.parse(iso); return isNaN(t) ? '' : J.isoFromTs(t); }
  function isNew(j) { return (j.firstSeenAt ? dubaiDay(j.firstSeenAt) : j.firstSeen) === J.today(); }
  function sinceYesterday(j) { var f = j.firstSeenAt ? dubaiDay(j.firstSeenAt) : j.firstSeen; return !!f && f >= J.addDays(J.today(), -1); }
  // A closing date written in the listing ("Closing date: 30 October"), if any.
  function closeDate(job) {
    if (job._close !== undefined) return job._close;
    var m = String(job.text || '').match(/(?:closing date|closes?(?: on)?|apply by|application deadline|deadline(?: to apply)?|applications? close(?: on)?)\s*[:\-–]?\s*([^.\n]{3,40})/i), d = '';
    if (m) { var pd = J.parseDate(m[1]); if (pd && pd.date >= J.addDays(J.today(), -1) && pd.date <= J.addDays(J.today(), 120)) d = pd.date; }
    return (job._close = d);
  }
  function closingSoon(j) { var c = closeDate(j); return !!c && c >= J.today() && c <= J.addDays(J.today(), 14); }
  function topReasons(j, n) { return (j.eval.reasons || []).filter(function (r) { return r.kind !== 'recency'; }).slice(0, n || 2); }
  function profileGaps() {
    var p = J.data.profile, miss = [];
    if (!p.titles.length) miss.push('target job titles');
    if (!p.skills.length) miss.push('skills');
    if (!p.degree && !p.field) miss.push('degree');
    if (!p.visa) miss.push('visa status');
    if (!p.cities.length) miss.push('preferred cities');
    return miss;
  }
  function sections() {
    var all = jobs(), out = { best: [], stretch: [], no: [], fresh: [], closing: [], all: all };
    all.forEach(function (j) {
      var v = j.eval.verdict;
      if (v === 'apply') out.best.push(j); else if (v === 'stretch') out.stretch.push(j); else out.no.push(j);
      if (v !== 'no' && isNew(j)) out.fresh.push(j);
      if (v !== 'no' && closingSoon(j)) out.closing.push(j);
    });
    var by = function (a, b) { return b.score - a.score || (b.date || '').localeCompare(a.date || ''); };
    out.best.sort(by); out.stretch.sort(by); out.no.sort(by); out.fresh.sort(by);
    out.closing.sort(function (a, b) { return closeDate(a).localeCompare(closeDate(b)); });
    return out;
  }
  J.matches = { sections: sections, closeDate: closeDate, isNew: isNew, profileGaps: profileGaps };

  /* ================= filters ================= */
  function passes(j) {
    if (ui.mq.trim() && (j.title + ' ' + j.company + ' ' + j.city + ' ' + (j.dept || '')).toLowerCase().indexOf(ui.mq.trim().toLowerCase()) < 0) return false;
    if (ui.mcity !== 'all' && (ui.mcity === 'UAE' ? !/^(UAE)$/.test(j.city) : j.city !== ui.mcity)) return false;
    if (ui.mtype !== 'all' && (j.type || (j.level === 'intern' ? 'Internship' : '')) !== ui.mtype) return false;
    if (ui.mlevel !== 'all' && j.level !== ui.mlevel) return false;
    if (j.score < +ui.mmin) return false;
    if (ui.mremote === 'remote' && !j.remote) return false;
    if (ui.mremote === 'onsite' && j.remote) return false;
    return true;
  }
  var LEVEL_NAMES = { intern: 'Internship', graduate: 'Graduate', trainee: 'Trainee', junior: 'Entry level' };

  /* ================= cards ================= */
  function card(j) {
    var v = VERDICT[j.eval.verdict], saved = J.jobs.isSaved(j.key), why = topReasons(j, 2), gap = (j.eval.blockers[0] || j.eval.gaps.filter(function (g) { return g.kind !== 'recency'; })[0]);
    var cl = closeDate(j);
    return '<article class="panel job match-card ' + (j.eval.verdict === 'no' ? 'red' : j.eval.verdict === 'apply' ? '' : 'gold') + '">' +
      '<div class="job-top"><div><h3>' + J.highlight(j.title, ui.mq.trim()) + '</h3><p class="job-co">' + esc(j.company) + '</p></div>' + J.ring(j.score, { size: 58, segs: 22, tone: j.eval.verdict === 'apply' ? 'gold' : j.eval.verdict === 'no' ? 'red' : '', label: 'Match ' + j.score + ' percent' }) + '</div>' +
      '<div class="job-meta">' + J.tag(v[0], v[1]) + J.tag(j.city) + J.tag(LEVEL_NAMES[j.level] || 'Entry level', j.level === 'intern' ? 'gold' : '') + (j.type ? J.tag(j.type, 'dim') : '') + (j.remote ? J.tag('Remote', 'dim') : '') +
        (isNew(j) ? J.tag('New', 'gold') : '') + (cl ? J.tag('Closes ' + J.fmt(cl, { weekday: undefined }), closingSoon(j) ? 'red' : 'dim') : '') + (j.salary ? J.tag(j.salary, 'dim') : '') + '</div>' +
      '<ul class="why-list">' + why.map(function (r) { return '<li class="yes">' + esc(r.text) + '</li>'; }).join('') + (gap ? '<li class="no">' + esc(gap.text) + '</li>' : '') + '</ul>' +
      '<p class="job-src mono">' + esc(j.sourceName || 'Job board') + (j.date ? ' · posted ' + esc(J.fmt(j.date, { weekday: undefined })) : '') + (j.lastSeen ? ' · last seen ' + esc(J.fmt(j.lastSeen, { weekday: undefined })) : '') + '</p>' +
      '<div class="btn-row"><a class="btn small primary" href="' + esc(j.url) + '" target="_blank" rel="noopener noreferrer">View &amp; apply ↗<span class="sr-only"> (official page, opens in a new tab)</span></a>' +
        '<button type="button" class="btn small" data-act="whyJob" data-id="' + esc(j.key) + '">Why this job?</button>' +
        (saved ? '<button type="button" class="btn small ghost" data-act="openJobApp" data-id="' + esc(j.key) + '">Open application</button>' : '<button type="button" class="btn small ghost" data-act="prepareJob" data-id="' + esc(j.key) + '">Save &amp; prepare</button>') + '</div></article>';
  }

  /* ================= the dashboard ================= */
  function statsPanel(c) {
    if (!c) return '<article class="panel"><p class="empty" style="margin:0">' + (J.jobs.loading() ? 'Loading jobs…' : 'No jobs loaded yet. <b>Turn on the GitHub Action</b> (see the README) so jobs are collected automatically, or press <b>Refresh</b> to load them with your browser.') + '</p></article>';
    var st = c.stats || {}, hid = st.hidden || {}, hidden = Object.keys(hid).filter(function (k) { return hid[k]; }).map(function (k) { return hid[k] + ' ' + HIDE_NAMES[k]; });
    var failed = c.failed || [], total = (c.ok || []).length + failed.length;
    return '<article class="panel flat stats-panel"><div class="panel-head"><h2 class="label">What NOVA checked</h2><div class="btn-row"><button type="button" class="btn small ghost" data-act="matchRules">Alerts &amp; rules</button><button type="button" class="btn small" data-act="refreshJobs"' + (J.jobs.loading() ? ' disabled' : '') + '>Refresh</button></div></div>' +
      '<p class="small-text" style="margin:0 0 6px"><b class="gold-text">' + (c.collector ? 'Collected automatically' : 'Loaded by your browser') + '</b> · updated ' + esc(J.ago(c.at)) + ' · <b>' + (c.ok || []).length + '</b> of ' + total + ' sources worked.</p>' +
      '<p class="small-text muted" style="margin:0 0 6px">Scanned <b>' + (c.scanned || 0) + '</b> listings. Kept <b>' + c.jobs.length + '</b> that are in the UAE (or remote-friendly) and fresher friendly' + (hidden.length ? '. Hidden: ' + esc(hidden.join(', ')) : '') + '.</p>' +
      '<p class="small-text muted" style="margin:0">Match scores are <b>estimates</b>, not a promise of being hired. Always check the company is real before you share personal details.</p>' +
      (failed.length ? '<details class="quiet" style="margin-top:8px"><summary>' + failed.length + ' source' + (failed.length === 1 ? '' : 's') + ' could not be loaded</summary><ul class="plain" style="margin-top:8px">' + failed.slice(0, 40).map(function (f) { return '<li>' + esc(f.name) + ': ' + esc(f.reason) + '</li>'; }).join('') + '</ul></details>' : '') + '</article>';
  }
  function gapPanel(sec) {
    var gaps = M.skillGaps(sec.all).slice(0, 3);
    if (!gaps.length) return '';
    return '<article class="panel gold"><h2 class="label">Learn this to get more jobs</h2><ul class="gap-list">' + gaps.map(function (g) {
      return '<li><b>Learning ' + esc(g.name) + ' would open ' + J.plural(g.count, 'more job') + '.</b> <span class="links">' + g.links.map(function (l) { return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.title) + ' ↗</a>'; }).join(' · ') + '</span></li>';
    }).join('') + '</ul></article>';
  }
  function profileNudge() {
    var miss = profileGaps();
    if (!miss.length) return '';
    return '<article class="panel gold"><div class="panel-head"><h2 class="label">Make the matches better</h2><button type="button" class="btn small primary" data-act="jobProfile">Set up my job profile</button></div><p style="margin:0">Your profile is missing: <b>' + esc(miss.join(', ')) + '</b>. The more NOVA knows, the better it can tell which jobs can hire you. You can also say <q>set up my job profile</q>.</p></article>';
  }
  function options(list, cur) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  J.screens.matches = {
    render: function () {
      var c = J.jobs.cache(), sec = sections(), tab = ui.mTab;
      var list = (tab === 'best' ? sec.best : tab === 'stretch' ? sec.stretch : tab === 'fresh' ? sec.fresh : tab === 'closing' ? sec.closing : sec.no).filter(passes);
      var types = []; sec.all.forEach(function (j) { var t = j.type || (j.level === 'intern' ? 'Internship' : ''); if (t && types.indexOf(t) < 0) types.push(t); });
      var tabs = [['best', 'Best matches', sec.best.length], ['stretch', 'Stretch', sec.stretch.length], ['fresh', 'New today', sec.fresh.length], ['closing', 'Closing soon', sec.closing.length], ['no', 'Not eligible', sec.no.length]];
      var appDeadlines = J.data.apps.filter(function (a) { return a.deadline && a.stage === 'saved' && a.deadline >= J.today() && a.deadline <= J.addDays(J.today(), 7); });
      var empties = { best: 'No strong matches yet. Check the <b>Stretch</b> tab, add skills to your profile, or press Refresh.', stretch: 'No stretch jobs right now.', fresh: 'No new jobs today. NOVA checks every 6 hours.', closing: 'No jobs with a closing date in the next 14 days.', no: 'Nothing here. Jobs you are probably not eligible for would be listed with the reason.' };
      return J.head('Career', 'Jobs for you', 'Jobs that can realistically hire you, with a plain-English reason for each. NOVA never applies for you: you press apply.', '<button type="button" class="btn" data-act="jobProfile">Job profile</button><button type="button" class="btn" data-act="smartExplain">Explain with Smart mode</button>') +
        statsPanel(c) + profileNudge() + gapPanel(sec) +
        '<div class="tabs" role="group" aria-label="Job lists">' + tabs.map(function (t) { return '<button type="button" class="tab" id="mtab-' + t[0] + '" data-act="seg" data-group="mTab" data-id="' + t[0] + '" aria-pressed="' + (tab === t[0]) + '">' + t[1] + ' <span class="n">' + t[2] + '</span></button>'; }).join('') + '</div>' +
        '<div class="toolbar"><label class="sr-only" for="mq">Search jobs</label><input class="search" id="mq" type="search" placeholder="Search roles or companies" value="' + esc(ui.mq) + '" data-ui="mq">' +
          '<label class="sr-only" for="mcity">City</label><select id="mcity" data-ui="mcity">' + options([['all', 'All cities'], ['Dubai', 'Dubai'], ['Abu Dhabi', 'Abu Dhabi'], ['Sharjah', 'Sharjah'], ['UAE', 'UAE (other)'], ['Remote', 'Remote']], ui.mcity) + '</select>' +
          '<label class="sr-only" for="mtype">Job type</label><select id="mtype" data-ui="mtype">' + options([['all', 'All job types']].concat(types.map(function (t) { return [t, t]; })), ui.mtype) + '</select>' +
          '<label class="sr-only" for="mlevel">Level</label><select id="mlevel" data-ui="mlevel">' + options([['all', 'All levels'], ['intern', 'Internships'], ['graduate', 'Graduate'], ['trainee', 'Trainee'], ['junior', 'Entry level']], ui.mlevel) + '</select>' +
          '<label class="sr-only" for="mmin">Minimum score</label><select id="mmin" data-ui="mmin">' + options([['0', 'Any score'], ['50', '50%+'], ['60', '60%+'], ['70', '70%+'], ['80', '80%+'], ['90', '90%+']], ui.mmin) + '</select>' +
          '<label class="sr-only" for="mremote">Remote</label><select id="mremote" data-ui="mremote">' + options([['all', 'Remote or on-site'], ['remote', 'Remote only'], ['onsite', 'On-site only']], ui.mremote) + '</select></div>' +
        (tab === 'closing' && appDeadlines.length ? '<article class="panel"><h2 class="label">Your saved applications closing soon</h2><ul class="mini-list">' + appDeadlines.map(function (a) { return '<li><span class="when">' + esc(J.dueLabel(a.deadline)) + '</span><span class="what">' + esc(a.title) + '<small>' + esc(a.company) + '</small></span></li>'; }).join('') + '</ul></article>' : '') +
        (list.length ? '<div class="jobs">' + list.slice(0, 60).map(card).join('') + '</div>' + (list.length > 60 ? '<p class="small-text muted">Showing the top 60 of ' + list.length + '. Use the filters to narrow down.</p>' : '')
          : J.empty(sec.all.length ? (sec[tab === 'fresh' ? 'fresh' : tab].length ? 'No jobs match these filters.' : empties[tab]) : 'No jobs loaded yet.'));
    },
    after: function () {
      if (!J.jobs.cache() && !J.jobs.loading()) J.jobs.ensure().then(function () { if (J.current() === 'matches') J.render(false); });
    }
  };

  /* ================= "Why this job?" ================= */
  function whyDialog(j) {
    var e = j.eval, v = VERDICT[e.verdict], saved = J.jobs.isSaved(j.key);
    var bars = Object.keys(M.PART_MAX).map(function (k) { var pts = e.parts[k] || 0; return '<li><span>' + esc(M.PART_NAME[k]) + '</span>' + J.bar(pts / M.PART_MAX[k] * 100) + '<b class="mono">' + pts + '/' + M.PART_MAX[k] + '</b></li>'; }).join('');
    var holds = e.blockers.map(function (b) { return '<li class="no"><b>Blocker:</b> ' + esc(b.text) + '</li>'; }).concat(e.gaps.map(function (g) { return '<li class="no">' + esc(g.text) + '</li>'; }));
    var learn = e.learn.map(function (l) { return '<li><b>' + esc(l.name) + '</b>: ' + l.links.map(function (k) { return '<a href="' + esc(k.url) + '" target="_blank" rel="noopener noreferrer">' + esc(k.title) + ' ↗</a>'; }).join(' · ') + '</li>'; }).join('');
    var cl = closeDate(j);
    var html = '<div class="why">' +
      '<p class="verdict ' + (e.verdict === 'no' ? 'red' : e.verdict === 'stretch' ? 'gold' : '') + '"><b>' + esc(v[0]) + '.</b> ' + esc(e.verdictText.replace(/^(You can apply|Stretch: apply anyway|Probably not eligible)[.:]\s*/, '')) + '</p>' +
      '<p class="mono small-text muted">' + esc(j.company) + ' · ' + esc(j.city) + (j.location && j.location !== j.city ? ' (' + esc(j.location) + ')' : '') + ' · ' + esc(LEVEL_NAMES[j.level] || '') + '</p>' +
      '<h3>How the score of ' + j.score + '% was worked out</h3><ul class="parts">' + bars + '</ul>' +
      '<h3>Why it fits</h3>' + (e.reasons.length ? '<ul class="why-list">' + e.reasons.map(function (r) { return '<li class="yes">' + esc(r.text) + '</li>'; }).join('') + '</ul>' : '<p class="muted small-text">Nothing stands out yet. Add your skills and target roles to your profile.</p>') +
      '<h3>What may hold you back</h3>' + (holds.length ? '<ul class="why-list">' + holds.join('') + '</ul>' : '<p class="muted small-text">Nothing found in the listing.</p>') +
      (learn ? '<h3>Skills to learn to qualify (free)</h3><ul class="plain">' + learn + '</ul>' : '') +
      '<h3>About this listing</h3><ul class="plain small-text"><li>Source: <b>' + esc(j.sourceName || 'job board') + '</b>' + (j.live ? ' (loaded by your browser)' : '') + '</li><li>Posted: ' + esc(j.date ? J.longDate(j.date) : 'not stated') + '</li><li>First seen by NOVA: ' + esc(j.firstSeen ? J.longDate(j.firstSeen) : 'today') + ' · last seen: ' + esc(j.lastSeen ? J.longDate(j.lastSeen) : 'today') + '</li>' +
        '<li>Salary: ' + (j.salary ? esc(j.salary) + ' (as written in the listing)' : 'not stated in the listing. NOVA does not guess pay.') + '</li>' + (cl ? '<li>Closing date: ' + esc(J.longDate(cl)) + '</li>' : '') + '</ul>' +
      '<div class="tip-box ' + (e.scam ? 'red' : '') + '"><b>Verify the company.</b> ' + (e.scam ? 'This listing mentions a fee or deposit. Real UAE employers never ask you to pay. ' : '') + 'Check the company has a real website and a careers page that lists this job, that emails come from its own domain, and that you are never asked for money or for passport copies before a written offer.</div>' +
      '<p class="small-text muted">This score is an estimate from the text of the listing and your profile. It is not a promise of being hired.</p>' +
      '<div class="btn-row"><a class="btn primary" href="' + esc(j.url) + '" target="_blank" rel="noopener noreferrer">View &amp; apply ↗</a>' + (saved ? '<button type="button" class="btn" data-act="openJobApp" data-id="' + esc(j.key) + '">Open application</button>' : '<button type="button" class="btn" data-act="prepareJob" data-id="' + esc(j.key) + '">Save &amp; prepare application</button>') + '</div></div>';
    J.openForm({ title: j.title, submit: 'Close', hideCancel: true, noFocus: true, fields: [{ type: 'html', html: html }], onSave: function () {} });
  }

  /* ================= the application pack ================= */
  function profile() { return J.data.profile; }
  function coverFor(job, r) {
    var p = profile(), name = p.name || 'Roshan', skills = r.matchedSkills.slice(0, 4), a = /^[aeiou]/i.test(job.title) ? 'an ' : 'a ';
    var edu = p.degree ? p.degree + ' graduate' : 'recent graduate';
    var L = ['Dear Hiring Team at ' + job.company + ',', '',
      'I am writing to apply for the ' + job.title + ' position' + (job.city && job.city !== 'Remote' && job.city !== 'UAE' ? ' in ' + job.city : '') + '. I am ' + (/^[aeiou]/i.test(edu) ? 'an ' : 'a ') + edu + (p.university ? ' from ' + p.university : '') + ', and I am keen to start my career in the UAE.', ''];
    if (skills.length) L.push('Your listing mentions ' + J.joinList(r.jobSkills.slice(0, 5)) + '. I have worked with ' + J.joinList(skills) + (p.experience ? ', and my experience includes: ' + p.experience.replace(/\.+$/, '') + '.' : ', applying them in projects where I worked to deadlines and explained my results clearly.'), '');
    else if (p.experience) L.push('My experience includes: ' + p.experience.replace(/\.+$/, '') + '.', '');
    if (r.missingSkills.length) L.push('I am also building my skills in ' + J.joinList(r.missingSkills.slice(0, 2)) + ' and learn new tools quickly.', '');
    L.push('I would welcome the chance to contribute to ' + job.company + ' as ' + a + job.title + '.' + (p.languages.length ? ' I speak ' + J.joinList(p.languages) + '.' : ''), '', 'Thank you for considering my application. I would be glad to discuss how I can help your team.', '', 'Kind regards,', name);
    return L.join('\n');
  }
  function makePrep(job) {
    var r = job.eval || M.evaluate(job, J.data.profile, { today: J.today() }), p = profile(), kw = M.cvKeywords(job, p);
    var cv = (p.degree || 'Graduate') + ' graduate' + (p.university ? ' from ' + p.university : '') + (kw.include.length ? ' with hands-on skills in ' + J.joinList(kw.include.slice(0, 5)) : '') + '. Seeking the ' + job.title + ' role at ' + job.company + '.';
    return { preparedOn: J.today(), score: r.score, verdict: r.verdict, why: r.reasons.slice(0, 4).map(function (x) { return x.text; }), gaps: r.gaps.concat(r.blockers).slice(0, 4).map(function (x) { return x.text; }),
      cover: coverFor(job, r), cvSummary: cv, cvKeywords: kw, interviewQs: M.interviewQuestions(job, p) };
  }
  function prepHTML(a) {
    var pr = a.prep;
    if (!pr) return '';
    var kw = pr.cvKeywords || { include: [], alsoMention: [], learn: [] };
    return '<details style="margin-top:8px" open><summary class="label" style="cursor:pointer;margin:0">Prepared for this job (' + pr.score + '% match)</summary><div style="display:grid;gap:10px;margin-top:10px">' +
      '<div class="panel-head" style="margin:0"><b>Tailored cover letter</b><span class="btn-row"><button type="button" class="btn small" data-act="copyTpl" data-id="prepCover">Copy</button>' + (J.smart && J.smart.ready() ? '<button type="button" class="btn small ghost" data-act="smartCover" data-id="' + esc(a.id) + '">Improve with Smart mode</button>' : '') + '</span></div><pre class="template" id="prepCover">' + esc(pr.cover) + '</pre>' +
      '<div class="panel-head" style="margin:0"><b>CV summary line</b><button type="button" class="btn small" data-act="copyTpl" data-id="prepCv">Copy</button></div><pre class="template" id="prepCv">' + esc(pr.cvSummary) + '</pre>' +
      '<div><b>CV keywords</b><p class="small-text" style="margin:4px 0">Use these words in your CV: <b>' + esc(kw.include.join(', ') || 'none matched yet') + '</b>.' + (kw.alsoMention.length ? ' Also mention: ' + esc(kw.alsoMention.join(', ')) + '.' : '') + (kw.learn.length ? ' Not on your CV yet (only add if true): ' + esc(kw.learn.join(', ')) + '.' : '') + '</p></div>' +
      '<div class="panel-head" style="margin:0"><b>Interview practice questions</b><button type="button" class="btn small" data-act="copyTpl" data-id="prepQs">Copy</button></div><pre class="template" id="prepQs">' + esc(pr.interviewQs.map(function (q, i) { return (i + 1) + '. ' + q; }).join('\n')) + '</pre></div></details>';
  }
  J.matches.makePrep = makePrep; J.matches.prepHTML = prepHTML;
  function prepare(job) {
    var r = J.jobs.save(job);
    return r;
  }

  /* ================= rules and alerts ================= */
  function ruleMatches(rule, j) {
    if (rule.city && rule.city !== 'any' && (rule.city === 'UAE' ? j.city === 'Remote' : j.city !== rule.city)) return false;
    if (rule.level && rule.level !== 'any' && j.level !== rule.level) return false;
    if (j.score < (+rule.min || 0)) return false;
    var words = J.list(rule.keywords);
    if (!words.length) return true;
    var hay = j.title + ' ' + (j.dept || '');
    return words.some(function (k) { return J.overlap(k, hay) >= 1; });
  }
  function ruleLine(r) { return (r.keywords || 'Any job') + (r.city && r.city !== 'any' ? ' in ' + r.city : '') + (r.level && r.level !== 'any' ? ', ' + (LEVEL_NAMES[r.level] || r.level).toLowerCase() : '') + ', ' + (+r.min || 0) + '% or more' + (r.notify ? ', notify me' : ''); }
  function rulesDialog() {
    var rules = J.data.rules, all = jobs().filter(function (j) { return j.eval.verdict !== 'no'; });
    var html = '<p class="small-text muted" style="margin:0 0 10px">A rule is a saved search. Rules that notify you speak and show a message when a new matching job appears while NOVA is open. For alerts on your phone when NOVA is closed, see "Phone alerts" in the README.</p>' +
      (rules.length ? '<ul class="sources">' + rules.map(function (r) { return '<li><span class="grow"><b>' + esc(r.name || r.keywords || 'Rule') + '</b><br><span class="small-text muted">' + esc(ruleLine(r)) + ' · ' + J.plural(all.filter(function (j) { return ruleMatches(r, j); }).length, 'match', 'matches') + ' now</span></span>' +
        J.iconBtn('editRule', r.id, 'Edit rule ' + (r.name || r.keywords), 'edit') + J.iconBtn('delRule', r.id, 'Delete rule ' + (r.name || r.keywords), 'del', 'del') + '</li>'; }).join('') + '</ul>' : '<p class="empty">No saved searches yet. Add one, for example <b>Data analyst, Dubai, 70%</b>.</p>') +
      '<div class="btn-row" style="margin-top:12px"><button type="button" class="btn primary" data-act="addRule">Add a rule</button></div>';
    J.openForm({ title: 'Alerts and saved searches', submit: 'Close', hideCancel: true, noFocus: true, fields: [{ type: 'html', html: html }], onSave: function () {} });
  }
  function ruleForm(rule) {
    var x = rule || { name: '', keywords: '', city: 'any', level: 'any', min: 70, notify: true };
    J.openForm({
      title: rule ? 'Edit rule' : 'Add a rule',
      fields: [
        { name: 'keywords', label: 'Job titles or keywords', value: x.keywords, placeholder: 'Data analyst, Software engineer', hint: 'Comma separated. Leave empty for any job.' },
        { name: 'city', label: 'City', type: 'select', value: x.city || 'any', options: [['any', 'Any city']].concat(J.CITIES.map(function (c) { return [c, c]; })), half: true },
        { name: 'level', label: 'Level', type: 'select', value: x.level || 'any', options: [['any', 'Any level'], ['intern', 'Internship'], ['graduate', 'Graduate'], ['trainee', 'Trainee'], ['junior', 'Entry level']], half: true },
        { name: 'min', label: 'Minimum match score (0–100)', type: 'number', min: 0, max: 100, value: x.min, half: true },
        { name: 'notify', label: 'Notify me', type: 'select', value: x.notify ? 'yes' : 'no', options: [['yes', 'Yes, speak and show a message'], ['no', 'No, only list matches']], half: true }
      ],
      onSave: function (v) {
        var o = { keywords: v.keywords, city: v.city, level: v.level, min: J.clamp(+v.min || 0, 0, 100), notify: v.notify === 'yes' };
        o.name = v.keywords || 'Any job';
        if (rule) Object.assign(rule, o); else J.data.rules.push(Object.assign({ id: J.uid() }, o));
        J.commit(); J.toast('Rule saved.'); setTimeout(rulesDialog, 80);
      }
    });
  }
  function announceStrong(list) {
    var best = list.slice().sort(function (a, b) { return b.score - a.score; })[0];
    var text = (list.length === 1 ? '1 new strong job match' : list.length + ' new strong job matches') + '. Best: ' + best.title + ' at ' + best.company + ', ' + best.score + ' percent.';
    J.toast(text);
    if (J.voice) { J.voice.announce(text); if (J.ctx) { J.ctx.jobs = list; J.ctx.job = best; } }
    if (J.data.settings.notify && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('NOVA: new job matches', { body: best.title + ' at ' + best.company + ' · ' + best.score + '%', tag: 'nova-jobs' }); } catch (e) { /* some phones need a service worker */ }
    }
  }
  function checkAlerts() {
    var c = J.jobs.cache();
    if (!c) return [];
    var all = jobs(), seen = J.data.alertsSeen;
    if (!J.data.alertsReady) { J.data.alertsSeen = all.map(function (j) { return j.key; }).slice(-600); J.data.alertsReady = true; J.persist(); return []; } // the first load is not "new"
    var fresh = all.filter(function (j) { return seen.indexOf(j.key) < 0; });
    if (!fresh.length) return [];
    J.data.alertsSeen = seen.concat(fresh.map(function (j) { return j.key; })).slice(-600);
    J.persist();
    if (!J.data.settings.jobAlerts) return [];
    var min = +J.data.settings.alertMin || 75;
    var strong = fresh.filter(function (j) { return j.eval.verdict !== 'no' && (j.score >= min || J.data.rules.some(function (r) { return r.notify && ruleMatches(r, j); })); });
    if (strong.length) announceStrong(strong);
    return strong;
  }
  J.matches.checkAlerts = checkAlerts;
  J.matches.newCount = function () { return jobs().filter(function (j) { return j.eval.verdict !== 'no' && isNew(j); }).length; };

  /* ================= daily digest ================= */
  function digest() {
    var sec = sections(), today = J.today();
    var newOnes = sec.all.filter(function (j) { return j.eval.verdict !== 'no' && sinceYesterday(j); }).sort(function (a, b) { return b.score - a.score; });
    var followups = J.data.tasks.filter(function (t) { return t.kind === 'followup' && t.status !== 'done' && t.due && t.due <= today; });
    var deadlines = J.data.apps.filter(function (a) { return a.deadline && a.stage === 'saved' && a.deadline >= today && a.deadline <= J.addDays(today, 7); });
    return { fresh: newOnes, best: sec.best[0] || null, closing: sec.closing, followups: followups, deadlines: deadlines, counts: { apply: sec.best.length, stretch: sec.stretch.length } };
  }
  function digestHTML() {
    var d = digest(), c = J.jobs.cache();
    if (!c) return J.empty('Open <b>Jobs for you</b> to load jobs. With the GitHub Action turned on they are collected for you every 6 hours.');
    var rows = [];
    rows.push('<li><span class="when">' + d.fresh.length + ' new</span><span class="what">' + (d.fresh.length ? esc(d.fresh[0].title + ' at ' + d.fresh[0].company) : 'No new matches since yesterday') + (d.fresh.length ? '<small>' + d.fresh[0].score + '% match' + (d.fresh.length > 1 ? ' · and ' + (d.fresh.length - 1) + ' more' : '') + '</small>' : '') + '</span></li>');
    if (d.best) rows.push('<li><span class="when">Best</span><span class="what">' + esc(d.best.title + ' at ' + d.best.company) + '<small>' + d.best.score + '% · ' + esc(d.best.city) + '</small></span></li>');
    var close = d.closing.slice(0, 2).map(function (j) { return { t: j.title + ' at ' + j.company, d: closeDate(j) }; }).concat(d.deadlines.slice(0, 2).map(function (a) { return { t: 'Apply: ' + a.title + ' at ' + a.company, d: a.deadline }; })).sort(function (a, b) { return a.d.localeCompare(b.d); }).slice(0, 2);
    close.forEach(function (x) { rows.push('<li class="red"><span class="when">' + esc(J.dueLabel(x.d)) + '</span><span class="what">' + esc(x.t) + '<small>Closing soon</small></span></li>'); });
    if (d.followups.length) rows.push('<li class="red"><span class="when">Follow up</span><span class="what">' + esc(d.followups[0].title.replace(/^Follow up: /, '')) + '<small>' + J.plural(d.followups.length, 'application') + ' need a follow-up</small></span></li>');
    return '<ul class="mini-list">' + rows.join('') + '</ul>';
  }
  function digestText() {
    var d = digest(), c = J.jobs.cache();
    if (!c) return 'I have no job data yet. Press Refresh on the Jobs for you screen, or turn on the GitHub Action.';
    var out = [d.fresh.length ? J.plural(d.fresh.length, 'new match', 'new matches') + ' since yesterday. The best is ' + d.fresh[0].title + ' at ' + d.fresh[0].company + ', ' + d.fresh[0].score + ' percent.' : 'No new matches since yesterday.'];
    if (d.best && (!d.fresh.length || d.best.key !== d.fresh[0].key)) out.push('Your best match overall is ' + d.best.title + ' at ' + d.best.company + ', ' + d.best.score + ' percent.');
    if (d.closing.length || d.deadlines.length) out.push(J.plural(d.closing.length + d.deadlines.length, 'deadline') + ' in the next week.');
    if (d.followups.length) out.push(J.plural(d.followups.length, 'application') + ' ' + (d.followups.length === 1 ? 'needs' : 'need') + ' a follow-up: ' + d.followups.slice(0, 2).map(function (t) { return t.title.replace(/^Follow up: /, ''); }).join('; ') + '.');
    return out.join(' ');
  }
  J.matches.digestHTML = digestHTML; J.matches.digestText = digestText; J.matches.digest = digest;

  /* ================= weekly report (made automatically once a week) ================= */
  function weekRange(ws) { return { from: ws, to: J.addDays(ws, 6) }; }
  function makeReport(ws) {
    var r = weekRange(ws), apps = J.data.apps, all = jobs();
    var appliedThisWeek = apps.filter(function (a) { return a.appliedOn && a.appliedOn >= r.from && a.appliedOn <= r.to; });
    var everApplied = apps.filter(function (a) { return a.stage !== 'saved'; }), responded = everApplied.filter(function (a) { return a.stage === 'interview' || a.stage === 'offer' || a.stage === 'rejected'; });
    var rate = everApplied.length ? Math.round(responded.length / everApplied.length * 100) : 0;
    var matches = all.filter(function (j) { return j.eval.verdict !== 'no' && j.score >= 60 && j.firstSeen && j.firstSeen >= r.from && j.firstSeen <= r.to; }).sort(function (a, b) { return b.score - a.score; });
    var skills = J.data.skills, avg = skills.length ? Math.round(skills.reduce(function (s, x) { return s + x.progress; }, 0) / skills.length) : 0;
    var prevAvg = J.data.reports.latest && J.data.reports.latest.skillAvg != null ? J.data.reports.latest.skillAvg : null;
    var goal = +J.data.settings.weeklyGoal || 0;
    var fu = J.data.tasks.filter(function (t) { return t.kind === 'followup' && t.status !== 'done' && t.due && t.due <= J.today(); });
    var best = sections().best[0], gaps = M.skillGaps(all);
    var action;
    if (fu.length) action = 'Send a follow-up for ' + fu[0].title.replace(/^Follow up: /, '') + '.';
    else if (goal && appliedThisWeek.length < goal && best) action = 'Apply to ' + best.title + ' at ' + best.company + ' (' + best.score + '% match). You are at ' + appliedThisWeek.length + ' of ' + goal + ' applications this week.';
    else if (gaps[0]) action = 'Spend 30 minutes learning ' + gaps[0].name + '. It would open ' + J.plural(gaps[0].count, 'more job') + '.';
    else action = 'Keep your profile up to date and check Jobs for you every morning.';
    var rep = { week: ws, from: r.from, to: r.to, applied: appliedThisWeek.length, goal: goal, responseRate: rate, interviews: apps.filter(function (a) { return a.stage === 'interview'; }).length, offers: apps.filter(function (a) { return a.stage === 'offer'; }).length,
      newMatches: matches.length, bestMatch: matches[0] ? matches[0].title + ' at ' + matches[0].company + ' (' + matches[0].score + '%)' : '', skillAvg: avg, skillDelta: prevAvg == null ? null : avg - prevAvg, action: action, madeOn: J.today() };
    rep.text = 'Week of ' + J.fmt(r.from, { weekday: undefined }) + ': you sent ' + J.plural(rep.applied, 'application') + (goal ? ' (goal ' + goal + ')' : '') + ', the response rate is ' + rate + ' percent, and NOVA found ' + J.plural(rep.newMatches, 'new strong match', 'new strong matches') + (rep.bestMatch ? ', best: ' + rep.bestMatch : '') + '. Skills average ' + avg + ' percent' + (rep.skillDelta ? ' (' + (rep.skillDelta > 0 ? '+' : '') + rep.skillDelta + ')' : '') + '. One action for this week: ' + action;
    return rep;
  }
  function ensureWeeklyReport() {
    var cw = J.weekStart(J.today()), R = J.data.reports;
    if (R.week === cw) return null;
    var rep = makeReport(J.addDays(cw, -7));
    R.week = cw; R.latest = rep; J.persist();
    if (rep.applied || rep.newMatches || J.data.apps.length) { J.toast('Your weekly job report is ready. Say "weekly job report" to hear it.'); }
    return rep;
  }
  function reportHTML() {
    var rep = J.data.reports.latest, live = makeReport(J.weekStart(J.today()));
    function block(r, title) {
      return '<div><h3>' + esc(title) + '</h3><ul class="plain small-text"><li>Applications sent: <b>' + r.applied + '</b>' + (r.goal ? ' of ' + r.goal : '') + '</li><li>Response rate: <b>' + r.responseRate + '%</b> · interviews <b>' + r.interviews + '</b> · offers <b>' + r.offers + '</b></li><li>New strong matches: <b>' + r.newMatches + '</b>' + (r.bestMatch ? ' · best: ' + esc(r.bestMatch) : '') + '</li><li>Skills average: <b>' + r.skillAvg + '%</b>' + (r.skillDelta ? ' (' + (r.skillDelta > 0 ? '+' : '') + r.skillDelta + ')' : '') + '</li></ul><p class="small-text" style="margin:6px 0 0"><b>One action:</b> ' + esc(r.action) + '</p></div>';
    }
    return '<article class="panel gold"><div class="panel-head"><h2 class="label">Weekly job report</h2><button type="button" class="btn small" data-act="say" data-say="weekly job report">Read it to me</button></div><div class="grid-2" style="gap:18px">' + block(live, 'This week so far') + (rep ? block(rep, 'Last week (made automatically on ' + J.fmt(rep.madeOn, { weekday: undefined }) + ')') : '<div><h3>Last week</h3><p class="muted small-text">Your first automatic report appears at the start of next week.</p></div>') + '</div></article>';
  }
  J.matches.makeReport = makeReport; J.matches.reportHTML = reportHTML; J.matches.reportText = function () { var r = J.data.reports.latest || makeReport(J.addDays(J.weekStart(J.today()), -7)); return r.text; };
  J.reviewExtra = reportHTML;

  /* ================= job profile: typing ================= */
  var VISAS = [['national', 'UAE national'], ['resident', 'Residence visa (I live in the UAE)'], ['golden', 'Golden or Green visa'], ['visit', 'Visit visa'], ['needs-sponsorship', 'Outside the UAE / need visa sponsorship']];
  function skillsString(p) { return p.skills.map(function (n) { var lv = p.skillLevels[n]; return lv && lv !== 'working' ? n + ' (' + lv + ')' : n; }).join(', '); }
  J.skillsString = skillsString;
  function saveSkills(p, text) {
    var parsed = M.parseSkillList(text);
    p.skills = parsed.map(function (s) { return s.name; });
    p.skillLevels = {}; parsed.forEach(function (s) { p.skillLevels[s.name] = s.level; });
  }
  J.saveSkills = saveSkills;
  function touch(p, fields) { p.sampleFields = p.sampleFields.filter(function (f) { return fields.indexOf(f) < 0; }); if (fields.indexOf('goal') >= 0) p.goalSample = false; }
  function profileDialog() {
    var p = profile();
    J.openForm({
      title: 'Your job profile', submit: 'Save job profile',
      fields: [
        { type: 'html', html: '<p class="small-text muted" style="margin:0 0 6px">These details are used only on this device to judge which jobs can hire you. They stay in this browser and are never sent anywhere. You can also do this by voice: say <q>set up my job profile</q>.</p>' },
        { name: 'titles', label: 'Target job titles', value: p.titles.join(', '), placeholder: 'Data Analyst, Software Engineer' },
        { name: 'skills', label: 'Skills, each with a level', value: skillsString(p), placeholder: 'Python (strong), SQL (working), Excel (beginner)', hint: 'Levels: beginner, working, strong.' },
        { name: 'tools', label: 'Tools', value: p.tools.join(', '), placeholder: 'Git, VS Code, Power BI', half: true },
        { name: 'languages', label: 'Languages', value: p.languages.join(', '), placeholder: 'English, Arabic (basic)', half: true },
        { name: 'degree', label: 'Degree', value: p.degree, placeholder: 'BSc Computer Science', half: true },
        { name: 'university', label: 'University', value: p.university, half: true },
        { name: 'gradDate', label: 'Graduation year', value: p.gradDate, placeholder: '2026', half: true },
        { name: 'gpa', label: 'GPA (optional)', value: p.gpa, half: true },
        { name: 'yearsExp', label: 'Years of work experience', type: 'number', min: 0, max: 40, step: 0.5, value: p.yearsExp, half: true, hint: '0 if none.' },
        { name: 'experience', label: 'Internships and projects', type: 'textarea', rows: 3, value: p.experience, placeholder: 'Final-year project, 3-month internship…' },
        { name: 'nationality', label: 'Nationality', value: p.nationality, placeholder: 'Indian', half: true },
        { name: 'visa', label: 'Visa status', type: 'select', value: p.visa, options: VISAS, half: true },
        { name: 'cities', label: 'Preferred UAE cities', value: p.cities.join(', '), placeholder: 'Dubai, Abu Dhabi', half: true },
        { name: 'remote', label: 'Remote work', type: 'select', value: p.remote, options: [['open', 'Open to remote or on-site'], ['remote', 'I prefer remote'], ['onsite', 'On-site only']], half: true },
        { name: 'salaryFloor', label: 'Lowest monthly salary in AED (optional)', type: 'number', min: 0, value: p.salaryFloor, half: true },
        { name: 'notice', label: 'Notice period / when you can start', value: p.notice, placeholder: 'Immediately', half: true },
        { name: 'avoidIndustries', label: 'Industries to avoid', value: p.avoidIndustries.join(', '), placeholder: 'Tobacco, Gambling' }
      ],
      onSave: function (v) {
        saveSkills(p, v.skills);
        p.titles = J.list(v.titles); p.tools = J.list(v.tools); p.languages = J.list(v.languages); p.cities = J.list(v.cities); p.avoidIndustries = J.list(v.avoidIndustries);
        ['degree', 'university', 'gradDate', 'gpa', 'experience', 'nationality', 'visa', 'remote', 'notice'].forEach(function (k) { p[k] = v[k]; });
        p.yearsExp = v.yearsExp === '' ? '0' : String(v.yearsExp); p.salaryFloor = v.salaryFloor;
        touch(p, ['titles', 'skills', 'skillLevels', 'tools', 'languages', 'cities', 'avoidIndustries', 'degree', 'university', 'gradDate', 'gpa', 'experience', 'nationality', 'visa', 'remote', 'notice', 'yearsExp', 'salaryFloor']);
        J.commit(); J.toast('Job profile saved. Matches updated.');
      }
    });
  }

  /* ================= job profile: by voice ================= */
  var CITY_RX = {}; function cityIn(t) { return J.CITIES.filter(function (c) { return new RegExp('\\b' + c.toLowerCase() + '\\b').test(t); }); }
  var NUMW = { zero: 0, none: 0, no: 0, nil: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5 };
  function splitList(t) { return String(t).split(/,|;|\band\b|\bor\b|\bthen\b|\bplus\b/i).map(function (x) { return x.trim(); }).filter(Boolean); }
  function titleCaseList(t) { return splitList(t).map(function (x) { return x.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }); }
  var STEPS = [
    ['What job titles are you aiming for? For example: data analyst, software engineer.', function (p, a) { p.titles = titleCaseList(a.replace(/^(i want|i am aiming for|aiming for|looking for)\s+/i, '')); touch(p, ['titles']); }],
    ['Which skills do you have? You can say how strong each one is, for example: Python strong, SQL working, Excel beginner.', function (p, a) {
      var parts = splitList(a), parsed = parts.map(function (x) { var m = x.match(/^(.*?)\s+(beginner|basic|learning|working|intermediate|good|strong|advanced|expert)$/i); return m ? m[1] + ' (' + m[2] + ')' : x; });
      saveSkills(p, parsed.join(', ')); touch(p, ['skills', 'skillLevels']); }],
    ['What is your degree and field? For example: bachelor of computer science.', function (p, a) { p.degree = a.replace(/^(i have|i did|my degree is|a)\s+/i, '').replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); var f = a.match(/\bin\s+(.+)$|\bof\s+(.+)$/i); if (f) p.field = (f[1] || f[2]).replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); touch(p, ['degree', 'field']); }],
    ['Which year do you graduate, or did you graduate? Say a year.', function (p, a) { var y = a.match(/\b(20\d\d)\b/); if (y) p.gradDate = y[1]; touch(p, ['gradDate']); }],
    ['How many years of work experience do you have? Say zero if none.', function (p, a) { var m = a.match(/(\d+(?:\.\d+)?)/), w = a.toLowerCase().match(/\b(zero|none|no|nil|one|two|three|four|five|six|half)\b/); p.yearsExp = m ? m[1] : (w ? String(NUMW[w[1]]) : '0'); touch(p, ['yearsExp']); }],
    ['What is your visa status? UAE national, residence visa, visit visa, golden visa, or you need visa sponsorship?', function (p, a) {
      var t = a.toLowerCase(); p.visa = /national|emirati|citizen/.test(t) ? 'national' : /golden|green/.test(t) ? 'golden' : /sponsor|outside|abroad|overseas|not in the uae|need/.test(t) ? 'needs-sponsorship' : /visit|tourist/.test(t) ? 'visit' : /resid|employment|family|work visa|have a visa|live/.test(t) ? 'resident' : p.visa;
      if (p.visa === 'national' && !p.nationality) p.nationality = 'Emirati'; touch(p, ['visa', 'nationality']); }],
    ['What is your nationality?', function (p, a) { p.nationality = a.replace(/^(i am|i'm|my nationality is)\s+/i, '').replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); touch(p, ['nationality']); }, function (p) { return p.visa === 'national'; }],
    ['Which UAE cities do you prefer? For example: Dubai and Abu Dhabi.', function (p, a) { var c = cityIn(a.toLowerCase()); if (c.length) p.cities = c; else if (/any|all|anywhere/.test(a)) p.cities = []; touch(p, ['cities']); }],
    ['Do you prefer remote work, on-site work, or are you open to both?', function (p, a) { p.remote = /remote/.test(a.toLowerCase()) && !/open|both|either/.test(a.toLowerCase()) ? 'remote' : /on.?site|office/.test(a.toLowerCase()) && !/open|both|either/.test(a.toLowerCase()) ? 'onsite' : 'open'; touch(p, ['remote']); }],
    ['What is the lowest monthly salary you would accept, in dirhams? Say skip if you have none.', function (p, a) { var m = a.replace(/,/g, '').match(/(\d{3,6})/); p.salaryFloor = m ? m[1] : ''; touch(p, ['salaryFloor']); }]
  ];
  function voiceSetup(i) {
    i = i || 0;
    var p = profile();
    while (i < STEPS.length && STEPS[i][2] && STEPS[i][2](p)) i++;
    if (i >= STEPS.length) { J.commit(); setTimeout(function () { if (J.current() === 'matches') J.render(false); }, 0); return 'Your job profile is saved. Say "what jobs can hire me" to see your matches.'; }
    var intro = i === 0 ? 'Let\'s set up your job profile. These answers stay on this device. Say skip to pass a question, or cancel to stop. ' : '';
    return { text: intro + STEPS[i][0], ask: function (ans, t) {
      if (!/^(skip|pass|next|no idea|i don't know)$/.test(t)) STEPS[i][1](p, ans);
      J.persist();
      return voiceSetup(i + 1);
    } };
  }
  J.matches.voiceSetup = voiceSetup;

  /* ================= voice commands ================= */
  function ctx() { return J.ctx || (J.ctx = { jobs: [], job: null }); }
  function say3(list, n) { return list.slice(0, n || 3).map(function (j, i) { return (i + 1) + '. ' + j.title + ' at ' + j.company + ', ' + j.score + ' percent'; }).join('. '); }
  function whyText(j) {
    var e = j.eval, r = e.reasons.filter(function (x) { return x.kind !== 'recency'; }).slice(0, 2).map(function (x) { return x.text; }), g = e.blockers.concat(e.gaps.filter(function (x) { return x.kind !== 'recency'; })).slice(0, 2).map(function (x) { return x.text; });
    return j.title + ' at ' + j.company + ' scores ' + j.score + ' percent. ' + e.verdictText + (r.length ? ' It fits because: ' + r.join(' ') : '') + (g.length ? ' Watch out: ' + g.join(' ') : '');
  }
  function findByName(q) {
    q = String(q || '').replace(/^(the|a|an)\s+/, '').trim();
    return q ? J.best(jobs().filter(function (j) { return j.eval.verdict !== 'no'; }).concat(jobs()), q, function (j) { return j.title + ' ' + j.company; }, 0.5) : null;
  }
  function needJobs(fn) {
    return J.jobs.ensure().then(function (c) { if (!c || !c.jobs.length) return 'I have no job data yet. Turn on the GitHub Action so jobs are collected for you, or press Refresh on the Jobs for you screen.'; return fn(); });
  }
  var FIRST_ORD = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 };
  J.matchVoice = function (t, orig) {
    var m, c = ctx();

    if (/^(?:set up|setup|fill in|update|edit|start)\s+my\s+(?:job\s+)?profile$|^(?:job\s+)?profile\s+(?:set ?up|onboarding)$/.test(t)) return voiceSetup(0);

    if (/^(?:what|which)\s+jobs?\s+(?:can|could|would)\s+(?:hire|take|accept)\s+me$|^(?:find|show|get)\s+(?:me\s+)?(?:the\s+)?jobs?\s+(?:i|that i)\s+(?:can|could)\s+(?:get|apply (?:for|to)|do)$|^(?:show|read|list)\s+(?:me\s+)?my\s+best\s+(?:job\s+)?matches$|^best\s+(?:job\s+)?matches$|^what are my best (?:jobs|matches)$|^jobs? that can hire me$/.test(t)) {
      return needJobs(function () {
        var sec = sections(), gaps = profileGaps();
        if (!sec.best.length && !sec.stretch.length) return 'I could not find a job that fits you yet. ' + (gaps.length ? 'Your profile is missing ' + gaps.join(', ') + '. Say "set up my job profile". ' : '') + 'Check back after the next collection.';
        c.jobs = sec.best.length ? sec.best : sec.stretch; c.job = c.jobs[0];
        J.go('matches');
        return { text: 'You can apply for ' + J.plural(sec.best.length, 'job') + ', and ' + J.plural(sec.stretch.length, 'more job') + ' are a stretch. Top three: ' + say3(c.jobs, 3) + '. Say "why this job" or "prepare an application".' + (gaps.length ? ' Tip: your profile is missing ' + gaps.join(', ') + '.' : ''), chips: ['why this job', 'prepare an application', 'what should I learn'] };
      });
    }
    if ((m = t.match(/^read (?:me )?the top (three|3|five|5|ten|10|jobs?)(?: jobs| matches)?$/))) {
      return needJobs(function () {
        var n = /five|5/.test(m[1]) ? 5 : /ten|10/.test(m[1]) ? 10 : 3, sec = sections(), list = sec.best.concat(sec.stretch).slice(0, n);
        if (!list.length) return 'There are no matches to read yet.';
        c.jobs = list; c.job = list[0];
        return say3(list, n) + '. Say "save this job" to save the first, or "next".';
      });
    }
    if (/^(?:why (?:did you (?:match|pick|choose|show) (?:this|that|it)(?: job| one)?|this job|is this (?:a match|job a match)|was this (?:matched|chosen))|explain (?:this |the )?match|why (?:does )?(?:this|that) (?:job )?match)$/.test(t)) {
      if (!c.job) return { text: 'Which job? Ask me "what jobs can hire me" first.', chips: ['what jobs can hire me'] };
      return whyText(c.job.eval ? c.job : J.jobs.eval ? Object.assign(c.job, { eval: J.jobs.eval(c.job) }) : c.job);
    }
    if (/^(?:what am i missing(?: for (?:this|that) job)?|what (?:do|would) i need(?: for (?:this|that) job)?|what skills am i missing|am i missing anything)$/.test(t)) {
      if (c.job) { var e = c.job.eval || J.jobs.eval(c.job); return e.missingSkills.length ? 'For ' + c.job.title + ' at ' + c.job.company + ', you are missing ' + J.joinList(e.missingSkills) + '. ' + (e.gaps.concat(e.blockers).filter(function (x) { return x.kind !== 'skills' && x.kind !== 'recency'; })[0] || { text: '' }).text : 'Your skills cover this job. ' + (e.gaps[0] ? e.gaps[0].text : 'No gaps found in the listing.'); }
      return needJobs(function () { var g = M.skillGaps(jobs()).slice(0, 3); return g.length ? 'Across your matches, you are most often missing ' + J.joinList(g.map(function (x) { return x.name + ' (' + x.count + ' jobs)'; })) + '.' : 'No skill gaps found across your matches.'; });
    }
    if (/^(?:what should i learn|which skills? (?:should|would) i (?:learn|add)|how (?:can|do) i (?:get|unlock|qualify for) more jobs|what (?:skills? )?(?:would|will) (?:get|unlock|open) (?:me )?more jobs|what should i learn to get more jobs)$/.test(t) || /^what should i learn to (?:get hired|become|be) .+/.test(t)) {
      return needJobs(function () {
        var g = M.skillGaps(jobs()).slice(0, 3);
        if (!g.length) return 'You already have the skills most of these jobs ask for. Keep your profile up to date.';
        return g.map(function (x) { return 'Learning ' + x.name + ' would open ' + J.plural(x.count, 'more job') + '. A free place to start is ' + x.links[0].title + '.'; }).join(' ');
      });
    }
    if (/^(?:which|what) job should i (?:apply (?:to|for) )?first$|^(?:which|what) (?:job )?should i apply (?:to|for) first$|^what should i apply (?:to|for)$|^best job to apply (?:to|for)$/.test(t)) {
      return needJobs(function () {
        var sec = sections(), pool = sec.best.length ? sec.best : sec.stretch;
        if (!pool.length) return 'I have no strong match to recommend yet.';
        var pick = pool.map(function (j) { return { j: j, v: j.score + (closingSoon(j) ? 8 : 0) + (isNew(j) ? 4 : 0) }; }).sort(function (a, b) { return b.v - a.v; })[0].j;
        c.jobs = [pick].concat(pool.filter(function (x) { return x !== pick; })); c.job = pick;
        var why = closingSoon(pick) ? 'It closes on ' + J.longDate(closeDate(pick)) + '.' : isNew(pick) ? 'It was posted recently, so apply early.' : 'It has your best score.';
        return { text: 'Apply first to ' + pick.title + ' at ' + pick.company + ', ' + pick.score + ' percent. ' + why + ' ' + (topReasons(pick, 1)[0] ? topReasons(pick, 1)[0].text : '') + ' Say "prepare an application" and I will get it ready.', chips: ['prepare an application', 'why this job'] };
      });
    }
    if ((m = t.match(/^(?:show|any|what's|what is)\s+(?:me\s+)?(?:the\s+)?new\s+(?:job\s+)?(?:jobs|matches|roles|openings)(?:\s+(since yesterday|today|this week))?$/)) && m[1] || /^(?:any )?new (?:job )?matches$/.test(t)) {
      return needJobs(function () {
        var list = sections().all.filter(function (j) { return j.eval.verdict !== 'no' && (m && m[1] === 'today' ? isNew(j) : sinceYesterday(j)); }).sort(function (a, b) { return b.score - a.score; });
        if (!list.length) return 'No new matches ' + (m && m[1] === 'today' ? 'today' : 'since yesterday') + '. I last checked ' + J.ago(J.jobs.cache().at) + '.';
        c.jobs = list; c.job = list[0]; J.ui.mTab = 'fresh'; J.go('matches');
        return J.plural(list.length, 'new match', 'new matches') + '. Top: ' + say3(list, 3) + '.';
      });
    }
    if (/^(?:set|create|add|make)\s+(?:me\s+)?(?:an?\s+)?(?:job\s+)?alert\s+(?:for\s+)?(.+)$/.test(t)) {
      var q = t.match(/^(?:set|create|add|make)\s+(?:me\s+)?(?:an?\s+)?(?:job\s+)?alert\s+(?:for\s+)?(.+)$/)[1];
      var min = (q.match(/(\d{2,3})\s*(?:%|percent)/) || [])[1], city = cityIn(q.toLowerCase())[0] || (/\bremote\b/.test(q) ? 'Remote' : 'any'), level = /intern/.test(q) ? 'intern' : /graduate/.test(q) ? 'graduate' : /trainee/.test(q) ? 'trainee' : /junior|entry|fresher/.test(q) ? 'junior' : 'any';
      var kw = q.replace(/\b(?:above|over|at least|more than|below|under)\s+\d+\s*(?:%|percent)?/g, ' ').replace(/\d+\s*(?:%|percent)/g, ' ').replace(/\b(?:jobs?|roles?|positions?|internships?|graduate|trainee|junior|entry level|fresher|in|at|for|remote|me|an|the)\b/g, ' ').replace(J.CITIES.length ? new RegExp('\\b(' + J.CITIES.map(function (x) { return x.toLowerCase(); }).join('|') + ')\\b', 'g') : /$^/, ' ').replace(/\s+/g, ' ').trim();
      min = J.clamp(+min || 70, 0, 100);
      return { text: 'Set an alert for ' + (kw ? '"' + kw + '"' : 'any job') + (city !== 'any' ? ' in ' + city : '') + (level !== 'any' ? ', ' + (LEVEL_NAMES[level] || level).toLowerCase() : '') + ', ' + min + ' percent or more, and notify you? Say yes or no.',
        confirm: function () { var r = { id: J.uid(), name: kw ? kw.replace(/\b[a-z]/g, function (x) { return x.toUpperCase(); }) : 'Any job', keywords: kw.replace(/\b[a-z]/g, function (x) { return x.toUpperCase(); }), city: city, level: level, min: min, notify: true }; J.data.rules.push(r); J.commit(); return 'Done. I will tell you when a new matching job appears while NOVA is open.'; } };
    }
    if ((m = t.match(/^(?:turn|switch)\s+(?:the\s+)?(?:job\s+)?alerts?\s+(on|off)$|^(enable|disable)\s+(?:the\s+)?(?:job\s+)?alerts?$/))) {
      var on = m[1] === 'on' || m[2] === 'enable'; J.data.settings.jobAlerts = on; J.persist(); return on ? 'Job alerts are on. I will speak when a strong new match appears while NOVA is open.' : 'Job alerts are off.';
    }
    if (/^(?:run|start|do|refresh|update)\s+(?:the\s+|my\s+)?(?:job\s+)?search(?:\s+now)?$|^(?:check|look)\s+for\s+(?:new\s+)?jobs(?:\s+now)?$|^refresh\s+(?:the\s+)?jobs$|^search\s+for\s+jobs\s+now$/.test(t)) {
      return J.jobs.reload().then(function (cc) {
        if (!cc) return 'I could not load any jobs. Check your internet connection, or turn on the GitHub Action.';
        var strong = checkAlerts();
        return 'Done. ' + J.plural(cc.jobs.length, 'job') + ' from ' + J.plural((cc.ok || []).length, 'source') + (cc.collector ? ', collected automatically ' + J.ago(cc.at) : ', loaded just now') + '. ' + J.plural(sections().best.length, 'job') + ' you can apply for.' + (strong.length ? '' : '');
      });
    }
    if (/^when (?:did|was) (?:you|the (?:job )?(?:search|collection|data)) (?:last )?(?:check|checked|run|updated|collected)|^when did you last (?:check|search|update)|^last (?:job )?check$/.test(t)) {
      var cc = J.jobs.cache();
      if (!cc) return 'I have not loaded any jobs yet.';
      var fails = (cc.failed || []).length;
      return 'I last checked ' + J.ago(cc.at) + (cc.collector ? ', automatically' : ', from your browser') + '. ' + J.plural((cc.ok || []).length, 'source') + ' worked' + (fails ? ' and ' + fails + ' could not be reached' : '') + '. I found ' + J.plural(cc.jobs.length, 'job') + '.';
    }
    if ((m = t.match(/^prepare\s+(?:an?\s+|the\s+|my\s+)?application(?:\s+for\s+(.+))?$/))) {
      var named = m[1] && !/^(this|that|it|the|this job|that job|the job|this one|that one)$/.test(m[1]) ? findByName(m[1]) : null, job = named || c.job;
      if (!job) return { text: 'Which job? Ask me "what jobs can hire me" first, or say "prepare an application for" and the job name.', chips: ['what jobs can hire me'] };
      if (J.jobs.isSaved(job.key)) return job.title + ' at ' + job.company + ' is already in your applications, with its pack. Open Applications to review it.';
      return { text: 'Prepare an application for ' + job.title + ' at ' + job.company + '? I will save it with a checklist, a follow-up reminder in 7 days, a tailored cover letter, CV keywords and interview questions. Say yes or no.',
        confirm: function () {
          var r = prepare(job);
          var a = r.app, fu = J.data.tasks.filter(function (x) { return x.appId === a.id && x.kind === 'followup'; })[0];
          return 'Done. I saved ' + job.title + ' at ' + job.company + ' with your tailored pack' + (fu ? ' and a follow-up reminder for ' + J.spokenDate(fu.due) : '') + (a.deadline ? ', plus a deadline reminder for ' + J.spokenDate(a.deadline) : '') + '. Open Applications to review it. I never apply for you: you press apply on the official page.';
        } };
    }
    if (/^(?:read |give me |what's |what is |show )?(?:my )?(?:daily |job )?(?:job )?digest$|^(?:job|jobs) (?:update|summary)$|^what's new in (?:my )?jobs$/.test(t)) return needJobs(digestText);
    if (/\bweekly\s+(?:job\s+)?report\b|\bjob\s+report\b/.test(t)) return J.matches.reportText();
    if (/^(?:which|what) jobs? can i get without (?:any )?experience$|^jobs? (?:with )?(?:no|without) experience$|^no experience (?:jobs|roles)$/.test(t)) {
      return needJobs(function () {
        var list = sections().all.filter(function (j) { return j.eval.verdict !== 'no' && (j.eval.years.min == null || j.eval.years.min === 0) && (j.eval.years.fresh || j.level === 'intern' || j.level === 'graduate' || j.level === 'trainee'); }).sort(function (a, b) { return b.score - a.score; });
        if (!list.length) return 'I found no jobs that clearly need no experience right now.';
        c.jobs = list; c.job = list[0];
        return J.plural(list.length, 'job') + ' need no experience. Top three: ' + say3(list, 3) + '.';
      });
    }
    if ((m = t.match(/^(?:save|prepare)\s+the\s+(first|second|third|fourth|fifth)\s+(?:job|one)$/)) && c.jobs[FIRST_ORD[m[1]]]) { c.job = c.jobs[FIRST_ORD[m[1]]]; return 'Okay, ' + c.job.title + ' at ' + c.job.company + '. Say "prepare an application" to get it ready, or "save this job" to just save it.'; }
    return null;
  };

  /* ================= settings: alerts ================= */
  J.jobSettingsHTML = function () {
    var S = J.data.settings;
    return '<article class="panel"><h2 class="label">Job alerts and automation</h2>' +
      '<label class="switch"><span class="txt"><b>Alerts while NOVA is open</b><small>Speak and show a message when a strong new match appears.</small></span><input type="checkbox" data-setting="jobAlerts"' + (S.jobAlerts ? ' checked' : '') + '><span class="knob" aria-hidden="true"></span></label>' +
      '<div class="field" style="margin-top:12px"><label for="alertMin">Strong match means a score of at least</label><select id="alertMin" data-setting="alertMin">' + [60, 70, 75, 80, 85, 90].map(function (n) { return '<option value="' + n + '"' + (+S.alertMin === n ? ' selected' : '') + '>' + n + '%</option>'; }).join('') + '</select></div>' +
      '<div class="btn-row"><button type="button" class="btn small" data-act="matchRules">Saved searches and rules</button><button type="button" class="btn small" data-act="runSearch">Run job search now</button><button type="button" class="btn small ghost" data-act="jobProfile">Edit job profile</button></div>' +
      '<p class="small-text muted" style="margin:10px 0 0">Jobs are collected every 6 hours by a free GitHub Action, even when this page is closed. For phone alerts when NOVA is closed, use ntfy (see the README).</p></article>';
  };

  /* ================= actions ================= */
  function jobByKey(key) { return jobs().filter(function (j) { return j.key === key; })[0]; }
  Object.assign(J.actions, {
    whyJob: function (key) { var j = jobByKey(key); if (j) whyDialog(j); },
    prepareJob: function (key) {
      var j = jobByKey(key); if (!j) return;
      J.closeForm();
      var r = prepare(j), a = r.app;
      J.toast(r.existed ? 'Already in your applications.' : 'Saved with your tailored pack, a checklist and a follow-up reminder.');
      setTimeout(function () { J.actions.openApp(a.id); }, 120);
    },
    openJobApp: function (key) { var a = J.data.apps.filter(function (x) { return x.jobKey === key; })[0]; J.closeForm(); if (a) setTimeout(function () { J.actions.openApp(a.id); }, 80); },
    jobProfile: function () { J.closeForm(); profileDialog(); },
    matchRules: function () { J.closeForm(); rulesDialog(); },
    addRule: function () { J.closeForm(); ruleForm(null); },
    editRule: function (id) { var r = J.byId(J.data.rules, id); if (r) { J.closeForm(); ruleForm(r); } },
    delRule: function (id) { J.snapshot(); J.data.rules = J.data.rules.filter(function (r) { return r.id !== id; }); J.commit(); J.toast('Rule deleted.', true); J.closeForm(); setTimeout(rulesDialog, 80); },
    runSearch: function () { J.jobs.reload().then(function (c) { checkAlerts(); J.toast(c ? J.plural(c.jobs.length, 'job') + ' loaded.' : 'Could not load jobs.'); J.render(false); }); },
    smartExplain: function () {
      if (!J.smart || !J.smart.ready()) { J.toast('Turn on Smart mode in Settings first. It runs on your device and needs a one-time download.'); return; }
      J.smart.explainTop();
    }
  });
  J.profileDialog = profileDialog;

  /* ================= start ================= */
  J.onChange(function () { /* matches depend on the profile: nothing to precompute, scores are memoised by profile */ });
  function afterLoad() {
    checkAlerts();
    J.badges && J.badges();
    if (J.current() === 'matches' || J.current() === 'today' || J.current() === 'jobs') J.render(false);
  }
  document.addEventListener('DOMContentLoaded', function () {
    ensureWeeklyReport();
    J.jobs.onLoaded(afterLoad);
    setTimeout(function () { J.jobs.init(); }, 300);
    // Look for new jobs again while the page stays open (the Action refreshes the file every 6 hours).
    setInterval(function () { if (!document.hidden && J.data.settings.jobAlerts) { var c = J.jobs.cache(); if (!c || Date.now() - c.at > 3 * 3600e3) J.jobs.reload(); else J.jobs.loadStatic().then(function (cc) { if (cc) afterLoad(); }); } }, 30 * 60e3);
  });
})();

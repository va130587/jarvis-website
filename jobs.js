/* NOVA job finder: one-click searches on the big job sites, a live feed from official public
   company job boards (Greenhouse, Lever, Ashby), and the application tracker. No scraping. */
(function () {
  'use strict';

  var J = window.J;
  var esc = J.esc, $ = J.$, $$ = J.$$;
  var ui = J.ui;
  var CACHE_KEY = 'jarvis.jobs.v1';
  var TTL = 6 * 3600e3;

  /* ================= one-click searches ================= */
  var LEVELS = [['internship', 'Internship', 'intern'], ['fresher', 'Fresher', 'fresher'], ['graduate', 'Graduate', 'graduate'], ['entry', 'Entry level', 'entry level']];
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function enc(s) { return encodeURIComponent(s); }
  function levelWord(l) { var x = LEVELS.filter(function (v) { return v[0] === l; })[0]; return x ? x[2] : 'graduate'; }
  // Each site's own entry-level or internship filter is used where its search URL supports one.
  var SITES = [
    { id: 'linkedin', name: 'LinkedIn Jobs', note: 'Experience filter: internship / entry level', url: function (kw, lvl, city) {
      var loc = city ? city + ', United Arab Emirates' : 'United Arab Emirates';
      return 'https://www.linkedin.com/jobs/search/?keywords=' + enc(kw) + '&location=' + enc(loc) + '&f_E=' + (lvl === 'internship' ? '1' : '1%2C2') + (lvl === 'internship' ? '&f_JT=I' : '') + '&sortBy=DD';
    } },
    { id: 'indeed', name: 'Indeed UAE', note: lvl0('Job type internship / entry level'), url: function (kw, lvl, city) {
      return 'https://ae.indeed.com/jobs?q=' + enc(kw + ' ' + levelWord(lvl)) + '&l=' + enc(city || 'United Arab Emirates') + (lvl === 'internship' ? '&jt=internship' : '&sc=0kf%3Aexplvl%28ENTRY_LEVEL%29%3B') + '&sort=date';
    } },
    { id: 'bayt', name: 'Bayt', note: 'Keyword + city search', url: function (kw, lvl, city) {
      return 'https://www.bayt.com/en/uae/jobs/' + slug(kw + ' ' + levelWord(lvl)) + '-jobs' + (city ? '-in-' + slug(city) : '') + '/';
    } },
    { id: 'naukrigulf', name: 'Naukrigulf', note: 'Keyword + city search', url: function (kw, lvl, city) {
      return 'https://www.naukrigulf.com/' + slug(kw + ' ' + levelWord(lvl)) + '-jobs-in-' + slug(city || 'uae');
    } },
    { id: 'gulftalent', name: 'GulfTalent', note: 'Job title search by city', url: function (kw, lvl, city) {
      return 'https://www.gulftalent.com/uae/jobs/' + (city && city !== 'Remote' ? slug(city) + '/' : '') + 'title/' + slug(levelWord(lvl) + ' ' + kw);
    } },
    { id: 'glassdoor', name: 'Glassdoor', note: 'Keyword search', url: function (kw, lvl, city) {
      return 'https://www.glassdoor.com/Job/jobs.htm?sc.keyword=' + enc(kw + ' ' + levelWord(lvl) + ' ' + (city || 'UAE')) + (lvl === 'internship' ? '&jobType=internship' : '&seniorityType=entrylevel');
    } }
  ];
  function lvl0(s) { return s; }
  J.SITES = SITES;
  function searchKeyword() {
    var p = J.data.profile;
    return (ui.sKw || p.titles[0] || p.field || 'graduate').trim();
  }
  function searchLinks(kw, lvl, city) {
    return SITES.map(function (s) { return { id: s.id, name: s.name, note: s.note, url: s.url(kw, lvl, city === 'Remote' ? '' : city) }; });
  }

  /* ================= live feed sources ================= */
  // Starter list: companies with UAE offices (or remote roles) that publish official public job boards.
  // Each is checked live in your browser; any that fail are listed quietly and can be removed.
  var STARTER = [
    { type: 'greenhouse', slug: 'careem', name: 'Careem' },
    { type: 'greenhouse', slug: 'cobblestoneenergy4', name: 'Cobblestone Energy' },
    { type: 'greenhouse-eu', slug: 'huspy', name: 'Huspy' },
    { type: 'greenhouse', slug: 'datadog', name: 'Datadog' },
    { type: 'greenhouse', slug: 'databricks', name: 'Databricks' },
    { type: 'greenhouse', slug: 'mongodb', name: 'MongoDB' },
    { type: 'greenhouse', slug: 'gitlab', name: 'GitLab' },
    { type: 'lever', slug: 'binance', name: 'Binance' },
    { type: 'ashby', slug: 'deel', name: 'Deel' }
  ];
  var TYPES = { greenhouse: 'Greenhouse', 'greenhouse-eu': 'Greenhouse (EU)', lever: 'Lever', ashby: 'Ashby' };
  function sources() {
    if (!J.data.sources) J.data.sources = STARTER.map(function (s) { return Object.assign({ id: J.uid(), enabled: true }, s); });
    return J.data.sources;
  }
  function endpoint(s) {
    var slugE = enc(s.slug);
    if (s.type === 'greenhouse') return 'https://boards-api.greenhouse.io/v1/boards/' + slugE + '/jobs';
    if (s.type === 'greenhouse-eu') return 'https://boards-api.eu.greenhouse.io/v1/boards/' + slugE + '/jobs';
    if (s.type === 'lever') return 'https://api.lever.co/v0/postings/' + slugE + '?mode=json';
    if (s.type === 'ashby') return 'https://api.ashbyhq.com/posting-api/job-board/' + slugE;
    return '';
  }
  J.jobEndpoint = endpoint;

  /* ================= filtering and scoring ================= */
  var UAE_CITIES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain', 'Al Ain'];
  var UAE_RX = /\b(dubai|abu dhabi|sharjah|ajman|ras al[ -]khaimah|rak|fujairah|umm al[ -]quwain|al ain|uae|u\.a\.e|united arab emirates|difc|dubai internet city|masdar|adgm)\b/i;
  var REMOTE_OK_RX = /\b(uae|emea|middle east|mena|gcc|anywhere|worldwide|global)\b/i;
  var FRESH_RX = /\b(intern|interns|internship|graduate|graduates|grad|new grad|trainee|traineeship|junior|jr\.?|entry[- ]level|entry|associate|fresher|freshers|apprentice|apprenticeship|early careers?|campus|student)\b/i;
  var SENIOR_RX = /\b(senior|sr\.?|lead|principal|staff|manager|director|head|vp|vice president|chief|architect|expert|specialist ii|iii|iv)\b/i;
  var EXP_RX = /\b(0\s*(?:-|–|to)\s*[12]\s*(?:\+\s*)?years?|fresh graduates?|no experience required)\b/i;
  var SCAM_RX = /\b((?:registration|processing|visa|training|application|placement|joining|recruitment)\s+(?:fee|charges?)s?|security deposit|refundable deposit|pay (?:a |the |an )?(?:fee|deposit)|upfront (?:payment|fee)|send money|western union|moneygram)\b/i;
  function cityOf(loc) {
    for (var i = 0; i < UAE_CITIES.length; i++) if (new RegExp('\\b' + UAE_CITIES[i].replace(' ', '[ -]') + '\\b', 'i').test(loc)) return UAE_CITIES[i];
    if (UAE_RX.test(loc)) return 'UAE';
    if (/remote/i.test(loc)) return 'Remote';
    return '';
  }
  function inScope(loc, remote) {
    if (UAE_RX.test(loc)) return true;
    if (remote || /remote/i.test(loc)) return REMOTE_OK_RX.test(loc) || /^\s*remote\s*$/i.test(loc);
    return false;
  }
  function levelOf(title, type) {
    var t = title + ' ' + (type || '');
    if (/\bintern(ship)?s?\b|apprentice/i.test(t)) return 'intern';
    if (/\b(graduate|grad|campus|early careers?)\b/i.test(t)) return 'graduate';
    if (/\btrainee/i.test(t)) return 'trainee';
    return 'junior';
  }
  var LEVEL_NAMES = { intern: 'Internship', graduate: 'Graduate', trainee: 'Trainee', junior: 'Entry level' };
  // Scores come from match.js (an explainable rule-based engine). Results are remembered until the profile changes.
  var evalMemo = {}, evalSig = '';
  function profileSig() {
    var p = J.data.profile;
    return JSON.stringify([p.titles, p.field, p.degree, p.skills, p.skillLevels, p.tools, p.languages, p.yearsExp, p.visa, p.nationality, p.cities, p.remote, p.salaryFloor, p.avoidIndustries, p.gradDate]);
  }
  function evalJob(job) {
    var sig = profileSig();
    if (sig !== evalSig) { evalSig = sig; evalMemo = {}; }
    var k = job.key + '|' + job.date + '|' + (job.text || '').length;
    return evalMemo[k] || (evalMemo[k] = window.NovaMatch.evaluate(job, J.data.profile, { today: J.today() }));
  }
  function score(job) { return evalJob(job).score; }
  function normalizeJob(src, raw) {
    var j;
    if (src.type === 'greenhouse' || src.type === 'greenhouse-eu') {
      j = { id: raw.id, title: raw.title, url: raw.absolute_url, loc: (raw.location && raw.location.name) || '', date: raw.first_published || raw.updated_at || '', type: '', remote: false, text: '' };
    } else if (src.type === 'lever') {
      var c = raw.categories || {};
      j = { id: raw.id, title: raw.text, url: raw.hostedUrl || raw.applyUrl, loc: [c.location].concat(c.allLocations || []).filter(Boolean).join(' / '), date: raw.createdAt ? new Date(raw.createdAt).toISOString() : '', type: c.commitment || '', dept: c.team || c.department || '', remote: raw.workplaceType === 'remote', text: (raw.descriptionPlain || '').slice(0, 4000) };
    } else {
      var locs = [raw.location].concat((raw.secondaryLocations || []).map(function (l) { return l.location; })).filter(Boolean).join(' / ');
      j = { id: raw.id, title: raw.title, url: raw.jobUrl || raw.applyUrl, loc: locs, date: raw.publishedAt || '', type: raw.employmentType || '', dept: raw.department || raw.team || '', remote: !!raw.isRemote || raw.workplaceType === 'Remote', text: (raw.descriptionPlain || '').slice(0, 4000) };
    }
    if (!j.title || !j.url || !/^https:\/\//i.test(j.url)) return null;
    j.company = src.name;
    j.key = src.type + ':' + src.slug + ':' + j.id;
    j.source = TYPES[src.type];
    return j;
  }
  function keep(j) {
    if (!inScope(j.loc, j.remote)) return false;
    var title = j.title;
    var fresh = FRESH_RX.test(title) || /intern/i.test(j.type || '') || EXP_RX.test(j.text || '');
    if (!fresh) return false;
    if (SENIOR_RX.test(title) && !/\b(intern|graduate|trainee)\b/i.test(title)) return false;
    return true;
  }
  function finish(j) {
    var out = {
      key: j.key, title: j.title, company: j.company, url: j.url, city: cityOf(j.loc) || (j.remote ? 'Remote' : 'UAE'), loc: j.loc, location: j.loc, remote: !!j.remote,
      level: levelOf(j.title, j.type), type: j.type ? J.cap(String(j.type).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()) : '', date: j.date ? String(j.date).slice(0, 10) : '',
      dept: j.dept || '', scam: SCAM_RX.test(j.title + ' ' + (j.text || '')), source: j.source, sourceName: j.source, salary: '', firstSeen: J.today(), lastSeen: J.today(), live: true
    };
    out.text = j.text ? j.text.slice(0, 3000) : '';
    return out;
  }

  /* ================= fetching + cache ================= */
  var loading = false, loadPromise = null;
  function readCache() {
    try { var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return c && Array.isArray(c.jobs) ? c : null; } catch (e) { return null; }
  }
  function writeCache(c) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); }
    catch (e) { try { c.jobs.forEach(function (j) { j.text = ''; }); localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e2) { /* run from memory only */ } }
  }
  var memCache = readCache();
  function fetchSource(src) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
    return fetch(endpoint(src), { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + (r.status === 404 ? ' (board not found)' : '')); return r.json(); })
      .then(function (data) {
        var list = src.type === 'lever' ? data : data && data.jobs;
        if (!Array.isArray(list)) throw new Error('Unexpected response');
        return list.map(function (raw) { return normalizeJob(src, raw); }).filter(Boolean);
      })
      .catch(function (e) {
        var msg = e && e.name === 'AbortError' ? 'Timed out' : (e && e.message) || 'Failed';
        if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) msg = navigator.onLine === false ? 'No internet connection' : 'Blocked or unreachable (network or CORS)';
        throw new Error(msg);
      })
      .finally(function () { clearTimeout(timer); });
  }
  function refresh() {
    if (loadPromise) return loadPromise;
    var list = sources().filter(function (s) { return s.enabled; });
    loading = true;
    if (J.current() === 'jobs') J.render(false);
    loadPromise = Promise.all(list.map(function (src) {
      return fetchSource(src).then(function (jobs) { return { src: src, jobs: jobs }; }, function (err) { return { src: src, error: err.message }; });
    })).then(function (results) {
      var jobs = [], failed = [], ok = [], total = 0;
      results.forEach(function (r) {
        if (r.error) { failed.push({ name: r.src.name, type: TYPES[r.src.type], slug: r.src.slug, reason: r.error }); return; }
        ok.push({ name: r.src.name, count: r.jobs.length });
        total += r.jobs.length;
        r.jobs.filter(keep).forEach(function (j) { jobs.push(finish(j)); });
      });
      memCache = { at: Date.now(), jobs: jobs, failed: failed, ok: ok, scanned: total };
      writeCache(memCache);
      return memCache;
    }).finally(function () {
      loading = false; loadPromise = null;
      if (J.current() === 'jobs' || J.current() === 'today') J.render(false);
      J.badges();
    });
    return loadPromise;
  }
  /* ----- the automatic collection: data/jobs.json, written by the GitHub Action ----- */
  var STATIC_FRESH = 12 * 3600e3;
  var staticLoading = null;
  function fromStatic(d) {
    var srcs = d.sources || [];
    return {
      at: Date.parse(d.generatedAt) || 0, collector: true, stats: d.stats || {}, archived: d.archived || [], sourcesInfo: srcs, scanned: (d.stats && d.stats.scanned) || 0,
      jobs: (d.jobs || []).map(function (j) { return Object.assign({ loc: j.location || '', scam: false }, j); }),
      ok: srcs.filter(function (x) { return x.status === 'ok' || x.status === 'skipped'; }).map(function (x) { return { name: x.name, count: x.listed }; }),
      failed: srcs.filter(function (x) { return x.status === 'failed'; }).map(function (x) { return { name: x.name, type: TYPES[x.type] || x.type, slug: x.slug, reason: x.error || 'failed' }; })
    };
  }
  function loadStatic() {
    if (staticLoading) return staticLoading;
    staticLoading = fetch('data/jobs.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        if (!d || !Array.isArray(d.jobs) || !d.generatedAt) return null; // the Action has not run yet
        var c = fromStatic(d);
        // Keep jobs the person found with the live fetch only when the collection is older.
        memCache = c; return c;
      }, function () { return null; })
      .then(function (c) { staticLoading = null; return c; });
    return staticLoading;
  }
  function fresh() { return memCache && Date.now() - memCache.at < (memCache.collector ? STATIC_FRESH : TTL); }
  // Order: the collected file first, then (only if it is missing or older than 12 hours) the browser's own live fetch.
  function ensure() {
    if (fresh()) return Promise.resolve(memCache);
    return loadStatic().then(function (c) { return c && fresh() ? c : refresh(); });
  }
  function reload() {
    return loadStatic().then(function (c) { return c && fresh() ? c : refresh(); }).then(function (c) { notifyLoaded(); return c; });
  }
  var loadedListeners = [];
  function onLoaded(fn) { loadedListeners.push(fn); }
  function notifyLoaded() { loadedListeners.forEach(function (fn) { try { fn(memCache); } catch (e) { setTimeout(function () { throw e; }); } }); }
  function init() { return ensure().then(function (c) { notifyLoaded(); return c; }); }
  function allJobs() {
    return (memCache ? memCache.jobs : []).map(function (j) { var r = evalJob(j); j.score = r.score; j.eval = r; return j; });
  }
  function newJobs() {
    var seen = J.data.seenJobs;
    return allJobs().filter(function (j) { return seen.indexOf(j.key) < 0; }).sort(function (a, b) { return b.score - a.score; });
  }
  function markSeen() {
    var keys = allJobs().map(function (j) { return j.key; });
    var seen = J.data.seenJobs;
    var add = keys.filter(function (k) { return seen.indexOf(k) < 0; });
    if (!add.length) return;
    J.data.seenJobs = seen.concat(add).slice(-800);
    J.persist();
  }
  function isSaved(key) { return J.data.apps.some(function (a) { return a.jobKey === key; }); }
  function save(job) {
    if (!job) return null;
    var existing = J.data.apps.filter(function (a) { return a.jobKey === job.key; })[0];
    if (existing) return { app: existing, existed: true };
    var a = { id: J.uid(), jobKey: job.key, title: job.title, company: job.company, city: job.city, url: job.url, stage: 'saved', appliedOn: '', deadline: '', interview: '', notes: '', checklist: {}, created: J.today(), updated: J.today(), scam: job.scam };
    // The closing date (if the listing has one) becomes a reminder; the follow-up reminder is created 7 days out; the pack is prepared.
    if (J.matches) { var cl = J.matches.closeDate(job); if (cl && cl >= J.today()) a.deadline = cl; a.prep = J.matches.makePrep(job); }
    J.data.apps.push(a);
    J.syncAppTasks(a);
    J.commit();
    return { app: a, existed: false };
  }
  // Filter helper shared by the screen and by voice.
  function filterJobs(f) {
    f = f || {};
    var q = (f.q || '').toLowerCase().trim();
    var list = allJobs().filter(function (j) {
      if (f.city && f.city !== 'all') { if (f.city === 'Remote' ? j.city !== 'Remote' : j.city !== f.city) return false; }
      if (f.level && f.level !== 'all') {
        if (f.level === 'fresher') { if (j.level === 'intern') return false; }
        else if (j.level !== f.level) return false;
      }
      return !q || (j.title + ' ' + j.company + ' ' + j.city + ' ' + j.dept).toLowerCase().indexOf(q) >= 0;
    });
    var sort = f.sort || 'match';
    list.sort(sort === 'newest' ? function (a, b) { return (b.date || '').localeCompare(a.date || ''); } : sort === 'company' ? function (a, b) { return a.company.localeCompare(b.company) || b.score - a.score; } : function (a, b) { return b.score - a.score; });
    return list;
  }

  /* ================= JOB FINDER screen ================= */
  ui.sLevel = ui.sLevel || 'internship';
  ui.sCity = ui.sCity == null ? '' : ui.sCity;
  ui.jq = ''; ui.jcity = 'all'; ui.jlevel = 'all'; ui.jsort = 'match';
  var sessionNew = null;
  J.screens.jobs = {
    render: function () {
      var p = J.data.profile, kw = searchKeyword();
      if (sessionNew === null && memCache) { sessionNew = {}; newJobs().forEach(function (j) { sessionNew[j.key] = 1; }); }
      var cityOpts = ['', 'Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Al Ain'];
      var links = searchLinks(kw, ui.sLevel, ui.sCity);
      var list = filterJobs({ q: ui.jq, city: ui.jcity, level: ui.jlevel, sort: ui.jsort });
      var c = memCache;
      var feedHead = loading ? '<p class="loading"><i aria-hidden="true"></i>Checking ' + sources().filter(function (s) { return s.enabled; }).length + ' company job boards…</p>' : '';
      var status = c ? (c.collector ? 'Collected automatically · ' : 'Loaded by your browser · ') + 'updated ' + J.ago(c.at) + ' · ' + (c.ok || []).length + ' of ' + ((c.ok || []).length + (c.failed || []).length) + ' sources worked · ' + c.jobs.length + ' fresher-friendly UAE/remote roles from ' + (c.scanned || 0) + ' listings' : 'Not loaded yet.';
      var titleChips = (p.titles.length ? p.titles : ['Graduate']).slice(0, 5);
      return J.head('Career', 'Job finder', 'Fresher, graduate and internship roles in the UAE. Searches open on each site in a new tab; the live feed reads official public company job boards.', '<a class="btn primary" href="#matches">Jobs that can hire you</a>') +
        '<article class="panel tip gold"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 20h18z"/><path d="M12 10v4M12 17h.01"/></svg><p><b>Scam safety:</b> real UAE employers never ask you to pay for a job, a visa, training or a “registration fee”. Never send money or passport copies before a verified offer. Jobs mentioning fees or deposits are flagged in red.</p></article>' +
        '<article class="panel"><h2 class="label">One-click searches</h2>' +
          '<form class="row" data-form="jobSearch" autocomplete="off" style="margin-bottom:12px">' +
            '<div class="field grow" style="margin:0"><label for="sKw">Keywords</label><input id="sKw" type="text" value="' + esc(kw) + '" placeholder="Data analyst"></div>' +
            '<div class="field" style="margin:0"><label for="sLevel">Level</label><select id="sLevel" data-ui="sLevel">' + LEVELS.map(function (l) { return '<option value="' + l[0] + '"' + (ui.sLevel === l[0] ? ' selected' : '') + '>' + l[1] + '</option>'; }).join('') + '</select></div>' +
            '<div class="field" style="margin:0"><label for="sCity">City</label><select id="sCity" data-ui="sCity">' + cityOpts.map(function (cty) { return '<option value="' + esc(cty) + '"' + (ui.sCity === cty ? ' selected' : '') + '>' + esc(cty || 'All UAE') + '</option>'; }).join('') + '</select></div>' +
            '<button type="submit" class="btn">Update links</button></form>' +
          '<div class="checks" style="margin-bottom:14px" aria-label="Your desired titles">' + titleChips.map(function (t) { return '<button type="button" class="btn small ghost" data-act="useKw" data-id="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>' +
          '<div class="site-grid">' + links.map(function (l) {
            return '<a class="site-btn" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer"><b>' + esc(l.name) + ' ↗</b><small>' + esc(l.note) + '</small><span class="sr-only"> (opens in a new tab)</span></a>';
          }).join('') + '</div>' +
          '<p class="small-text muted" style="margin:12px 0 0">Searching for <b>' + esc(kw + ' · ' + levelWord(ui.sLevel)) + '</b> in <b>' + esc(ui.sCity || 'the UAE') + '</b>. NOVA never scrapes these sites; it only opens their search pages for you.</p>' +
        '</article>' +
        '<article class="panel"><div class="panel-head"><h2 class="label">Live feed: company job boards</h2><div class="btn-row"><button type="button" class="btn small ghost" data-act="manageSources">Manage sources</button><button type="button" class="btn small" data-act="refreshJobs"' + (loading ? ' disabled' : '') + '>Refresh</button></div></div>' +
          '<p class="small-text muted" style="margin:-4px 0 12px" aria-live="polite">' + esc(status) + '</p>' + feedHead +
          (c && c.failed && c.failed.length ? '<details class="quiet" style="margin-bottom:12px"><summary>' + c.failed.length + ' source' + (c.failed.length === 1 ? '' : 's') + ' could not be loaded</summary><ul class="plain" style="margin-top:8px">' + c.failed.map(function (f) { return '<li>' + esc(f.name) + ' <span class="mono">(' + esc(f.type + ': ' + f.slug) + ')</span>: ' + esc(f.reason) + '</li>'; }).join('') + '</ul></details>' : '') +
          '<div class="toolbar" style="margin-bottom:14px"><label class="sr-only" for="jq">Search jobs</label><input class="search" id="jq" type="search" placeholder="Search roles or companies" value="' + esc(ui.jq) + '" data-ui="jq">' +
            '<label class="sr-only" for="jcity">City</label><select id="jcity" data-ui="jcity">' + [['all', 'All cities'], ['Dubai', 'Dubai'], ['Abu Dhabi', 'Abu Dhabi'], ['Sharjah', 'Sharjah'], ['UAE', 'UAE (other)'], ['Remote', 'Remote']].map(function (o) { return '<option value="' + o[0] + '"' + (ui.jcity === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
            '<label class="sr-only" for="jlevel">Level</label><select id="jlevel" data-ui="jlevel">' + [['all', 'All levels'], ['intern', 'Internships'], ['graduate', 'Graduate'], ['trainee', 'Trainee'], ['junior', 'Entry level'], ['fresher', 'All non-intern']].map(function (o) { return '<option value="' + o[0] + '"' + (ui.jlevel === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
            '<label class="sr-only" for="jsort">Sort</label><select id="jsort" data-ui="jsort">' + [['match', 'Best match'], ['newest', 'Newest'], ['company', 'Company']].map(function (o) { return '<option value="' + o[0] + '"' + (ui.jsort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
          (list.length ? '<div class="jobs">' + list.slice(0, 60).map(jobCard).join('') + '</div>' + (list.length > 60 ? '<p class="small-text muted">Showing the top 60 of ' + list.length + '. Use search or filters to narrow down.</p>' : '')
            : c ? J.empty(c.jobs.length ? 'No roles match these filters.' : 'No fresher-friendly UAE or remote roles right now. Try <b>Refresh</b> later, add more companies under <b>Manage sources</b>, or use the one-click searches above.') : (loading ? '' : J.empty('Press <b>Refresh</b> to load live roles.'))) +
        '</article>';
    },
    after: function () {
      if (!memCache && !loading) ensure().then(function () { J.render(false); });
      else if (memCache && !fresh() && !loading) ensure().then(function () { J.render(false); });
      if (memCache) markSeen();
    }
  };
  function jobCard(j) {
    var saved = isSaved(j.key);
    return '<article class="panel job' + (j.scam ? ' red' : '') + '">' +
      '<div class="job-top"><div><h3>' + J.highlight(j.title, ui.jq.trim()) + '</h3><p class="job-co">' + esc(j.company) + '</p></div>' + J.ring(j.score, { size: 54, segs: 20, tone: j.score >= 70 ? 'gold' : '', label: 'Match ' + j.score + ' percent' }) + '</div>' +
      '<div class="job-meta">' + J.tag(j.city) + J.tag(LEVEL_NAMES[j.level] || 'Entry level', j.level === 'intern' ? 'gold' : '') + (j.type ? J.tag(j.type, 'dim') : '') + (j.date ? J.tag(J.fmt(j.date, { weekday: undefined }), 'dim') : '') + (sessionNew && sessionNew[j.key] ? J.tag('New', 'gold') : '') + '</div>' +
      (j.scam ? '<p class="scam"><b>Warning:</b> this listing mentions a fee or deposit. Real employers do not charge applicants.</p>' : '') +
      '<div class="btn-row"><a class="btn small primary" href="' + esc(j.url) + '" target="_blank" rel="noopener noreferrer">View &amp; apply ↗<span class="sr-only"> (official page, opens in a new tab)</span></a>' +
      (saved ? '<a class="btn small ghost" href="#applications">Saved ✓</a>' : '<button type="button" class="btn small" data-act="saveJob" data-id="' + esc(j.key) + '">Save</button>') + '</div></article>';
  }
  J.forms.jobSearch = function () { ui.sKw = $('#sKw').value.trim(); J.render(false); };
  function byKey(key) { return allJobs().filter(function (j) { return j.key === key; })[0]; }
  Object.assign(J.actions, {
    useKw: function (id) { ui.sKw = id; J.render(false); },
    refreshJobs: function () { reload().then(function (c) { J.toast(c.jobs.length + ' roles from ' + c.ok.length + ' sources' + (c.collector ? ' (collected automatically ' + J.ago(c.at) + ').' : '.')); }); J.render(false); },
    saveJob: function (key) {
      var r = save(byKey(key));
      if (r) J.toast(r.existed ? 'Already in your applications.' : 'Saved to Applications.');
    },
    manageSources: function () { sourcesDialog(); },
    toggleSource: function (id) { var s = J.byId(sources(), id); if (s) { s.enabled = !s.enabled; J.persist(); sourcesDialog(); } },
    delSource: function (id) { J.data.sources = sources().filter(function (s) { return s.id !== id; }); J.persist(); sourcesDialog(); },
    resetSources: function () { J.data.sources = null; sources(); J.persist(); sourcesDialog(); }
  });
  function sourcesDialog() {
    var failed = {};
    (memCache && memCache.failed || []).forEach(function (f) { failed[f.name] = f.reason; });
    J.openForm({
      title: 'Job feed sources', submit: 'Add company', noFocus: true,
      fields: [
        { type: 'html', html: '<p class="small-text muted" style="margin:0 0 12px">Official public job boards only. Find a company\'s board name in its careers page address, for example <span class="mono">boards.greenhouse.io/<b>careem</b></span>, <span class="mono">jobs.lever.co/<b>company</b></span> or <span class="mono">jobs.ashbyhq.com/<b>company</b></span>.</p>' +
          '<ul class="sources">' + sources().map(function (s) {
            return '<li><span class="grow"><b>' + esc(s.name) + '</b> <span class="mono small-text muted">' + esc(TYPES[s.type] + ': ' + s.slug) + '</span>' + (failed[s.name] ? '<br><span class="small-text red-text">' + esc(failed[s.name]) + '</span>' : '') + '</span>' +
              '<button type="button" class="btn small ghost" data-act="toggleSource" data-id="' + s.id + '" aria-pressed="' + !!s.enabled + '">' + (s.enabled ? 'On' : 'Off') + '</button>' + J.iconBtn('delSource', s.id, 'Remove ' + s.name, 'del', 'del') + '</li>';
          }).join('') + '</ul><p style="margin:10px 0 4px"><button type="button" class="btn small ghost" data-act="resetSources">Restore starter list</button></p><h3 style="margin:16px 0 8px">Add a company</h3>' },
        { name: 'name', label: 'Company name', half: true, placeholder: 'Company' },
        { name: 'type', label: 'Job board', type: 'select', options: Object.keys(TYPES).map(function (k) { return [k, TYPES[k]]; }), value: 'greenhouse', half: true },
        { name: 'slug', label: 'Board name', placeholder: 'careem', hint: 'The part after the last slash in the board address.' }
      ],
      validate: function (v) {
        if (!v.slug) return 'Enter the board name.';
        if (!/^[a-z0-9._-]+$/i.test(v.slug)) return 'Board names use only letters, numbers, dots, dashes and underscores.';
      },
      onSave: function (v) {
        sources().push({ id: J.uid(), type: v.type, slug: v.slug.trim(), name: v.name || J.cap(v.slug), enabled: true });
        J.persist();
        J.toast('Added. Refreshing the feed…');
        refresh();
      }
    });
  }

  /* ================= APPLICATIONS screen ================= */
  ui.aq = '';
  J.screens.applications = {
    render: function () {
      var goal = +J.data.settings.weeklyGoal || 0, sent = J.appsThisWeek().length, q = ui.aq.toLowerCase().trim();
      var apps = J.data.apps.filter(function (a) { return !q || (a.title + ' ' + a.company + ' ' + a.city + ' ' + a.notes).toLowerCase().indexOf(q) >= 0; });
      var cols = J.STAGES.map(function (st, si) {
        var items = apps.filter(function (a) { return a.stage === st[0]; }).sort(function (a, b) { return (b.updated || '').localeCompare(a.updated || ''); });
        return '<section class="col ' + st[0] + '"><h2 class="label">' + st[1] + '<span class="n">' + items.length + '</span></h2>' +
          (items.length ? items.map(function (a) { return appCard(a, si); }).join('') : '<p class="empty small-text" style="padding:10px">None</p>') + '</section>';
      }).join('');
      return J.head('Career', 'Applications', 'Saved → Applied → Interview → Offer or Rejected. Deadlines and interviews become reminders automatically.', '<button type="button" class="btn" data-act="addApp"><svg viewBox="0 0 24 24" aria-hidden="true">' + J.ICON.plus + '</svg>Add application</button>') +
        '<article class="panel gold"><div class="goal-panel">' + J.ring(goal ? sent / goal * 100 : 0, { size: 96, segs: 32, tone: 'gold', label: sent + ' of ' + goal + ' applications this week', text: sent + '/' + goal }) +
          '<div class="txt"><h2 class="label">Weekly application goal</h2><p style="margin:0 0 10px">' + (goal ? (sent >= goal ? 'Goal reached this week. Excellent.' : J.plural(goal - sent, 'more application') + ' to reach your goal of ' + goal + ' this week.') : 'Set a weekly goal to keep momentum.') + '</p>' +
          '<form class="row" data-form="goal"><div class="field" style="margin:0;max-width:140px"><label for="goalIn">Goal per week</label><input id="goalIn" type="number" min="0" max="50" value="' + goal + '"></div><button type="submit" class="btn small">Set goal</button></form></div></div></article>' +
        '<div class="toolbar"><label class="sr-only" for="aq">Search applications</label><input class="search" id="aq" type="search" placeholder="Search applications" value="' + esc(ui.aq) + '" data-ui="aq"><span class="small-text muted">' + J.plural(J.data.apps.length, 'application') + ' tracked</span></div>' +
        (J.data.apps.length ? '<div class="board">' + cols + '</div>' : J.empty('No applications yet. Save a job from the <a href="#jobs">Job finder</a> or add one yourself.'));
    }
  };
  function appCard(a, si) {
    var done = J.CHECKLIST.filter(function (c) { return a.checklist[c[0]]; }).length, pct = Math.round(done / J.CHECKLIST.length * 100);
    var t = J.today(), deadlineSoon = a.deadline && a.stage === 'saved' && J.diff(t, a.deadline) <= 2;
    return '<article class="panel app-card' + (a.scam ? ' red' : '') + '"><h3>' + J.highlight(a.title, ui.aq.trim()) + '</h3><p>' + esc(a.company) + (a.city ? ' · ' + esc(a.city) : '') + '</p>' +
      '<p class="mono" style="font-size:11.5px">' + (a.appliedOn ? 'Applied ' + esc(J.fmt(a.appliedOn, { weekday: undefined })) : 'Added ' + esc(J.fmt(a.created || t, { weekday: undefined }))) +
        (a.deadline && a.stage === 'saved' ? '<br><span class="' + (deadlineSoon ? 'red-text' : 'gold-text') + '">Deadline ' + esc(J.dueLabel(a.deadline)) + '</span>' : '') +
        (a.interview && a.stage !== 'rejected' ? '<br><span class="gold-text">Interview ' + esc(J.dueLabel(a.interview.slice(0, 10), a.interview.slice(11, 16))) + '</span>' : '') + '</p>' +
      '<div style="display:grid;gap:4px"><span class="mono" style="font-size:10.5px;color:var(--dim)">CHECKLIST ' + done + '/' + J.CHECKLIST.length + '</span>' + J.bar(pct) + '</div>' +
      (a.scam ? '<p class="red-text">Mentions a fee or deposit: be careful.</p>' : '') + J.sampleTag(a) +
      '<div class="item-actions">' + (si > 0 ? J.iconBtn('appBack', a.id, 'Move back to ' + J.STAGES[si - 1][1], 'left') : '') + (si < 3 ? J.iconBtn('appFwd', a.id, 'Move to ' + J.STAGES[si + 1][1], 'right') : '') +
        (a.url ? '<a class="icon-btn" href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer" aria-label="Open job page for ' + esc(a.title) + ' (new tab)" title="Open job page"><svg viewBox="0 0 24 24" aria-hidden="true">' + J.ICON.open + '</svg></a>' : '') +
        J.iconBtn('openApp', a.id, 'Details, checklist and templates: ' + a.title, 'edit') + J.iconBtn('delApp', a.id, 'Delete ' + a.title, 'del', 'del') + '</div></article>';
  }
  J.forms.goal = function () { J.data.settings.weeklyGoal = J.clamp(Math.round(+$('#goalIn').value) || 0, 0, 50); J.commit(); J.toast('Weekly goal set to ' + J.data.settings.weeklyGoal + '.'); };
  function setStage(a, stage) {
    a.stage = stage; a.updated = J.today();
    if (stage === 'applied' && !a.appliedOn) { a.appliedOn = J.today(); a.checklist.submit = true; }
    J.syncAppTasks(a);
    J.commit();
  }
  J.setAppStage = setStage;
  Object.assign(J.actions, {
    appFwd: function (id) { move(id, 1); },
    appBack: function (id) { move(id, -1); },
    openApp: function (id) { var a = J.byId(J.data.apps, id); if (a) appDialog(a); },
    addApp: function () { appDialog(null); },
    delApp: function (id) {
      var a = J.byId(J.data.apps, id); if (!a) return;
      J.snapshot();
      J.data.apps = J.data.apps.filter(function (x) { return x.id !== id; });
      J.data.tasks = J.data.tasks.filter(function (t) { return t.appId !== id || t.status === 'done'; });
      J.commit(); J.toast('Deleted: ' + a.title, true);
    },
    copyTpl: function (id) {
      var el = document.getElementById(id); if (!el) return;
      copyText(el.textContent);
    }
  });
  function move(id, dir) {
    var a = J.byId(J.data.apps, id); if (!a) return;
    var order = J.STAGES.map(function (s) { return s[0]; }), i = order.indexOf(a.stage), n = J.clamp(i + dir, 0, order.length - 1);
    if (dir > 0 && i === 2) { // from Interview: offer or rejected
      J.confirm('Did you get an offer for ' + a.title + '?', 'Yes, an offer', 'Interview result').then(function (ok) {
        setStage(a, ok ? 'offer' : 'rejected');
        J.toast(ok ? 'Congratulations on the offer!' : 'Moved to Rejected. Keep going; the next one is closer.');
      });
      return;
    }
    setStage(a, order[n]);
    J.toast(a.title + ' → ' + J.stageName(a.stage) + (a.stage === 'interview' && !a.interview ? '. Add the interview date in details.' : '.'));
    var b = $('[data-act="' + (dir > 0 ? 'appFwd' : 'appBack') + '"][data-id="' + id + '"]') || $('[data-act="openApp"][data-id="' + id + '"]');
    if (b) b.focus();
  }
  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      J.toast(ok ? 'Copied. Paste it into your email or application.' : 'Select the text and copy it manually.');
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { J.toast('Copied. Paste it into your email or application.'); }, fallback);
    else fallback();
  }
  J.copyText = copyText;

  /* ================= templates ================= */
  function coverLetter(a) {
    var p = J.data.profile, name = p.name || 'Roshan';
    var skills = p.skills.slice(0, 4);
    var role = a.title || 'the advertised role', co = a.company || 'your company';
    return 'Dear Hiring Team at ' + co + ',\n\n' +
      'I am writing to apply for the ' + role + ' position' + (a.city && a.city !== 'Remote' && a.city !== 'UAE' ? ' in ' + a.city : '') + '. ' +
      'I am a ' + (p.degree ? p.degree + ' graduate' : 'recent graduate') + (p.university ? ' from ' + p.university : '') + (p.field && (!p.degree || p.degree.indexOf(p.field) < 0) ? ' in ' + p.field : '') + ', and I am keen to start my career in the UAE.\n\n' +
      (skills.length ? 'My key skills include ' + J.joinList(skills) + '. ' : '') + 'During my studies I applied these skills in practical projects, worked to deadlines, and learned to explain my work clearly to others.\n\n' +
      'I am excited by ' + co + '\'s work and would welcome the chance to contribute as ' + (/^[aeiou]/i.test(role) ? 'an ' : 'a ') + role + '. ' +
      (p.languages.length ? 'I speak ' + J.joinList(p.languages) + ', ' : '') + 'I am based in the UAE and available to start immediately.\n\n' +
      'Thank you for considering my application. I would be glad to discuss how I can help your team.\n\n' +
      'Kind regards,\n' + name;
  }
  function followUp(a) {
    var p = J.data.profile, name = p.name || 'Roshan';
    return 'Subject: Following up on my application: ' + (a.title || 'the role') + '\n\n' +
      'Dear Hiring Team,\n\n' +
      'I hope you are well. I applied for the ' + (a.title || 'advertised') + ' position at ' + (a.company || 'your company') + (a.appliedOn ? ' on ' + J.fmt(a.appliedOn, { weekday: 'long', day: 'numeric', month: 'long' }) : '') + ' and wanted to confirm my strong interest in the role.\n\n' +
      'I would be happy to share any further information or to arrange a call at a time that suits you.\n\n' +
      'Thank you for your time.\n\n' +
      'Kind regards,\n' + name;
  }
  J.coverLetter = coverLetter; J.followUp = followUp;

  function appDialog(a) {
    var x = a || { title: '', company: '', city: '', url: '', stage: 'saved', appliedOn: '', deadline: '', interview: '', notes: '', checklist: {} };
    var checks = '<fieldset style="border:0;padding:0;margin:0"><legend class="label" style="padding:0">Checklist</legend><ul class="checklist">' + J.CHECKLIST.map(function (c) {
      return '<li><label><input type="checkbox" data-check="' + c[0] + '"' + (x.checklist[c[0]] ? ' checked' : '') + '>' + esc(c[1]) + '</label></li>';
    }).join('') + '</ul></fieldset>';
    var tpls = a ? '<details style="margin-top:6px"><summary class="label" style="cursor:pointer;margin:0">Cover letter and follow-up templates</summary>' +
      '<div style="display:grid;gap:10px;margin-top:10px"><div class="panel-head" style="margin:0"><b>Cover letter</b><button type="button" class="btn small" data-act="copyTpl" data-id="tplCover">Copy</button></div><pre class="template" id="tplCover">' + esc(coverLetter(x)) + '</pre>' +
      '<div class="panel-head" style="margin:0"><b>Follow-up email</b><button type="button" class="btn small" data-act="copyTpl" data-id="tplFollow">Copy</button></div><pre class="template" id="tplFollow">' + esc(followUp(x)) + '</pre></div></details>' : '';
    J.openForm({
      title: a ? 'Application details' : 'Add application',
      fields: [
        { name: 'title', label: 'Job title', value: x.title, required: true, half: true, placeholder: 'Graduate Data Analyst' },
        { name: 'company', label: 'Company', value: x.company, required: true, half: true },
        { name: 'city', label: 'City', value: x.city, half: true, placeholder: 'Dubai' },
        { name: 'stage', label: 'Stage', type: 'select', options: J.STAGES, value: x.stage, half: true },
        { name: 'url', label: 'Official job page (https://…)', type: 'url', value: x.url, placeholder: 'https://' },
        { name: 'appliedOn', label: 'Date applied', type: 'date', value: x.appliedOn, half: true },
        { name: 'deadline', label: 'Application deadline', type: 'date', value: x.deadline, half: true, hint: 'Becomes a reminder at 9 am.' },
        { name: 'interview', label: 'Interview date and time', type: 'datetime-local', value: x.interview, hint: 'Becomes a timed reminder.' },
        { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, value: x.notes },
        { type: 'html', html: checks + tpls + (a && a.prep && J.matches ? J.matches.prepHTML(a) : '') }
      ],
      collect: function (v, root) { v.checklist = {}; $$('[data-check]', root).forEach(function (c) { if (c.checked) v.checklist[c.getAttribute('data-check')] = true; }); },
      validate: function (v) { if (v.url && !/^https?:\/\//i.test(v.url)) return 'The job page must start with https://'; },
      onSave: function (v) {
        var target = a || { id: J.uid(), created: J.today(), jobKey: '' };
        var wasStage = target.stage;
        Object.assign(target, { title: v.title, company: v.company, city: v.city, url: v.url, stage: v.stage, appliedOn: v.appliedOn, deadline: v.deadline, interview: v.interview, notes: v.notes, checklist: v.checklist, updated: J.today() });
        if (v.stage !== 'saved' && v.stage !== wasStage && !target.appliedOn) target.appliedOn = J.today();
        if (!a) J.data.apps.push(target);
        J.syncAppTasks(target);
        J.commit();
        J.toast(a ? 'Application updated.' : 'Application added.');
      }
    });
  }

  /* ================= public API (used by Today and voice) ================= */
  J.jobs = {
    cache: function () { return memCache; }, loading: function () { return loading; },
    refresh: refresh, ensure: ensure, reload: reload, init: init, loadStatic: loadStatic, onLoaded: onLoaded, eval: evalJob, byKey: byKey, all: allJobs, newJobs: newJobs, filter: filterJobs, save: save, isSaved: isSaved,
    searchLinks: searchLinks, sources: sources, endpoint: endpoint, keep: keep, finish: finish, normalize: normalizeJob, score: score
  };
})();

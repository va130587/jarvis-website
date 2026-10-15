#!/usr/bin/env node
/* Jarvis job collector. Plain Node (18+), no dependencies. Run by a GitHub Action every 6 hours, or by hand:
     node scripts/collect-jobs.js
   It reads data/sources.json, fetches OFFICIAL public job-board APIs (Greenhouse, Lever, Ashby) and one free public
   remote-jobs API, keeps UAE and region-friendly remote jobs that are fresher friendly, drops scams, and writes:
     data/jobs.json     the jobs, per-source status, statistics and an archive of expired jobs
     data/SOURCES.md    a readable table of which sources work
   It never needs a key or a login, and never writes secrets into any file. */
'use strict';
const fs = require('fs');
const path = require('path');
const Match = require('../match.js');

const ROOT = path.join(__dirname, '..');
const UA = 'jarvis-job-collector (personal job-search project; reads public job boards)';
const MAX_AGE_DAYS = 45;       // jobs older than this are archived
const ARCHIVE_KEEP_DAYS = 90;  // archived jobs are forgotten after this
const TEXT_LIMIT = 4000;

/* ---------------- small helpers ---------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isoDay = d => new Date(d).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b.slice(0, 10) + 'T12:00:00Z') - Date.parse(a.slice(0, 10) + 'T12:00:00Z')) / 864e5);
const clip = (s, n) => String(s || '').slice(0, n);

function htmlToText(html) {
  let t = String(html || '');
  // Greenhouse sends HTML as an escaped string: decode first so the tags can be removed.
  for (let i = 0; i < 2; i++) t = t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
  t = t.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ').replace(/<\s*li[^>]*>/gi, '• ').replace(/<\s*br\s*\/?>|<\s*\/\s*(p|div|li|h[1-6]|ul|ol|tr)\s*>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return t.replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------------- where is the job? ---------------- */
const UAE_CITIES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain', 'Al Ain'];
const UAE_RX = /\b(dubai|abu dhabi|sharjah|ajman|ras al[ -]khaimah|rak|fujairah|umm al[ -]quwain|al ain|uae|u\.a\.e|united arab emirates|difc|adgm|masdar|dubai internet city|jumeirah)\b/i;
const REGION_RX = /\b(uae|emea|middle east|mena|gcc|anywhere|worldwide|global|asia|apac)\b/i;
function cityOf(loc) {
  for (const c of UAE_CITIES) if (new RegExp('\\b' + c.replace(' ', '[ -]') + '\\b', 'i').test(loc)) return c;
  if (UAE_RX.test(loc)) return 'UAE';
  if (/remote/i.test(loc)) return 'Remote';
  return '';
}
function inScope(loc, remote) {
  if (UAE_RX.test(loc)) return true;
  if (remote || /remote/i.test(loc)) return REGION_RX.test(loc) || /^\s*remote\s*$/i.test(loc);
  return false;
}

/* ---------------- is it fresher friendly? ---------------- */
const FRESH_RX = /\b(intern|interns|internship|graduate|graduates|grad|new grad|trainee|traineeship|junior|jr\.?|entry[- ]level|entry|associate|fresher|freshers|apprentice|apprenticeship|early careers?|campus|student|working student)\b/i;
const SENIOR_RX = /\b(senior|sr\.?|lead|principal|staff|manager|director|head|vp|vice president|chief|architect|expert|iii|iv|distinguished)\b/i;
function levelOf(title, type) {
  const t = title + ' ' + (type || '');
  if (/\bintern(ship)?s?\b|apprentice|working student/i.test(t)) return 'intern';
  if (/\b(graduate|grad|campus|early careers?)\b/i.test(t)) return 'graduate';
  if (/\btrainee/i.test(t)) return 'trainee';
  return 'junior';
}
function keepJob(j, today) {
  if (!inScope(j.loc, j.remote)) return { keep: false, reason: 'not-uae' };
  if (Match.scamSign(j.title + ' ' + j.text)) return { keep: false, reason: 'scam' };
  const yrs = Match.parseYears(j.text);
  const titleFresh = FRESH_RX.test(j.title) || /intern/i.test(j.type || '');
  const looseFresh = yrs.fresh || (yrs.min != null && yrs.min <= 2);
  if (SENIOR_RX.test(j.title) && !/\b(intern|graduate|trainee)\b/i.test(j.title)) return { keep: false, reason: 'senior' };
  if (!titleFresh && !looseFresh) return { keep: false, reason: 'not-fresher' };
  if (yrs.min != null && yrs.min >= 4 && !/\b(intern|graduate|trainee)\b/i.test(j.title)) return { keep: false, reason: 'senior' };
  if (j.date && dayDiff(j.date, today) > MAX_AGE_DAYS) return { keep: false, reason: 'old' };
  return { keep: true };
}

/* ---------------- one normalised job from each kind of source ---------------- */
function salaryText(cur, min, max, interval) {
  if (!min && !max) return '';
  const c = String(cur || '').toUpperCase();
  return (c ? c + ' ' : '') + (min && max && min !== max ? min + '–' + max : (max || min)) + (interval ? ' per ' + String(interval).toLowerCase().replace(/^per[- ]/, '').replace(/-salary$/, '') : '');
}
function normalizeJob(src, raw) {
  let j;
  if (src.type === 'greenhouse' || src.type === 'greenhouse-eu') {
    const offices = (raw.offices || []).map(o => o.location || o.name).filter(Boolean).join(' / ');
    j = { id: raw.id, title: raw.title, url: raw.absolute_url, loc: [raw.location && raw.location.name, offices].filter(Boolean).join(' / '), date: raw.first_published || raw.updated_at || '', type: '', remote: false, dept: (raw.departments || []).map(d => d.name).join(', '), text: htmlToText(raw.content), salary: '' };
  } else if (src.type === 'lever') {
    const c = raw.categories || {}, sr = raw.salaryRange;
    j = { id: raw.id, title: raw.text, url: raw.hostedUrl || raw.applyUrl, loc: [c.location].concat(c.allLocations || []).filter(Boolean).join(' / '), date: raw.createdAt ? new Date(raw.createdAt).toISOString() : '', type: c.commitment || '', remote: raw.workplaceType === 'remote', dept: c.team || c.department || '', text: String(raw.descriptionPlain || htmlToText(raw.description)) + '\n' + (raw.lists || []).map(l => (l.text || '') + '\n' + htmlToText(l.content)).join('\n'), salary: sr ? salaryText(sr.currency, sr.min, sr.max, sr.interval) : '' };
  } else if (src.type === 'ashby') {
    const locs = [raw.location].concat((raw.secondaryLocations || []).map(l => l.location)).filter(Boolean).join(' / ');
    j = { id: raw.id, title: raw.title, url: raw.jobUrl || raw.applyUrl, loc: locs, date: raw.publishedAt || '', type: raw.employmentType || '', remote: !!raw.isRemote || /remote/i.test(raw.workplaceType || ''), dept: raw.department || raw.team || '', text: String(raw.descriptionPlain || htmlToText(raw.descriptionHtml)), salary: raw.compensation && raw.compensation.compensationTierSummary ? String(raw.compensation.compensationTierSummary) : '' };
  } else if (src.type === 'remotive') {
    j = { id: raw.id, title: raw.title, url: raw.url, loc: raw.candidate_required_location || '', date: raw.publication_date || '', type: raw.job_type || '', remote: true, dept: raw.category || '', text: htmlToText(raw.description), salary: raw.salary || '', company: raw.company_name };
  } else return null;
  if (!j.title || !j.url || !/^https:\/\//i.test(j.url)) return null;
  j.company = j.company || src.name;
  j.key = src.id + ':' + j.id;
  j.source = src.id;
  j.sourceName = src.type === 'remotive' ? 'Remotive' : ({ greenhouse: 'Greenhouse', 'greenhouse-eu': 'Greenhouse', lever: 'Lever', ashby: 'Ashby' })[src.type];
  return j;
}
function finishJob(j) {
  const type = j.type ? String(j.type).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() : '';
  return {
    key: j.key, title: clip(j.title, 160), company: j.company, city: cityOf(j.loc) || (j.remote ? 'Remote' : 'UAE'), country: UAE_RX.test(j.loc) ? 'UAE' : (j.remote ? 'Remote' : ''),
    location: clip(j.loc, 160), remote: !!j.remote || (!UAE_RX.test(j.loc) && /remote/i.test(j.loc)), type: type ? type.charAt(0).toUpperCase() + type.slice(1) : '', level: levelOf(j.title, j.type),
    date: j.date ? isoDay(j.date) : '', url: j.url, dept: clip(j.dept, 80), salary: clip(j.salary, 80), text: clip(j.text, TEXT_LIMIT), source: j.source, sourceName: j.sourceName
  };
}
function dedupe(jobs) {
  const seen = new Map(), out = [];
  let dupes = 0;
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  jobs.forEach(j => {
    const k = norm(j.company) + '|' + norm(j.title) + '|' + norm(j.city);
    if (seen.has(k)) { dupes++; const i = seen.get(k); if ((j.date || '') > (out[i].date || '')) out[i] = j; return; }
    seen.set(k, out.length); out.push(j);
  });
  return { jobs: out, dupes };
}

/* ---------------- fetching ---------------- */
function endpoint(src) {
  const s = encodeURIComponent(src.slug || '');
  switch (src.type) {
    case 'greenhouse': return 'https://boards-api.greenhouse.io/v1/boards/' + s + '/jobs?content=true';
    case 'greenhouse-eu': return 'https://boards-api.eu.greenhouse.io/v1/boards/' + s + '/jobs?content=true';
    case 'lever': return 'https://api.lever.co/v0/postings/' + s + '?mode=json';
    case 'ashby': return 'https://api.ashbyhq.com/posting-api/job-board/' + s + '?includeCompensation=true';
    case 'remotive': return 'https://remotive.com/api/remote-jobs';
    default: return '';
  }
}
async function realFetchJson(url, { retries = 2, timeout = 25000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 404) { const e = new Error('Board not found (HTTP 404)'); e.http = 404; e.final = true; throw e; }
      if (res.status === 429 || res.status >= 500) { const e = new Error('HTTP ' + res.status); e.http = res.status; throw e; }
      if (!res.ok) { const e = new Error('HTTP ' + res.status); e.http = res.status; e.final = true; throw e; }
      let data;
      try { data = await res.json(); } catch (x) { const e = new Error('Not valid JSON'); e.final = true; throw e; }
      return { data, http: res.status };
    } catch (e) {
      lastErr = e.name === 'AbortError' ? Object.assign(new Error('Timed out'), { http: 0 }) : e;
      if (lastErr.final || attempt === retries) break;
      await sleep(1500 * (attempt + 1));
    } finally { clearTimeout(timer); }
  }
  throw lastErr;
}
function listFrom(src, data) {
  if (src.type === 'lever') return Array.isArray(data) ? data : null;
  if (Array.isArray(data && data.jobs)) return data.jobs;
  return null;
}

/* ---------------- alerts (ntfy.sh) ---------------- */
function alertProfile(env) {
  const list = v => String(v || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
  return { titles: list(env.ALERT_TITLES), skills: Match.parseSkillList(env.ALERT_SKILLS).map(s => s.name), skillLevels: Object.fromEntries(Match.parseSkillList(env.ALERT_SKILLS).map(s => [s.name, s.level])),
    cities: list(env.ALERT_CITIES), visa: env.ALERT_VISA || 'resident', yearsExp: parseFloat(env.ALERT_YEARS) || 0, nationality: env.ALERT_NATIONALITY || '', degree: env.ALERT_DEGREE || '', field: env.ALERT_FIELD || '', languages: list(env.ALERT_LANGUAGES) };
}
function buildNtfy({ topic, jobs, siteUrl, server }) {
  if (!topic || !jobs.length) return null;
  const top = jobs.slice(0, 5);
  const lines = top.map(x => '• ' + x.score + '%  ' + x.job.title + ' at ' + x.job.company + ' (' + x.job.city + ')');
  if (jobs.length > top.length) lines.push('…and ' + (jobs.length - top.length) + ' more');
  return {
    url: (server || 'https://ntfy.sh').replace(/\/+$/, '') + '/',
    body: { topic: String(topic), title: 'Jarvis: ' + jobs.length + ' new job match' + (jobs.length === 1 ? '' : 'es'), message: lines.join('\n'), click: top[0].job.url || siteUrl || undefined, tags: ['briefcase'], priority: 3,
      actions: siteUrl ? [{ action: 'view', label: 'Open Jarvis', url: siteUrl + '#matches' }] : undefined }
  };
}
function alertsFor(newJobs, env) {
  const min = parseFloat(env.ALERT_MIN_SCORE) || 70, P = alertProfile(env);
  return newJobs.map(job => ({ job, r: Match.evaluate(job, P, { today: isoDay(Date.now()) }) })).filter(x => x.r.verdict !== 'no' && x.r.score >= min)
    .map(x => ({ job: x.job, score: x.r.score })).sort((a, b) => b.score - a.score);
}

/* ---------------- SOURCES.md ---------------- */
function sourcesMd(statuses, generatedAt) {
  const rows = statuses.map(s => '| ' + [s.name, s.type, '`' + (s.slug || '') + '`', s.checkedAt ? s.checkedAt.slice(0, 16).replace('T', ' ') + ' UTC' : 'not checked yet',
    s.enabled === false ? 'turned off' : s.status === 'ok' ? '✅ works' : s.status === 'failed' ? '❌ ' + (s.error || 'failed') : s.status === 'skipped' ? '⏭ skipped (checked recently)' : '⏳ not checked yet', s.status === 'ok' || s.status === 'skipped' ? s.listed : '', s.status === 'ok' || s.status === 'skipped' ? s.kept : ''].join(' | ') + ' |');
  const ok = statuses.filter(s => s.status === 'ok' || s.status === 'skipped').length;
  return ['# Job sources', '', 'This file is written by `scripts/collect-jobs.js` every time the collector runs. Do not edit it by hand.',
    '', generatedAt ? '**Last run:** ' + generatedAt.slice(0, 16).replace('T', ' ') + ' UTC · **' + ok + ' of ' + statuses.length + ' sources work**' : '**Not run yet.** Turn on the GitHub Action (see the README) and this table fills in.', '',
    'A source can fail because the company has no public board with that name (HTTP 404), the company moved to another system, or the service was down. Failed sources are skipped quietly. After 4 failures in a row a source is only retried on Mondays. To fix a wrong board name, edit `data/sources.json`.', '',
    '| Company | Board type | Board name | Last checked | Status | Jobs listed | Kept for you |', '| --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n');
}

/* ---------------- the run ---------------- */
function meaningful(out) { return JSON.stringify([Object.assign({}, out.stats, { newCount: 0 }), out.sources.map(s => [s.id, s.status === 'skipped' ? 'ok' : s.status, s.listed, s.kept, s.error, s.failStreak || 0]), out.jobs.map(j => j.key + j.title), out.archived.length]); }
async function runCollect(opts) {
  const env = opts.env || process.env, dataDir = opts.dataDir || path.join(ROOT, 'data'), now = opts.now || new Date();
  const fetchJson = opts.fetchJson || realFetchJson, post = opts.post, log = opts.log || (() => {}), delay = opts.delay == null ? 400 : opts.delay;
  const today = isoDay(now), nowIso = now.toISOString();
  const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'sources.json'), 'utf8'));
  let prev = { jobs: [], archived: [], sources: [] };
  try { prev = Object.assign(prev, JSON.parse(fs.readFileSync(path.join(dataDir, 'jobs.json'), 'utf8'))); } catch (e) { /* first run */ }
  const prevStatus = {}; (prev.sources || []).forEach(s => { prevStatus[s.id] = s; });
  const isMonday = now.getUTCDay() === 1;

  const statuses = [], collected = [], hidden = { 'not-uae': 0, 'not-fresher': 0, senior: 0, scam: 0, old: 0, duplicate: 0 };
  let scanned = 0;
  const failedOrSkipped = new Set(), succeeded = new Set();
  let networkFails = 0, outage = false;
  for (const src of cfg.sources) {
    const ps = prevStatus[src.id] || {};
    const st = { id: src.id, name: src.name, type: src.type, slug: src.slug, enabled: src.enabled !== false, status: 'pending', listed: 0, kept: 0, error: '', http: 0, checkedAt: ps.checkedAt || '', failStreak: ps.failStreak || 0 };
    statuses.push(st);
    if (!st.enabled) { st.status = 'off'; continue; }
    if (opts.only && opts.only !== src.id) { st.status = ps.status || 'pending'; st.listed = ps.listed || 0; st.kept = ps.kept || 0; st.error = ps.error || ''; failedOrSkipped.add(src.id); continue; }
    if (src.everyHours && ps.checkedAt && ps.status === 'ok' && (now - Date.parse(ps.checkedAt)) < src.everyHours * 3600e3) {
      st.status = 'skipped'; st.listed = ps.listed; st.kept = ps.kept; st.hiddenBy = ps.hiddenBy || {}; scanned += ps.listed || 0;
      Object.keys(st.hiddenBy).forEach(r => { hidden[r] = (hidden[r] || 0) + st.hiddenBy[r]; });
      failedOrSkipped.add(src.id); continue; // recent enough: keep the jobs we already have
    }
    if (st.failStreak >= 4 && !isMonday && !opts.all) { st.status = 'failed'; st.error = ps.error || 'failed several times'; failedOrSkipped.add(src.id); continue; }
    if (outage) { st.status = 'failed'; st.error = 'Not tried: the network looked down'; failedOrSkipped.add(src.id); continue; }
    try {
      const { data, http } = await fetchJson(endpoint(src));
      const list = listFrom(src, data);
      if (!list) throw new Error('Unexpected response (no job list)');
      st.http = http; st.listed = list.length; scanned += list.length;
      let kept = 0; st.hiddenBy = {};
      for (const raw of list) {
        const j = normalizeJob(src, raw);
        if (!j) continue;
        const k = keepJob(j, today);
        if (!k.keep) { hidden[k.reason] = (hidden[k.reason] || 0) + 1; st.hiddenBy[k.reason] = (st.hiddenBy[k.reason] || 0) + 1; continue; }
        collected.push(finishJob(j)); kept++;
      }
      st.kept = kept; st.status = 'ok'; st.failStreak = 0; st.checkedAt = nowIso; succeeded.add(src.id); networkFails = 0;
      log('ok ' + src.id + ': ' + list.length + ' listed, ' + kept + ' kept');
    } catch (e) {
      st.status = 'failed'; st.error = String(e.message || e); st.http = e.http || 0; st.checkedAt = nowIso; failedOrSkipped.add(src.id);
      if (!st.http || st.http >= 500) { networkFails++; st.failStreak = ps.failStreak || 0; } // a network problem is not the board's fault
      else st.failStreak = (ps.failStreak || 0) + 1;
      if (networkFails >= 6 && !succeeded.size) outage = true;
      log('FAILED ' + src.id + ': ' + st.error);
    }
    if (delay) await sleep(delay);
  }

  if (!succeeded.size && !statuses.some(s => s.status === 'skipped')) {
    return { wrote: false, reason: 'No source could be reached. Existing data was left as it is.', statuses, out: null };
  }
  const dd = dedupe(collected); hidden.duplicate = dd.dupes;
  const fresh = dd.jobs;
  // Merge with the last run: keep first-seen dates, archive jobs that disappeared or got old, never drop jobs of sources that failed.
  const prevJobs = new Map((prev.jobs || []).map(j => [j.key, j]));
  const seenNow = new Set(fresh.map(j => j.key));
  const jobs = fresh.map(j => { const o = prevJobs.get(j.key); return Object.assign({}, j, { firstSeen: o ? o.firstSeen : today, firstSeenAt: o ? (o.firstSeenAt || o.firstSeen) : nowIso, lastSeen: today }); });
  const archived = (prev.archived || []).filter(a => dayDiff(a.archivedAt, today) <= ARCHIVE_KEEP_DAYS);
  const archive = (j, reason) => archived.push({ key: j.key, title: j.title, company: j.company, city: j.city, url: j.url, firstSeen: j.firstSeen, lastSeen: j.lastSeen, archivedAt: today, reason });
  (prev.jobs || []).forEach(o => {
    if (seenNow.has(o.key)) return;
    if (succeeded.has(o.source)) { const posted = o.date || o.firstSeen; archive(o, posted && dayDiff(posted, today) > MAX_AGE_DAYS ? 'old' : 'removed'); return; } // taken down, or too old to keep
    if (failedOrSkipped.has(o.source) || !cfg.sources.some(s => s.id === o.source)) jobs.push(o); // source unreachable right now: keep
  });
  const live = [];
  jobs.forEach(j => { const posted = j.date || j.firstSeen; if (posted && dayDiff(posted, today) > MAX_AGE_DAYS) archive(j, 'old'); else live.push(j); });
  live.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
  const known = new Set((prev.jobs || []).map(j => j.key).concat((prev.archived || []).map(j => j.key)));
  const newJobs = live.filter(j => !known.has(j.key));
  const out = { schema: 1, generatedAt: nowIso, stats: { scanned, kept: live.length, hidden, newCount: newJobs.length, archived: archived.length }, sources: statuses, jobs: live, archived: archived.slice(-500) };

  const same = prev.jobs && meaningful(out) === meaningful({ stats: prev.stats || {}, sources: prev.sources || [], jobs: prev.jobs || [], archived: prev.archived || [] });
  const stale = !prev.generatedAt || (now - Date.parse(prev.generatedAt)) > 24 * 3600e3;
  let wrote = false;
  if (!opts.dry && (!same || stale)) {
    fs.writeFileSync(path.join(dataDir, 'jobs.json'), JSON.stringify(out) + '\n');
    fs.writeFileSync(path.join(dataDir, 'SOURCES.md'), sourcesMd(statuses, nowIso));
    wrote = true;
  }
  let alert = null;
  const strong = alertsFor(newJobs, env);
  if (strong.length && env.NTFY_TOPIC) {
    alert = buildNtfy({ topic: env.NTFY_TOPIC, jobs: strong, siteUrl: env.SITE_URL, server: env.NTFY_SERVER });
    if (alert && post && !opts.dry) { try { await post(alert.url, alert.body); } catch (e) { log('Alert could not be sent: ' + e.message); } }
  }
  return { wrote, out, statuses, newJobs, alert, strongCount: strong.length };
}

async function main() {
  const args = process.argv.slice(2), has = f => args.includes(f);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
  const post = async (url, body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('ntfy answered HTTP ' + res.status);
  };
  const r = await runCollect({ dry: has('--dry'), all: has('--all'), only, post, log: m => console.log(m) });
  const ok = r.statuses.filter(s => s.status === 'ok').length, failed = r.statuses.filter(s => s.status === 'failed').length;
  if (!r.out) { console.log('::warning::' + r.reason); return; }
  console.log('Sources: ' + ok + ' ok, ' + failed + ' failed. Jobs kept: ' + r.out.stats.kept + ' (' + r.out.stats.newCount + ' new). ' + (r.wrote ? 'Files written.' : 'No changes to write.') + (r.alert ? ' Phone alert sent for ' + r.strongCount + ' job(s).' : ''));
}
if (require.main === module) main().catch(e => { console.error('::error::' + e.message); process.exit(1); });

module.exports = { runCollect, normalizeJob, finishJob, keepJob, dedupe, htmlToText, endpoint, buildNtfy, alertsFor, alertProfile, sourcesMd, cityOf, inScope, levelOf, listFrom, MAX_AGE_DAYS };

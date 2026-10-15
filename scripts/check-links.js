#!/usr/bin/env node
/* Checks that the free learning links in match.js still open. Writes data/links-status.json.
   Runs at most once a week (it skips itself if the file is newer than 7 days). Usage: node scripts/check-links.js [--force] */
'use strict';
const fs = require('fs');
const path = require('path');
const Match = require('../match.js');
const FILE = path.join(__dirname, '..', 'data', 'links-status.json');

async function check(url) {
  for (const method of ['HEAD', 'GET']) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'jarvis-link-check' } });
      if (res.ok) return { ok: true, http: res.status };
      if (method === 'GET' || ![403, 404, 405, 429, 501].includes(res.status)) return { ok: false, http: res.status };
    } catch (e) { if (method === 'GET') return { ok: false, http: 0, error: e.name === 'AbortError' ? 'timed out' : e.message }; }
    finally { clearTimeout(timer); }
  }
  return { ok: false, http: 0 };
}
async function main() {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* none yet */ }
  if (!process.argv.includes('--force') && prev && prev.checkedAt && Date.now() - Date.parse(prev.checkedAt) < 7 * 864e5) { console.log('Links were checked less than a week ago.'); return; }
  const urls = [...new Set(Match.SKILLS.flatMap(s => s.learn.map(l => l[1])))];
  const results = {};
  for (const u of urls) { results[u] = await check(u); await new Promise(r => setTimeout(r, 300)); }
  const broken = Object.keys(results).filter(u => !results[u].ok);
  if (broken.length === urls.length) { console.log('::warning::No learning link could be reached (network problem?). Results not saved.'); return; }
  fs.writeFileSync(FILE, JSON.stringify({ checkedAt: new Date().toISOString(), ok: urls.length - broken.length, broken: broken.map(u => ({ url: u, http: results[u].http, error: results[u].error || '' })) }, null, 1) + '\n');
  console.log(urls.length - broken.length + ' of ' + urls.length + ' learning links open.' + (broken.length ? ' Broken: ' + broken.join(', ') : ''));
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(0); });
module.exports = { check };

#!/usr/bin/env node
// How well does a provider understand normal language? Runs tests/nlu-eval-set.json against it and scores the FIRST step it proposes
// (which tool, with which arguments, or "ask a question", or "just talk"). Nothing is executed.
//   npm run eval:nlu                         built-in patterns only (the baseline: shows what keywords alone can do)
//   NOVA_OLLAMA_MODEL=qwen2.5:7b node scripts/eval-nlu.js --provider ollama     your local model (Ollama must be running)
//   add --min 0.8 to fail below 80%, --verbose to see every case, --json for machine-readable output
'use strict';
const path = require('path');
const { createApp } = require('../server');
const { matchIntent } = require('../server/agent/planner');
const { validate } = require('../server/agent/schema');
const SET = require('../tests/nlu-eval-set.json');

async function run(opts) {
  opts = opts || {};
  const which = opts.provider || 'rules';
  const env = { AUTH_MODE: 'dev', OWNER_EMAILS: 'eval@example.com', NOVA_DB: ':memory:', PORT: '0', NOVA_AI_PROVIDER: which === 'ollama' ? 'ollama' : 'local' };
  const app = createApp(env, opts.deps || {});
  const db = app.db, now = Date.parse('2026-10-20T08:00:00+04:00');
  app.cfg.now = () => now;
  db.prepare("INSERT INTO users (email, display_name, created_at) VALUES ('eval@example.com', 'Eval', ?)").run(now);
  const user = db.prepare('SELECT * FROM users WHERE id = 1').get();
  for (const t of [['Call HR', '2026-10-23'], ['Send the proposal to the client', '2026-10-23'], ['Buy milk', null]]) db.prepare('INSERT INTO tasks (user_id, title, due, created_at) VALUES (1, ?, ?, ?)').run(t[0], t[1], now);
  for (const m of ['I like green tea', 'My project is Atlas']) db.prepare("INSERT INTO memories (user_id, kind, text, source, created_at, updated_at) VALUES (1, 'fact', ?, 'eval', ?, ?)").run(m, now, now);
  const provider = opts.provider === 'ollama' || opts.deps && opts.deps.provider ? app.provider : null;
  const results = [];
  for (const c of SET) {
    let got = { tool: null, input: null, text: null, error: null };
    try {
      if (!provider) { const i = matchIntent(c.text, { db, user, now: () => now }); if (i && i.call) got = { tool: i.call.name, input: i.call.input }; else if (i && i.final) got = { text: i.final }; else got = { text: '(no pattern matched)' }; }
      else {
        const mem = app.memory.retrieve({ id: 1, personalization: 1 }, c.text, 5);
        const d = await provider.plan({ system: { stable: require('../server/agent/agent').STABLE, perUser: app.agent.planContext({ id: 1, display_name: 'Eval' }, mem) }, messages: [{ role: 'user', content: c.text }], tools: app.registry.forModel() });
        if (d.kind === 'call') { const name = app.registry.fromModelName(d.name), tool = app.registry.get(name); const v = tool ? validate(tool.schema, d.input === undefined ? {} : d.input) : { ok: false, error: 'unknown tool' }; got = { tool: name, input: d.input, invalid: v.ok ? null : v.error }; }
        else got = { text: d.text };
      }
    } catch (e) { got.error = (e.userMessage || e.message).slice(0, 160); }
    results.push(Object.assign({ c }, score(c.expect, got), { got }));
  }
  await app.close();
  return results;
}

function score(exp, got) {
  if (got.error) return { pass: false, why: 'error: ' + got.error };
  const argText = JSON.stringify(got.input || {}).toLowerCase();
  if (exp.forbid) return { pass: !(got.tool && exp.forbid.includes(got.tool)), why: got.tool && exp.forbid.includes(got.tool) ? 'proposed forbidden tool ' + got.tool : '' };
  if (got.invalid) return { pass: false, why: 'invalid input: ' + got.invalid };
  if (exp.clarify) return { pass: got.tool === 'ask.clarify', why: got.tool ? 'proposed ' + got.tool + ' instead of asking' : 'answered instead of asking' };
  if (exp.none) return { pass: !got.tool && !!got.text && !/no pattern matched/.test(got.text) || (got.tool === 'ask.clarify'), why: got.tool ? 'used tool ' + got.tool : 'no answer' };
  if (exp.anyOf) return { pass: exp.anyOf.includes(got.tool), why: 'proposed ' + (got.tool || 'nothing') };
  if (got.tool !== exp.tool) return { pass: false, why: 'proposed ' + (got.tool || 'nothing') + ', expected ' + exp.tool };
  if (exp.id !== undefined && (got.input || {}).id !== exp.id) return { pass: false, why: 'wrong id ' + (got.input || {}).id + ', expected ' + exp.id };
  for (const w of exp.titleIncludes || []) if (!argText.includes(w)) return { pass: false, why: 'arguments miss "' + w + '"' };
  if (exp.hasDue && !(got.input && got.input.due)) return { pass: false, why: 'no due date' };
  return { pass: true, why: '' };
}

function report(results, o) {
  const by = {}; results.forEach(r => { const k = r.c.category; (by[k] = by[k] || { n: 0, ok: 0 }).n++; if (r.pass) by[k].ok++; });
  const ok = results.filter(r => r.pass).length, total = results.length;
  if (o.json) return JSON.stringify({ passed: ok, total, accuracy: ok / total, byCategory: by, failures: results.filter(r => !r.pass).map(r => ({ id: r.c.id, text: r.c.text, why: r.why })) }, null, 2);
  let out = 'NLU eval: ' + ok + '/' + total + ' (' + Math.round(ok / total * 100) + '%)\n\n' + Object.keys(by).map(k => '  ' + k.padEnd(10) + by[k].ok + '/' + by[k].n).join('\n') + '\n';
  const bad = results.filter(r => !r.pass);
  if (bad.length && (o.verbose || bad.length <= 15)) out += '\nMissed:\n' + bad.map(r => '  #' + r.c.id + ' "' + r.c.text + '"  ' + r.why).join('\n') + '\n';
  else if (bad.length) out += '\n' + bad.length + ' missed (use --verbose to list them)\n';
  return out;
}

if (require.main === module) {
  const a = process.argv.slice(2), arg = n => { const i = a.indexOf('--' + n); return i < 0 ? null : (a[i + 1] && !a[i + 1].startsWith('--') ? a[i + 1] : true); };
  run({ provider: arg('provider') || 'rules' }).then(r => {
    console.log(report(r, { verbose: !!arg('verbose'), json: !!arg('json') }));
    const min = parseFloat(arg('min')); if (min && r.filter(x => x.pass).length / r.length < min) process.exit(1);
  }).catch(e => { console.error(e.message); process.exit(1); });
}
module.exports = { run, score, report };

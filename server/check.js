// "Check my setup": plain-words checks of this NOVA, for the Help page. Read-only: it changes nothing and returns no secrets, paths or addresses.
// Each check is "ok", "attention" (something to fix, with the exact next step) or "not_set_up" (optional, with why that is fine).
'use strict';
const { problem } = require('../scripts/check-node');

function createCheck(cfg, db, { provider, scheduler }) {
  const ok = (id, name, message) => ({ id, name, status: 'ok', message });
  const attention = (id, name, message, next) => ({ id, name, status: 'attention', message, next });
  const off = (id, name, message, why) => ({ id, name, status: 'not_set_up', message, why });

  function node() {
    const v = process.versions.node, p = problem(v);
    return p ? attention('node', 'Node.js', 'This computer has Node.js ' + v + ', which is too old.', 'Go to nodejs.org, download the "LTS" version, install it, then start NOVA again.') : ok('node', 'Node.js', 'Node.js ' + v + ' is new enough.');
  }
  function database() {
    try { db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); return ok('database', 'Your data', 'NOVA can read and save your data.'); }
    catch (e) { try { db.exec('ROLLBACK'); } catch (x) { /* nothing was open */ } return attention('database', 'Your data', 'NOVA cannot save your data right now.', 'Close other programs that use the NOVA folder, make sure the disk is not full, then restart NOVA.'); }
  }
  function schedule() {
    if (!cfg.scheduler.enabled) return off('scheduler', 'Daily jobs', 'Daily jobs are switched off.', 'That is fine. You can still run any job by hand in the Automation Centre.');
    return scheduler.running() ? ok('scheduler', 'Daily jobs', 'The daily briefing and other jobs are running on time (Dubai time).')
      : attention('scheduler', 'Daily jobs', 'The daily jobs are not running.', 'Stop NOVA and start it again with "npm run demo" or "npm start".');
  }
  function notifications() {
    return ok('notifications', 'Notifications', cfg.ntfy.topic ? 'Notifications appear in NOVA and are also sent to your phone.' : 'Notifications appear in NOVA (the bell). Phone alerts are not set up, and that is fine.');
  }
  function gmail(user) {
    const c = db.prepare("SELECT status FROM connections WHERE user_id = ? AND provider = 'gmail'").get(user.id);
    if (!c) return off('gmail', 'Gmail', 'Gmail is not connected.', 'That is fine. NOVA works with demo e-mail until you connect Gmail (read-only) in Connected Apps.');
    return c.status === 'connected' ? ok('gmail', 'Gmail', 'Gmail is connected (read-only).') : attention('gmail', 'Gmail', 'Gmail needs to be connected again.', 'Open Connected Apps and press Connect Gmail.');
  }
  async function ai() {
    if (cfg.ai.provider === 'ollama' && provider.health) {
      const h = await provider.health();
      if (!h.reachable) return attention('ai', 'AI model', 'The free AI model (Ollama) cannot be reached.', 'Start Ollama ("ollama serve"), or switch it off and use the built-in rules.');
      return h.modelPulled ? ok('ai', 'AI model', 'The free AI model (Ollama) is ready.') : attention('ai', 'AI model', 'Ollama is running, but the model is not downloaded yet.', 'Run "ollama pull ' + cfg.ai.ollamaModel + '" once.');
    }
    if (cfg.ai.provider === 'claude') return provider.available() ? ok('ai', 'AI model', 'The Claude model is set up.') : attention('ai', 'AI model', 'Claude is chosen but not set up.', 'Add the key in the settings file, or go back to the free built-in rules.');
    return off('ai', 'AI model', 'NOVA is using its free built-in rules.', 'That is fine. Everything works. A free local model (Ollama) only adds more natural wording.');
  }

  async function run(user) {
    const checks = [node(), database(), schedule(), notifications(), gmail(user)];
    try { checks.push(await ai()); } catch (e) { checks.push(attention('ai', 'AI model', 'The AI model could not be checked.', 'Try again in a moment.')); }
    const n = checks.filter(c => c.status === 'attention').length;
    return { checks, attention: n, summary: n ? n + (n === 1 ? ' thing needs' : ' things need') + ' your attention.' : 'Everything that needs to work is working.' };
  }
  function register(router) { router.get('/api/check', async ctx => ({ status: 200, body: await run(ctx.auth.user) })); }
  return { register, run };
}
module.exports = { createCheck };

// Screenshots of the new features, in both themes at 390 and 1440 px, on the fictional demo data:
//   node scripts/new-feature-shots.js [out-dir]        (default docs/screenshots/after/new-features)
// Quick capture, the Gmail step by step guide, Can people rely on me?, What if I say yes?, Weekly Review, energy marks, Decision Journal,
// Life Timeline and What NOVA knows about me.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('../tests/helpers');
const { createApp } = require('../server');
const { seed, EMAIL } = require('./demo');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'docs', 'screenshots', 'after', 'new-features'));
const COMBOS = [[1440, 'dark'], [1440, 'light'], [390, 'dark'], [390, 'light']];
const theme = t => (t === 'light' ? "try { localStorage.setItem('nova.theme', 'light'); } catch (e) {}" : '');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await H.launch(), made = [];
  for (const [w, t] of COMBOS) {
    const app = createApp({ NOVA_DB: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nova-nf-')), 'n.db'), AUTH_MODE: 'dev', OWNER_EMAILS: EMAIL, HOST: '127.0.0.1', PORT: '0', BASE_URL: '', NOVA_DEMO: '1', NOVA_SECRET_KEY: 'demo-only-key-not-for-real-accounts', GOOGLE_CLIENT_ID: 'demo', GOOGLE_CLIENT_SECRET: 'demo', NOVA_RATE_API_MAX: '100000', NOVA_RATE_AUTH_MAX: '100000', NOVA_RATE_CHAT_MAX: '100000' });
    seed(app); const base = 'http://127.0.0.1:' + await app.listen();
    const o = await H.openApp(browser, { base, hash: '', width: w, height: 900, init: theme(t) }), p = o.page;
    await p.waitForFunction(() => window.NOVA && NOVA.mode !== 'unknown'); await p.fill('#novaDevEmail', EMAIL); await p.click('#novaDevForm button');
    await p.waitForFunction(() => window.NOVA && NOVA.user && window.J && J.current() === 'dashboard');
    const shot = async (sel, name) => { const f = path.join(OUT, name + '-' + w + '-' + t + '.jpg'); await (sel ? p.locator(sel).first() : p).screenshot({ path: f, type: 'jpeg', quality: 72 }); made.push(path.basename(f)); };
    const go = async (hash, sel) => { await p.evaluate(h => { location.hash = h; }, hash); await p.waitForSelector(sel); await p.waitForTimeout(700); };

    await p.evaluate(() => NOVA.capture.open('call Sara tomorrow 3pm, AED 40 lunch, note: visa photos need a white background, I promised Sam the slides by Friday, 40 aed, delete my tasks'));
    await p.waitForSelector('#captureDialog[open] .cap-row'); await p.waitForTimeout(500); await shot('#captureDialog .cap-card', 'quick-capture'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await go('email', '#gmGuide'); await shot('#gmGuide', 'gmail-guide');
    await go('proofloop', '#trustPanel .trust-side, #trustPanel .empty'); await shot('#trustPanel', 'can-people-rely-on-me');
    await go('whatif', '#wiText'); await p.fill('#wiText', 'Join the workshop tomorrow 2pm to 5pm'); await p.keyboard.press('Enter'); await p.waitForSelector('#wiResult'); await p.waitForTimeout(500); await shot('#main', 'what-if-i-say-yes');
    await go('weekreview', '#wr-done'); await shot('#main', 'weekly-review');
    await go('focus', '#energyPanel .en-row'); await shot('#energyPanel', 'energy-marks');
    await go('journal', '#jnForm'); await p.waitForFunction(() => !/Loading…/.test(document.querySelector('main').innerText)); await shot('#main', 'decision-journal');
    await go('timeline', '.tl-day'); await shot('#main', 'life-timeline');
    await go('privacy', '#pv-counts'); await shot('#main', 'privacy');
    await o.ctx.close(); app.server.closeAllConnections(); await app.close();
  }
  await browser.close(); console.log(made.length + ' screenshots in ' + OUT); made.forEach(m => console.log('  ' + m));
}
main().catch(e => { console.error(e); process.exit(1); });

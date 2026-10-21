// A plain-words check that Node.js is new enough, run first by `npm start` and `npm run demo`. Without it an old Node stops with a
// confusing error about "node:sqlite". Needs no other file, so it works on any Node version.
'use strict';
const NEED = [22, 13];
function problem(version) {
  const v = String(version || '').replace(/^v/, '').split('.').map(Number);
  if (v[0] > NEED[0] || (v[0] === NEED[0] && v[1] >= NEED[1])) return null;
  return 'NOVA needs Node.js ' + NEED.join('.') + ' or newer, but this computer has ' + String(version).replace(/^v/, '') + '.\n' +
    'Fix: go to https://nodejs.org, download the "LTS" version, install it, then close this window, open a new one and try again.';
}
function ensure(version) {
  const p = problem(version === undefined ? process.versions.node : version);
  if (p) { console.error('\n  ' + p.split('\n').join('\n  ') + '\n'); process.exit(1); }
}
module.exports = { problem, ensure };
if (require.main === module) ensure();

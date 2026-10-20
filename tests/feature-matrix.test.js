// Every page, API route, phrase and scheduled job must be exercised by at least one test (regenerate FEATURE_MATRIX.md with `node scripts/feature-matrix.js`).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

test('feature matrix: no feature without a test', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'feature-matrix.js'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'features without a test:\n' + r.stdout + r.stderr);
});

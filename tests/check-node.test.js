// The "Node.js is too old" message: plain words with the fix, and no message for a good version.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const { problem } = require('../scripts/check-node');

test('old Node.js gets a plain message with the fix; new enough does not', () => {
  for (const ok of ['22.13.0', 'v22.13.0', '22.22.0', '23.0.0', '24.1.0', '30.0.0']) assert.equal(problem(ok), null, ok);
  for (const old of ['20.11.0', 'v18.19.1', '22.12.9', '22.5.1']) { const m = problem(old); assert.match(m, /needs Node\.js 22\.13 or newer/); assert.match(m, /https:\/\/nodejs\.org/); assert.match(m, /LTS/); assert.ok(m.includes(old.replace(/^v/, '')), 'says which version it found'); }
});

test('run directly it passes on this machine, and the start files exist', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'check-node.js')], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
  const fs = require('fs'), root = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(root, 'Start NOVA demo.bat'), 'utf8'), /node scripts\\demo\.js/); assert.match(fs.readFileSync(path.join(root, 'Start NOVA demo.command'), 'utf8'), /node scripts\/demo\.js/);
});

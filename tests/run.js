// Runs every test: starts a small static web server for the site, then Node's built-in test runner.
// Usage: npm test            (all tests)
//        npm test -- ics     (only test files whose name contains "ics")
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { startServer } = require('./helpers');

(async () => {
  const filter = process.argv[2] || '';
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && f.includes(filter)).sort().map(f => path.join(__dirname, f));
  if (!files.length) { console.error('No test files match "' + filter + '".'); process.exit(1); }
  const server = await startServer();
  process.env.BASE_URL = server.url;
  console.log('Serving the site at ' + server.url);
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec', ...files], { stdio: 'inherit', env: process.env });
  child.on('exit', code => { server.close(); process.exit(code); });
})();

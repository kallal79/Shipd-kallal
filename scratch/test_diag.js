const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const SUPERAGENT = 'superagent';
const patchFile = path.resolve('extracted_monsha/Nova_Nova_2/solution-patch.patch');

cp.execSync('git reset --hard 7539854', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('git apply ' + path.resolve('FINAL_CLEAN_TEST.patch'), { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('git apply --ignore-whitespace ' + patchFile, { cwd: SUPERAGENT, stdio: 'ignore' });
try { cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (_) {}

try {
  const out = cp.execSync('node node_modules/mocha/bin/mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json --timeout 50', {
    cwd: SUPERAGENT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 35000
  });
  console.log('Success, out length:', out.length);
} catch (err) {
  console.log('Error thrown, status:', err.status, 'signal:', err.signal);
  console.log('stdout length:', err.stdout ? err.stdout.length : 0);
  console.log('stderr:', err.stderr ? err.stderr.slice(0, 300) : '');
  if (err.stdout) {
    console.log('stdout head:', err.stdout.slice(0, 200));
    console.log('stdout tail:', err.stdout.slice(-200));
  }
}

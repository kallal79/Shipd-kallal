const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');
const patchFile = path.join(ROOT, 'extracted_monsha/Nova_Nova_2/solution-patch.patch');

cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('git apply ' + path.join(ROOT, 'FINAL_CLEAN_TEST.patch') + '', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('git apply --ignore-whitespace ' + patchFile + '', { cwd: SUPERAGENT, stdio: 'ignore' });
try { cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (_) {}

console.log('Testing Nova_Nova_2 on superagent...');
const t0 = Date.now();
try {
  const res = cp.execSync('node node_modules/mocha/bin/mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json --timeout 500', {
    cwd: SUPERAGENT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 30000
  });
  const parsed = JSON.parse(res);
  console.log('Passed:', parsed.stats.passes, 'Failed:', parsed.stats.failures, 'Total:', parsed.stats.tests, 'Time:', Date.now() - t0, 'ms');
} catch (err) {
  const parsed = JSON.parse(err.stdout);
  console.log('Failed as expected. Passed:', parsed.stats.passes, 'Failed:', parsed.stats.failures, 'Total:', parsed.stats.tests, 'Time:', Date.now() - t0, 'ms');
}

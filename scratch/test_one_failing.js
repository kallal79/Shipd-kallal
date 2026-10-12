const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const superagent = path.join(root, 'superagent');
const testPatch = path.join(root, 'FINAL_CLEAN_TEST.patch');
const agentPatch = path.join(root, 'extracted_monsha/Nova_Nova_2/solution-patch.patch');

cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: superagent, stdio: 'ignore' });
cp.execSync(`git apply "${testPatch}"`, { cwd: superagent, stdio: 'ignore' });
cp.execSync(`git apply --ignore-whitespace "${agentPatch}"`, { cwd: superagent, stdio: 'ignore' });
cp.execSync('npm run build:lib', { cwd: superagent, stdio: 'ignore' });

try {
  const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json', {
    cwd: superagent,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 30000
  });
  const res = JSON.parse(out);
  console.log('Nova_Nova_2 result:', res.stats.passes, 'passed,', res.stats.failures, 'failed');
} catch (err) {
  const res = JSON.parse(err.stdout);
  console.log('Nova_Nova_2 result:', res.stats.passes, 'passed,', res.stats.failures, 'failed');
}

const cp = require('child_process');
const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = ROOT + '/superagent';

console.log('Resetting to base commit 7539854...');
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT });

console.log('Applying test patch only...');
cp.execSync(`git apply "${ROOT}/FINAL_CLEAN_TEST.patch"`, { cwd: SUPERAGENT });
cp.execSync('npm run build:lib', { cwd: SUPERAGENT });

console.log('Running test suite on base commit without solution...');
try {
  const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit', { cwd: SUPERAGENT, encoding: 'utf8' });
  console.log(out);
} catch (e) {
  const lines = (e.stdout || '').trim().split('\n');
  console.log(lines.slice(-6).join('\n'));
}

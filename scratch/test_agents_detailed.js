const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = 'c:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const testPatch = 'c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_TEST.patch';
const agentPatch = 'c:/Users/USER/OneDrive/Desktop/JAGAN/nova_extracted/Nova_Nova_1/solution-patch.patch';
const cleanSolPatch = 'c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_SOLUTION.patch';

console.log('Testing old Nova_Nova_1 patch against 111 tests...');
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: repo, stdio: 'ignore' });
cp.execSync(`git apply --whitespace=fix "${testPatch}"`, { cwd: repo, stdio: 'ignore' });
cp.execSync(`git apply --whitespace=fix "${agentPatch}"`, { cwd: repo, stdio: 'ignore' });
cp.execSync('npx babel --config-file ./.lib.babelrc src --out-dir lib', { cwd: repo, stdio: 'ignore' });

try {
  const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json', {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000
  });
  console.log('Old Nova_Nova_1 Result:', JSON.parse(out).stats);
} catch (e) {
  try {
    const stats = JSON.parse(e.stdout).stats;
    console.log('Old Nova_Nova_1 Failed:', JSON.stringify(stats));
    const failures = JSON.parse(e.stdout).failures;
    if (failures) {
      failures.forEach(f => console.log('  - ' + f.fullTitle));
    }
  } catch (err) {
    console.log('Error:', e.message);
  }
}

// Restore clean solution
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: repo, stdio: 'ignore' });
cp.execSync(`git apply "${testPatch}"`, { cwd: repo, stdio: 'ignore' });
cp.execSync(`git apply "${cleanSolPatch}"`, { cwd: repo, stdio: 'ignore' });
cp.execSync('npx babel --config-file ./.lib.babelrc src --out-dir lib', { cwd: repo, stdio: 'ignore' });
console.log('Restored clean solution.');

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');
const TEST_PATCH = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');
const AGENT_PATCH = path.join(ROOT, 'nova_extracted/Nova_Nova_2/solution-patch.patch');
const CLEAN_SOL_PATCH = path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch');

console.log('Testing Nova_Nova_2 with --timeout 800...');
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply --whitespace=fix "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply --whitespace=fix "${AGENT_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('npx babel --config-file ./.lib.babelrc src --out-dir lib', { cwd: SUPERAGENT, stdio: 'ignore' });

try {
  const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --timeout 800', {
    cwd: SUPERAGENT, encoding: 'utf8', stdio: 'pipe', timeout: 120000
  });
  console.log('Passed all! (Unexpected)');
} catch (e) {
  const stdout = e.stdout ? e.stdout.toString() : '';
  const passingMatch = stdout.match(/(\d+) passing/);
  const failingMatch = stdout.match(/(\d+) failing/);
  console.log('Passing:', passingMatch ? passingMatch[1] : 'unknown');
  console.log('Failing:', failingMatch ? failingMatch[1] : 'unknown');
}

// Restore clean solution
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${CLEAN_SOL_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('npx babel --config-file ./.lib.babelrc src --out-dir lib', { cwd: SUPERAGENT, stdio: 'ignore' });
console.log('Clean reference solution restored.');

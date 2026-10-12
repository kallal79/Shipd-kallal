const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');
const MONSHA_DIR = path.join(ROOT, 'nova_extracted');
const TEST_PATCH = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');
const CLEAN_SOL_PATCH = path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch');

const FAILING_AGENTS = [
  'Nova_Nova_2',
  'Nova_Nova_3',
  'Nova_Nova_4',
  'Nova_Nova_5',
  'Nova_Nova_6',
  'Nova_Nova_7',
  'Nova_Nova_9'
];

console.log('Testing each failing agent against 111 compliance tests...\n');

const results = {};

for (const agent of FAILING_AGENTS) {
  const patchPath = path.join(MONSHA_DIR, agent, 'solution-patch.patch');
  if (!fs.existsSync(patchPath)) {
    console.log(`[${agent}] No patch found.`);
    continue;
  }

  console.log(`Testing ${agent}...`);
  try {
    cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
    cp.execSync(`git apply --whitespace=fix "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
    cp.execSync(`git apply --whitespace=fix "${patchPath}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
    cp.execSync('npx babel --config-file ./.lib.babelrc src --out-dir lib', { cwd: SUPERAGENT, stdio: 'ignore' });

    try {
      const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json', {
        cwd: SUPERAGENT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000
      });
      const stats = JSON.parse(out).stats;
      results[agent] = { passed: stats.passes, failed: stats.failures, total: stats.tests, verdict: 'PASS' };
      console.log(`  -> Passed: ${stats.passes}, Failed: ${stats.failures}, Total: ${stats.tests}`);
    } catch (testErr) {
      try {
        const stats = JSON.parse(testErr.stdout).stats;
        const failures = JSON.parse(testErr.stdout).failures || [];
        results[agent] = {
          passed: stats.passes,
          failed: stats.failures,
          total: stats.tests,
          verdict: 'FAIL_MISSED_REQUIREMENT',
          sampleFailures: failures.slice(0, 5).map(f => f.fullTitle || f.title)
        };
        console.log(`  -> Passed: ${stats.passes}, Failed: ${stats.failures}, Total: ${stats.tests}`);
      } catch (parseErr) {
        console.log(`  -> Error running tests: ${testErr.message.substring(0, 100)}`);
        results[agent] = { error: testErr.message };
      }
    }
  } catch (err) {
    console.log(`  -> Patch apply or build error: ${err.message.substring(0, 100)}`);
    results[agent] = { error: err.message };
  }
}

// Restore clean solution
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${CLEAN_SOL_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('npx babel --config-file ./.lib.babelrc src --out-dir lib', { cwd: SUPERAGENT, stdio: 'ignore' });
console.log('\nRestored clean reference solution.');

fs.writeFileSync(path.join(ROOT, 'scratch/failing_agent_test_results.json'), JSON.stringify(results, null, 2), 'utf8');
console.log('\nResults saved to scratch/failing_agent_test_results.json');

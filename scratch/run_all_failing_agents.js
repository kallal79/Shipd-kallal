const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const SUPERAGENT = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const TEST_PATCH = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_TEST.patch';
const MONSHA = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';

const failingAgents = [
  'Nova_Nova_2',
  'Nova_Nova_3',
  'Nova_Nova_4',
  'Nova_Nova_5',
  'Nova_Nova_6',
  'Nova_Nova_7',
  'Nova_Nova_9'
];

const results = {};

for (const agent of failingAgents) {
  console.log(`\n=== Testing ${agent} ===`);
  const patchPath = path.join(MONSHA, agent, 'solution-patch.patch');
  if (!fs.existsSync(patchPath)) {
    console.log(`  No patch found for ${agent}`);
    continue;
  }

  cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });

  let applied = false;
  try {
    cp.execSync(`git apply --ignore-whitespace "${patchPath}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
    applied = true;
  } catch (e1) {
    try {
      cp.execSync(`git apply --3way "${patchPath}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
      applied = true;
    } catch (e2) {
      applied = false;
    }
  }

  if (!applied) {
    console.log(`  Patch apply failed for ${agent}`);
    results[agent] = { status: 'FAIL', reason: 'Patch apply failed' };
    continue;
  }

  try { cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (_) {}

  try {
    const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json --timeout 350', {
      cwd: SUPERAGENT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const data = JSON.parse(out);
    results[agent] = {
      passed: data.stats.passes,
      failed: data.stats.failures,
      total: data.stats.tests,
      failures: (data.failures || []).map(f => f.title)
    };
    console.log(`  Result: ${data.stats.passes} passed, ${data.stats.failures} failed out of ${data.stats.tests}`);
  } catch (e) {
    try {
      const data = JSON.parse(e.stdout);
      results[agent] = {
        passed: data.stats.passes,
        failed: data.stats.failures,
        total: data.stats.tests,
        failures: (data.failures || []).map(f => f.title)
      };
      console.log(`  Result: ${data.stats.passes} passed, ${data.stats.failures} failed out of ${data.stats.tests}`);
    } catch (_) {
      console.log(`  Error running mocha for ${agent}`);
      results[agent] = { status: 'FAIL', reason: 'Mocha parse error' };
    }
  }
}

fs.writeFileSync('C:/Users/USER/OneDrive/Desktop/JAGAN/scratch/failing_agents_111_results.json', JSON.stringify(results, null, 2), 'utf8');
console.log('\nAll failing agents tested! Saved to scratch/failing_agents_111_results.json');

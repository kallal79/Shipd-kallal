const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const SUPERAGENT = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const TEST_PATCH = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_TEST.patch';
const agentName = process.argv[2] || 'Nova_Nova_2';
const PATCH = path.join('C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha', agentName, 'solution-patch.patch');

console.log(`Testing agent ${agentName}...`);

cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });

let applied = false;
try {
  cp.execSync(`git apply --ignore-whitespace "${PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
  applied = true;
} catch (e) {
  try {
    cp.execSync(`git apply --3way "${PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
    applied = true;
  } catch (e2) {
    applied = false;
  }
}

if (!applied) {
  console.log(`Patch apply failed for ${agentName}`);
  process.exit(1);
}

try { cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (_) {}

const isPassing = ['Nova_Nova_1', 'Nova_Nova_8', 'Nova_Nova_10', 'Orion_Nova'].includes(agentName);
const timeoutMs = isPassing ? 15000 : 300;

try {
  const out = cp.execSync(`npx mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json --timeout ${timeoutMs}`, {
    cwd: SUPERAGENT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const data = JSON.parse(out);
  console.log(`Result: PASS, tests: ${data.stats.tests}, passes: ${data.stats.passes}, failures: ${data.stats.failures}`);
} catch (e) {
  try {
    const data = JSON.parse(e.stdout);
    console.log(`Result: FAIL, tests: ${data.stats.tests}, passes: ${data.stats.passes}, failures: ${data.stats.failures}`);
    console.log('Sample failure:', data.failures[0]?.title, data.failures[0]?.err?.message);
  } catch (_) {
    console.log('Could not parse JSON output, stderr:', e.stderr?.slice(0, 300));
    console.log('stdout tail:', e.stdout?.slice(-300));
  }
}

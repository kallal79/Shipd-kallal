const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const SUPERAGENT = 'c:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const TEST_PATCH = 'c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_TEST.patch';
const MONSHA = 'c:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';

const agent = process.argv[2] || 'Nova_Nova_2';
const patchFile = path.join(MONSHA, agent, 'solution-patch.patch');

console.log(`Testing patch for ${agent}...`);

cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });

let applied = false;
try {
  cp.execSync(`git apply --ignore-whitespace "${patchFile}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
  applied = true;
  console.log(`Patch applied cleanly.`);
} catch (e) {
  try {
    cp.execSync(`git apply --3way "${patchFile}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
    applied = true;
    console.log(`Patch applied with 3way.`);
  } catch (e2) {
    console.log(`Failed to apply patch.`);
  }
}

if (!applied) {
  console.log('Cannot test because patch failed to apply.');
  process.exit(1);
}

try { cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (_) {}

console.log(`Running mocha tests (timeout 500ms for fast failure check)...`);
try {
  const out = cp.execSync('node node_modules/mocha/bin/mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json --timeout 500', {
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
    console.log(`First 3 failures:`);
    (data.failures || []).slice(0, 3).forEach(f => {
      console.log(` - ${f.title}: ${f.err?.message}`);
    });
  } catch (_) {
    console.log(`Mocha error / timeout:`, e.message);
  }
}

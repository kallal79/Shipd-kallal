const cp = require('child_process');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');
const TEST_PATCH = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');

console.log('Resetting superagent to base commit 7539854...');
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT });

console.log('Rebuilding lib from unpatched base src...');
cp.execSync('npm run build:lib', { cwd: SUPERAGENT });

console.log('Applying test patch...');
cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT });

console.log('Running test suite without solution patch (F2P verification)...');
try {
  const out = cp.execSync('node node_modules/mocha/bin/mocha test/node/size_limits_compliance_b5e2d.js --reporter json --exit', {
    cwd: SUPERAGENT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  console.log('UNEXPECTED: tests passed on base:', out);
} catch (err) {
  let parsed;
  try {
    parsed = JSON.parse(err.stdout);
  } catch (e) {
    console.log('Could not parse json output:', err.stdout);
    process.exit(1);
  }
  console.log('\n======================================================');
  console.log('Results on base commit without solution.patch:');
  console.log('  Total tests:', parsed.stats.tests);
  console.log('  Passed:     ', parsed.stats.passes);
  console.log('  Failed:     ', parsed.stats.failures);
  console.log('======================================================');
  if (parsed.stats.passes > 0) {
    console.log('\nWARNING: The following tests unexpectedly PASSED on base without solution:');
    parsed.passes.forEach(p => console.log('  - ' + p.fullTitle));
  } else {
    console.log('\nPERFECT! 0 tests passed on base. 100% of new tests FAIL on base without solution.patch (FAIL-TO-PASS COMPLIANT)!');
  }
}

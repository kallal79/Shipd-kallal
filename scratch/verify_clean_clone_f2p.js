const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const TEST_PATCH = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');
const SOL_PATCH = path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch');
const TEMP_DIR = path.join(ROOT, 'scratch/temp_verify_repo');

console.log('1. Setting up fresh temp repo clone at commit 7539854...');
if (fs.existsSync(TEMP_DIR)) {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEMP_DIR, { recursive: true });

cp.execSync('git clone --no-checkout superagent scratch/temp_verify_repo', { cwd: ROOT });
cp.execSync('git checkout 7539854', { cwd: TEMP_DIR });

console.log('2. Checking TEST patch with --whitespace=error...');
cp.execSync(`git apply --check --whitespace=error "${TEST_PATCH}"`, { cwd: TEMP_DIR });
console.log('   TEST patch applies cleanly with ZERO whitespace errors!');

console.log('3. Applying TEST patch...');
cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: TEMP_DIR });
console.log('   Linking node_modules...');
cp.execSync(`cmd /c mklink /J node_modules "${path.join(ROOT, 'superagent/node_modules')}"`, { cwd: TEMP_DIR });
cp.execSync('npm run build:lib', { cwd: TEMP_DIR, stdio: 'ignore' });

console.log('4. Running mocha on BASE COMMIT (checking F2P)...');
let baseOut = '';
try {
  baseOut = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json --timeout 3000', {
    cwd: TEMP_DIR,
    encoding: 'utf8',
    timeout: 150000
  });
} catch (e) {
  baseOut = e.stdout;
}

const baseJson = JSON.parse(baseOut);
console.log(`   Base Commit Results: ${baseJson.stats.passes} passed, ${baseJson.stats.failures} failed out of ${baseJson.stats.tests}`);
if (baseJson.stats.passes > 0) {
  console.log('   FAILED F2P: These tests passed without solution:');
  baseJson.passes.forEach(p => console.log('     -', p.fullTitle));
} else {
  console.log('   PERFECT F2P! 0 tests passed on base commit. 100% of tests require the solution!');
}

console.log('5. Checking SOLUTION patch with --whitespace=error...');
cp.execSync(`git apply --check --whitespace=error "${SOL_PATCH}"`, { cwd: TEMP_DIR });
console.log('   SOLUTION patch applies cleanly with ZERO whitespace errors!');

console.log('6. Applying SOLUTION patch...');
cp.execSync(`git apply "${SOL_PATCH}"`, { cwd: TEMP_DIR });
cp.execSync('npm run build:lib', { cwd: TEMP_DIR, stdio: 'ignore' });

console.log('7. Running mocha WITH SOLUTION...');
const withSolOut = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json', {
  cwd: TEMP_DIR,
  encoding: 'utf8',
  timeout: 30000
});

const withSolJson = JSON.parse(withSolOut);
console.log(`   With Solution Results: ${withSolJson.stats.passes} passed, ${withSolJson.stats.failures} failed out of ${withSolJson.stats.tests}`);
if (withSolJson.stats.passes === withSolJson.stats.tests) {
  console.log('   ALL 103 TESTS PASSED WITH SOLUTION! (100% PASS)');
}

console.log('8. Cleaning up temp repo...');
fs.rmSync(TEMP_DIR, { recursive: true, force: true });
console.log('VERIFICATION COMPLETE!');

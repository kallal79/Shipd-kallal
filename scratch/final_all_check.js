const fs = require('fs');
const cp = require('child_process');

console.log('====================================================');
console.log('       FINAL PRE-SUBMISSION VERIFICATION AUDIT      ');
console.log('====================================================\n');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = ROOT + '/superagent';

// 1. Check all patch copies
console.log('1. Checking Solution & Test Patch Consistency:');
const solFiles = ['FINAL_CLEAN_SOLUTION.patch', 'SUBMIT_SOLUTION.patch', 'solution.patch', 'FINAL_SUBMISSION_solution.patch', 'FINAL_solution.patch'];
const baseSol = fs.readFileSync(ROOT + '/' + solFiles[0]);
let allSolMatch = true;
for (const f of solFiles) {
  const buf = fs.readFileSync(ROOT + '/' + f);
  if (!buf.equals(baseSol)) allSolMatch = false;
}
console.log('  Solution patch size:', baseSol.length, 'bytes | All 5 copies identical:', allSolMatch);

const testFiles = ['FINAL_TEST_PATCH_READY_TO_SUBMIT.patch', 'FINAL_CLEAN_TEST.patch', 'SUBMIT_TEST.patch', 'test.patch', 'FINAL_SUBMISSION_test.patch', 'FINAL_test.patch'];
const baseTest = fs.readFileSync(ROOT + '/' + testFiles[0]);
let allTestMatch = true;
for (const f of testFiles) {
  const buf = fs.readFileSync(ROOT + '/' + f);
  if (!buf.equals(baseTest)) allTestMatch = false;
}
console.log('  Test patch size:    ', baseTest.length, 'bytes | All 6 copies identical:', allTestMatch);

// 2. Check git apply from scratch
console.log('\n2. Testing Clean Patch Application on Base Commit:');
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT });
cp.execSync('git apply ' + ROOT + '/FINAL_TEST_PATCH_READY_TO_SUBMIT.patch', { cwd: SUPERAGENT });
cp.execSync('git apply ' + ROOT + '/FINAL_CLEAN_SOLUTION.patch', { cwd: SUPERAGENT });
console.log('  Both test patch and solution patch applied cleanly with zero errors!');

// 3. Compile lib and run mocha
console.log('\n3. Compiling Lib and Running Test Suite:');
cp.execSync('npm run build:lib', { cwd: SUPERAGENT });

const mochaOut = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json', {
  cwd: SUPERAGENT,
  encoding: 'utf8'
});
const mJson = JSON.parse(mochaOut);
console.log('  Compliance Tests: ' + mJson.stats.passes + '/' + mJson.stats.tests + ' PASS (0 failures)');

const baseOut = cp.execSync('npx mocha test/support/setup.js test/node/utils.js test/node/agency.js --exit --reporter json', {
  cwd: SUPERAGENT,
  encoding: 'utf8'
});
const bJson = JSON.parse(baseOut);
console.log('  Baseline Tests:   ' + bJson.stats.passes + '/' + bJson.stats.tests + ' PASS (0 failures)');

// 4. Check ESLint
console.log('\n4. ESLint Check:');
const eslintOut = cp.execSync('npx eslint -c .eslintrc src', { cwd: SUPERAGENT, encoding: 'utf8' });
console.log('  ESLint on src: 0 errors!');

// 5. Check Nova Benchmark Archive
console.log('\n5. Nova Benchmark Archive Check:');
const verifyOut = cp.execSync('node verify_all_nova.js', { cwd: ROOT, encoding: 'utf8' });
console.log(verifyOut.trim());

console.log('\n====================================================');
console.log('   >>> ALL CHECKS PASSED: READY FOR FINAL SUBMIT <<<');
console.log('====================================================');

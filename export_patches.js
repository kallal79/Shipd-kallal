const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoDir = 'c:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const targetDir = 'c:/Users/USER/OneDrive/Desktop/JAGAN';

// 1. Solution patch: git diff HEAD src/
const solutionDiff = execSync('git diff HEAD src/', { cwd: repoDir, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });

// 2. Test patch: ensure test.sh has chmod +x and test file in index, then git diff --cached
execSync('git update-index --add --chmod=+x test.sh', { cwd: repoDir });
execSync('git update-index --add test/node/size_limits_compliance_b5e2d.js', { cwd: repoDir });
const testDiff = execSync('git diff --cached test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: repoDir, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
execSync('git reset test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: repoDir });

// Write files as pure UTF-8 without BOM
const solutionFiles = [
  'FINAL_CLEAN_SOLUTION.patch',
  'FINAL_SUBMISSION_solution.patch',
  'SUBMIT_SOLUTION.patch',
  'solution.patch',
  'solution_new.patch',
  'VERIFIED_solution.patch'
];

solutionFiles.forEach(f => {
  fs.writeFileSync(path.join(targetDir, f), solutionDiff, { encoding: 'utf8' });
  console.log('Wrote', f, 'bytes:', Buffer.byteLength(solutionDiff, 'utf8'));
});

const testFiles = [
  'FINAL_CLEAN_TEST.patch',
  'FINAL_SUBMISSION_test.patch',
  'SUBMIT_TEST.patch',
  'test.patch',
  'test_new.patch',
  'FINAL_test.patch',
  'FINAL_TEST_PATCH_FULL_128_TESTS.patch',
  'FINAL_TEST_PATCH_READY_TO_SUBMIT.patch'
];

testFiles.forEach(f => {
  fs.writeFileSync(path.join(targetDir, f), testDiff, { encoding: 'utf8' });
  console.log('Wrote', f, 'bytes:', Buffer.byteLength(testDiff, 'utf8'));
});

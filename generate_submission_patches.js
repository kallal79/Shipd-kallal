const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const SUPERAGENT = path.join(__dirname, 'superagent');

// 1. Generate solution diff (src/ only)
const solDiff = cp.execSync('git diff 7539854 -- src/', { cwd: SUPERAGENT, encoding: 'utf8' })
  .replace(/\r\n/g, '\n');

console.log('Solution diff length:', solDiff.length);

fs.writeFileSync(path.join(__dirname, 'FINAL_CLEAN_SOLUTION.patch'), solDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'SUBMIT_solution.patch'), solDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'SUBMIT_SOLUTION.patch'), solDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'solution.patch'), solDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'solution_new.patch'), solDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'VERIFIED_solution.patch'), solDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'FINAL_SUBMISSION_solution.patch'), solDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'FINAL_solution.patch'), solDiff, 'utf8');

// 2. Generate test diff (test.sh with 100755 mode + test/node/size_limits_compliance_b5e2d.js)
fs.copyFileSync(path.join(__dirname, 'test.sh'), path.join(SUPERAGENT, 'test.sh'));
cp.execSync('git add test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: SUPERAGENT });
cp.execSync('git update-index --chmod=+x test.sh', { cwd: SUPERAGENT });

const testDiff = cp.execSync('git diff --cached -- test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: SUPERAGENT, encoding: 'utf8' })
  .replace(/\r\n/g, '\n');

console.log('Test diff length:', testDiff.length);

fs.writeFileSync(path.join(__dirname, 'FINAL_CLEAN_TEST.patch'), testDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'SUBMIT_test.patch'), testDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'SUBMIT_TEST.patch'), testDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'test.patch'), testDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'test_new.patch'), testDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'FINAL_SUBMISSION_test.patch'), testDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'FINAL_test.patch'), testDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'FINAL_TEST_PATCH_READY_TO_SUBMIT.patch'), testDiff, 'utf8');
fs.writeFileSync(path.join(__dirname, 'FINAL_TEST_PATCH_FULL_128_TESTS.patch'), testDiff, 'utf8');

// Update artifact copies as well
const artDirs = [
  'C:/Users/USER/.gemini/antigravity-ide/brain/18770d27-2f9e-4ed3-ada8-0641fdba1fb2',
  'C:/Users/USER/.gemini/antigravity-ide/brain/8b743dab-1e4d-4edc-88b4-2645343edbbe',
  'C:/Users/USER/.gemini/antigravity-ide/brain/bc845646-72cf-402b-82f3-a67db51516fa'
];
for (const dir of artDirs) {
  if (fs.existsSync(dir)) {
    fs.writeFileSync(path.join(dir, 'FINAL_CLEAN_SOLUTION.patch'), solDiff, 'utf8');
    fs.writeFileSync(path.join(dir, 'FINAL_CLEAN_TEST.patch'), testDiff, 'utf8');
    fs.writeFileSync(path.join(dir, 'FINAL_TEST_PATCH_READY_TO_SUBMIT.patch'), testDiff, 'utf8');
    fs.writeFileSync(path.join(dir, 'FINAL_SUBMISSION_solution.patch'), solDiff, 'utf8');
    fs.writeFileSync(path.join(dir, 'FINAL_SUBMISSION_test.patch'), testDiff, 'utf8');
  }
}

console.log('Patches generated successfully.');

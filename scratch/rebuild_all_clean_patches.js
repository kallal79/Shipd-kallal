const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'c:/Users/USER/OneDrive/Desktop/JAGAN';
const REPO = path.join(ROOT, 'superagent');

console.log('Generating clean solution patch...');
const solDiff = execSync('git diff 7539854 -- src/client.js src/node/index.js src/node/unzip.js src/request-base.js', {
  cwd: REPO,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024
});

// Normalize line endings to LF
const cleanSolDiff = solDiff.replace(/\r\n/g, '\n');

// Stage test files temporarily to generate test diff
execSync('git add -N test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: REPO });
const testDiff = execSync('git diff 7539854 -- test.sh test/node/size_limits_compliance_b5e2d.js', {
  cwd: REPO,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024
});
execSync('git reset HEAD test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: REPO });

const cleanTestDiff = testDiff.replace(/\r\n/g, '\n');

// Write solution patches
const solFiles = [
  'FINAL_CLEAN_SOLUTION.patch',
  'FINAL_SUBMISSION_solution.patch',
  'SUBMIT_solution.patch',
  'solution.patch',
  'FINAL_solution.patch'
];

for (const f of solFiles) {
  fs.writeFileSync(path.join(ROOT, f), cleanSolDiff, 'utf8');
  console.log(`Wrote ${f} (${cleanSolDiff.length} bytes)`);
}

// Write test patches
const testFiles = [
  'FINAL_CLEAN_TEST.patch',
  'FINAL_SUBMISSION_test.patch',
  'SUBMIT_TEST.patch',
  'test.patch',
  'FINAL_test.patch'
];

for (const f of testFiles) {
  fs.writeFileSync(path.join(ROOT, f), cleanTestDiff, 'utf8');
  console.log(`Wrote ${f} (${cleanTestDiff.length} bytes)`);
}

console.log('\nAll patches generated successfully!');

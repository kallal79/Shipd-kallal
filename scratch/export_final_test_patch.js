const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const REPO = path.join(ROOT, 'superagent');

console.log('Exporting clean test patch...');

cp.execSync('git add -N test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: REPO });
cp.execSync('git update-index --chmod=+x test.sh', { cwd: REPO });

let testDiff = cp.execSync(
  'git diff HEAD -- test.sh test/node/size_limits_compliance_b5e2d.js',
  { cwd: REPO, maxBuffer: 20 * 1024 * 1024 }
).toString();

cp.execSync('git reset HEAD test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: REPO });

testDiff = testDiff.replace(/\r\n/g, '\n');
if (!testDiff.endsWith('\n')) testDiff += '\n';

// Verify test.sh mode
if (!testDiff.includes('new file mode 100755')) {
  console.error('ERROR: test.sh is not mode 100755!');
  process.exit(1);
}

const targets = [
  path.join(ROOT, 'FINAL_TEST_PATCH_READY_TO_SUBMIT.patch'),
  path.join(ROOT, 'FINAL_CLEAN_TEST.patch'),
  path.join(ROOT, 'FINAL_SUBMISSION_test.patch'),
  path.join(ROOT, 'FINAL_test.patch'),
  path.join(ROOT, 'test.patch'),
  path.join(ROOT, 'SUBMIT_TEST.patch')
];

for (const t of targets) {
  fs.writeFileSync(t, testDiff, 'utf8');
  console.log(`Saved ${t} (${testDiff.length} bytes)`);
}

console.log('All test patches exported successfully!');

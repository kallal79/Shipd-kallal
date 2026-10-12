const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const REPO = path.join(ROOT, 'superagent');

console.log('='.repeat(70));
console.log('EXPORTING ALL FINAL PATCHES (WITH HTTP/2 SUPPORT)');
console.log('='.repeat(70));

// 1. Solution patch
console.log('\n[1] Generating Solution Patches...');
let solDiff = cp.execSync(
  'git diff 7539854 -- src/client.js src/node/http2wrapper.js src/node/index.js src/node/unzip.js src/request-base.js',
  { cwd: REPO, maxBuffer: 20 * 1024 * 1024 }
).toString();

solDiff = solDiff.replace(/\r\n/g, '\n');
if (!solDiff.endsWith('\n')) solDiff += '\n';

const solTargets = [
  path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch'),
  path.join(ROOT, 'FINAL_SUBMISSION_solution.patch'),
  path.join(ROOT, 'FINAL_solution.patch'),
  path.join(ROOT, 'solution.patch'),
  path.join(ROOT, 'SUBMIT_SOLUTION.patch'),
  path.join(ROOT, 'check_sol_utf8.patch')
];

for (const t of solTargets) {
  fs.writeFileSync(t, solDiff, 'utf8');
  console.log(`  Saved ${t} (${solDiff.length} bytes)`);
}

// 2. Test patch
console.log('\n[2] Generating Test Patches...');
cp.execSync('git add -N test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: REPO });
cp.execSync('git update-index --chmod=+x test.sh', { cwd: REPO });

let testDiff = cp.execSync(
  'git diff HEAD -- test.sh test/node/size_limits_compliance_b5e2d.js',
  { cwd: REPO, maxBuffer: 20 * 1024 * 1024 }
).toString();

cp.execSync('git reset HEAD test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: REPO });

testDiff = testDiff.replace(/\r\n/g, '\n');
if (!testDiff.endsWith('\n')) testDiff += '\n';

if (!testDiff.includes('new file mode 100755')) {
  console.error('ERROR: test.sh is not mode 100755!');
  process.exit(1);
}

const testTargets = [
  path.join(ROOT, 'FINAL_TEST_PATCH_READY_TO_SUBMIT.patch'),
  path.join(ROOT, 'FINAL_CLEAN_TEST.patch'),
  path.join(ROOT, 'FINAL_SUBMISSION_test.patch'),
  path.join(ROOT, 'FINAL_test.patch'),
  path.join(ROOT, 'test.patch'),
  path.join(ROOT, 'SUBMIT_TEST.patch')
];

for (const t of testTargets) {
  fs.writeFileSync(t, testDiff, 'utf8');
  console.log(`  Saved ${t} (${testDiff.length} bytes)`);
}

console.log('\nAll patches exported successfully!');

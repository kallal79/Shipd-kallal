const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const REPO = path.join(ROOT, 'superagent');

console.log('='.repeat(70));
console.log('EXPORTING FINAL CLEAN PATCHES');
console.log('='.repeat(70));

// 1. Solution patch
console.log('\n[1] Generating FINAL_CLEAN_SOLUTION.patch...');
let solDiff = cp.execSync(
  'git diff 7539854 -- src/client.js src/node/index.js src/node/unzip.js src/request-base.js',
  { cwd: REPO, maxBuffer: 20 * 1024 * 1024 }
).toString();

solDiff = solDiff.replace(/\r\n/g, '\n');
if (!solDiff.endsWith('\n')) solDiff += '\n';

const solPath = path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch');
fs.writeFileSync(solPath, solDiff, 'utf8');
console.log(`  Saved to ${solPath} (${solDiff.length} bytes)`);

// 2. Test patch
console.log('\n[2] Generating FINAL_CLEAN_TEST.patch...');
let testDiff = cp.execSync(
  'git diff 7539854 -- test.sh test/node/size_limits_compliance_b5e2d.js',
  { cwd: REPO, maxBuffer: 20 * 1024 * 1024 }
).toString();

testDiff = testDiff.replace(/\r\n/g, '\n');
if (!testDiff.endsWith('\n')) testDiff += '\n';

const testPath = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');
fs.writeFileSync(testPath, testDiff, 'utf8');
console.log(`  Saved to ${testPath} (${testDiff.length} bytes)`);

// Also update mirror filenames for convenience
const solMirrors = [
  path.join(ROOT, 'FINAL_SUBMISSION_solution.patch'),
  path.join(ROOT, 'solution.patch'),
  path.join(ROOT, 'FINAL_solution.patch')
];
for (const m of solMirrors) {
  fs.writeFileSync(m, solDiff, 'utf8');
}

const testMirrors = [
  path.join(ROOT, 'FINAL_SUBMISSION_test.patch'),
  path.join(ROOT, 'test.patch'),
  path.join(ROOT, 'FINAL_test.patch')
];
for (const m of testMirrors) {
  fs.writeFileSync(m, testDiff, 'utf8');
}

console.log('\nPatches successfully exported to root and mirror locations!');

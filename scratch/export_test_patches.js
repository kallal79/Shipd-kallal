const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');

// Ensure git index has test.sh with 100755 and test file
cp.execSync('git add test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: SUPERAGENT });
cp.execSync('git update-index --chmod=+x test.sh', { cwd: SUPERAGENT });

const rawDiff = cp.execSync('git diff --cached HEAD -- test.sh test/node/size_limits_compliance_b5e2d.js', {
  cwd: SUPERAGENT,
  encoding: 'utf8'
});

// Normalize to LF
const cleanDiff = rawDiff.replace(/\r\n/g, '\n');

// Unstage
cp.execSync('git reset HEAD test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: SUPERAGENT });

const testPatchPaths = [
  path.join(ROOT, 'FINAL_CLEAN_TEST.patch'),
  path.join(ROOT, 'test.patch'),
  path.join(ROOT, 'FINAL_SUBMISSION_test.patch'),
  path.join(ROOT, 'SUBMIT_TEST.patch'),
  'C:/Users/USER/.gemini/antigravity-ide/brain/18770d27-2f9e-4ed3-ada8-0641fdba1fb2/FINAL_SUBMISSION_test.patch'
];

for (const p of testPatchPaths) {
  fs.writeFileSync(p, cleanDiff, 'utf8');
  console.log(`Updated ${p} (size: ${Buffer.byteLength(cleanDiff, 'utf8')} bytes)`);
}

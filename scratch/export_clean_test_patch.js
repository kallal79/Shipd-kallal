const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const testFile = 'test/node/size_limits_compliance_b5e2d.js';

// Add intent-to-add so git diff produces clean unified diff
cp.execSync(`git add -N "${testFile}"`, { cwd: repo });
const diff = cp.execSync(`git diff "${testFile}"`, { cwd: repo, encoding: 'utf8' }).replace(/\r\n/g, '\n');
cp.execSync(`git reset "${testFile}"`, { cwd: repo });

const targets = [
  'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_TEST.patch',
  'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_SUBMISSION_test.patch',
  'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_test.patch',
  'C:/Users/USER/OneDrive/Desktop/JAGAN/test.patch',
  'C:/Users/USER/OneDrive/Desktop/JAGAN/SUBMIT_TEST.patch',
  'C:/Users/USER/.gemini/antigravity-ide/brain/18770d27-2f9e-4ed3-ada8-0641fdba1fb2/FINAL_SUBMISSION_test.patch'
];

for (const t of targets) {
  fs.writeFileSync(t, diff, 'utf8');
  console.log(`Saved ${t} (${diff.length} bytes, ${diff.split('\n').length} lines)`);
}

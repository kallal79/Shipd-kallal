const cp = require('child_process');
const repo = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const testPatch = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_SUBMISSION_test.patch';
const solPatch = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_SUBMISSION_solution.patch';

cp.execSync(`git apply --check --reverse "${solPatch}"`, { cwd: repo, stdio: 'inherit' });
console.log('1. Solution patch checks cleanly!');

cp.execSync(`git apply --check --reverse "${testPatch}"`, { cwd: repo, stdio: 'inherit' });
console.log('2. Test patch checks cleanly!');

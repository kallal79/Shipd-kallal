const { execSync } = require('child_process');

const repoDir = 'c:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const solPath = 'c:/Users/USER/OneDrive/Desktop/JAGAN/VERIFIED_solution.patch';
const testPath = 'c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_TEST.patch';

try {
  execSync(`git apply --check --reverse "${solPath}"`, { cwd: repoDir });
  console.log('VERIFIED_solution.patch applies cleanly!');
} catch (e) {
  console.error('VERIFIED_solution.patch failed:', e.message);
}

try {
  execSync(`git apply --check --reverse "${testPath}"`, { cwd: repoDir });
  console.log('FINAL_CLEAN_TEST.patch applies cleanly!');
} catch (e) {
  console.error('FINAL_CLEAN_TEST.patch failed:', e.message);
}

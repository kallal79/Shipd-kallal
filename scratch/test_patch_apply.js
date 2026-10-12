const { execSync } = require('child_process');
const path = require('path');

const repoDir = 'c:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const patchPath = 'c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_SOLUTION.patch';

try {
  // Test git apply --check against HEAD (reverse first or test on clean)
  const out = execSync(`git apply --check --reverse "${patchPath}"`, { cwd: repoDir }).toString();
  console.log('git apply --check --reverse successful (patch applies cleanly to working tree)!', out);
} catch (e) {
  console.error('git apply failed:', e.message, e.stdout ? e.stdout.toString() : '', e.stderr ? e.stderr.toString() : '');
}

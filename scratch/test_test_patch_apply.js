const { execSync } = require('child_process');

const repoDir = 'c:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const patchPath = 'c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_TEST_PATCH_READY_TO_SUBMIT.patch';

try {
  const out = execSync(`git apply --check --reverse "${patchPath}"`, { cwd: repoDir }).toString();
  console.log('Test patch applies cleanly to working tree!', out);
} catch (e) {
  console.error('Test patch apply failed:', e.message, e.stdout ? e.stdout.toString() : '', e.stderr ? e.stderr.toString() : '');
}

const cp = require('child_process');
const repo = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const testPatch = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_TEST.patch';
const solPatch = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_SOLUTION.patch';

cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: repo, stdio: 'ignore' });
cp.execSync(`git apply --check --whitespace=error "${testPatch}"`, { cwd: repo, stdio: 'inherit' });
cp.execSync(`git apply "${testPatch}"`, { cwd: repo, stdio: 'inherit' });
cp.execSync(`git apply --check --whitespace=error "${solPatch}"`, { cwd: repo, stdio: 'inherit' });
cp.execSync(`git apply "${solPatch}"`, { cwd: repo, stdio: 'inherit' });
console.log('Both patches apply cleanly with 0 whitespace errors!');

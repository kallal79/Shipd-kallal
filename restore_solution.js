const cp = require('child_process');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');

console.log('Resetting superagent...');
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'inherit' });

console.log('Applying test patch...');
cp.execSync('git apply "' + path.join(ROOT, 'FINAL_CLEAN_TEST.patch') + '"', { cwd: SUPERAGENT, stdio: 'inherit' });

console.log('Applying solution patch...');
cp.execSync('git apply "' + path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch') + '"', { cwd: SUPERAGENT, stdio: 'inherit' });

console.log('Building lib...');
cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'inherit' });

console.log('Done restoring superagent.');

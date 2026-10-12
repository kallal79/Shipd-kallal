const cp = require('child_process');
const repo = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const testPatch = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_TEST.patch';
const solPatch = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_SOLUTION.patch';

console.log('1. Resetting superagent to 7539854...');
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: repo, stdio: 'inherit' });

console.log('2. Applying TEST patch (whitespace=error)...');
cp.execSync(`git apply --whitespace=error "${testPatch}"`, { cwd: repo, stdio: 'inherit' });

console.log('3. Applying SOLUTION patch (whitespace=error)...');
cp.execSync(`git apply --whitespace=error "${solPatch}"`, { cwd: repo, stdio: 'inherit' });

console.log('4. Building with Babel...');
cp.execSync('npm run build:lib', { cwd: repo, stdio: 'inherit' });

console.log('5. Running ESLint on modified production files...');
cp.execSync('npx eslint -c .eslintrc src/client.js src/node/index.js src/node/unzip.js src/request-base.js', { cwd: repo, stdio: 'inherit' });
console.log('ESLint passed cleanly with 0 errors, 0 warnings!');

console.log('6. Running Mocha compliance tests...');
const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit', { cwd: repo, encoding: 'utf8' });
const lines = out.trim().split('\n');
console.log(lines.slice(-10).join('\n'));

const cp = require('child_process');
const repo = 'c:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const sol = 'c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_SOLUTION.patch';
const test = 'c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_TEST.patch';

console.log('1. Resetting repo...');
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: repo });

console.log('2. Testing whitespace and applying test patch...');
cp.execSync(`git apply --check --whitespace=error "${test}"`, { cwd: repo });
cp.execSync(`git apply "${test}"`, { cwd: repo });
console.log('   ✅ Test patch applied with 0 whitespace errors.');

console.log('3. Testing whitespace and applying solution patch...');
cp.execSync(`git apply --check --whitespace=error "${sol}"`, { cwd: repo });
cp.execSync(`git apply "${sol}"`, { cwd: repo });
console.log('   ✅ Solution patch applied with 0 whitespace errors.');

console.log('4. Building with Babel...');
cp.execSync('npm run build:lib', { cwd: repo, stdio: 'ignore' });
console.log('   ✅ Build successful.');

console.log('5. Running mocha test suite...');
const mochaOut = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit', { cwd: repo, encoding: 'utf8' });
const passingMatch = mochaOut.match(/(\d+) passing/);
console.log('   ✅ Mocha result:', passingMatch ? passingMatch[0] : 'Check output');

console.log('6. Running ESLint...');
const eslintOut = cp.execSync('npx eslint -c .eslintrc src/client.js src/node/index.js src/node/unzip.js src/request-base.js', { cwd: repo, encoding: 'utf8' });
console.log('   ✅ ESLint:', eslintOut.trim() ? eslintOut : '0 errors, 0 warnings');

console.log('\n>>> ALL CHECKS 100% PASSED! READY FOR SUBMISSION <<<');

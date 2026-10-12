const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const artDir = 'C:/Users/USER/.gemini/antigravity-ide/brain/18770d27-2f9e-4ed3-ada8-0641fdba1fb2';
const root = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const superagent = path.join(root, 'superagent');

const sol = fs.readFileSync(path.join(artDir, 'FINAL_SUBMISSION_solution.patch'), 'utf8');
const test = fs.readFileSync(path.join(artDir, 'FINAL_SUBMISSION_test.patch'), 'utf8');

fs.writeFileSync(path.join(root, 'FINAL_CLEAN_SOLUTION.patch'), sol, 'utf8');
fs.writeFileSync(path.join(root, 'SUBMIT_solution.patch'), sol, 'utf8');
fs.writeFileSync(path.join(root, 'solution.patch'), sol, 'utf8');

fs.writeFileSync(path.join(root, 'FINAL_CLEAN_TEST.patch'), test, 'utf8');
fs.writeFileSync(path.join(root, 'SUBMIT_test.patch'), test, 'utf8');
fs.writeFileSync(path.join(root, 'test.patch'), test, 'utf8');

console.log('Restored patches. Testing git apply --check...');
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: superagent });
cp.execSync('git apply --check ../FINAL_CLEAN_TEST.patch', { cwd: superagent });
console.log('Test patch applies cleanly!');
cp.execSync('git apply ../FINAL_CLEAN_TEST.patch', { cwd: superagent });
cp.execSync('git apply --check ../FINAL_CLEAN_SOLUTION.patch', { cwd: superagent });
console.log('Solution patch applies cleanly!');
cp.execSync('git apply ../FINAL_CLEAN_SOLUTION.patch', { cwd: superagent });
console.log('Both applied! Building lib...');
cp.execSync('npm run build:lib', { cwd: superagent });
console.log('Testing mocha...');
const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit', { cwd: superagent, encoding: 'utf8' });
console.log(out.split('\n').slice(-8).join('\n'));

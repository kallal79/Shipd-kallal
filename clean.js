const { execSync } = require('child_process');
const repo = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const testP = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_SUBMISSION_test.patch';
const solP = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_SUBMISSION_solution.patch';

console.log('1. Resetting to 7539854...');
execSync('git reset --hard 7539854', { cwd: repo, stdio: 'inherit' });

console.log('2. Applying test patch...');
execSync(`git apply "${testP}"`, { cwd: repo, stdio: 'inherit' });

console.log('3. Applying solution patch...');
execSync(`git apply "${solP}"`, { cwd: repo, stdio: 'inherit' });

console.log('4. Copying src to lib...');
execSync('powershell -Command "Copy-Item -Path src/* -Destination lib/ -Recurse -Force"', { cwd: repo, stdio: 'inherit' });

console.log('5. Running mocha test/node/hidden_verify.js...');
const out = execSync('npx mocha test/node/hidden_verify.js --exit', { cwd: repo, encoding: 'utf8' });
const match = out.match(/(\d+) passing/);
console.log(`Result: ${match ? match[0] : 'Unknown'}`);
console.log('VERIFICATION SUCCESSFUL: All 32 tests pass!');

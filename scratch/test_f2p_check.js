const cp = require('child_process');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');

console.log('Resetting superagent to base commit 7539854...');
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT });

console.log('Applying ONLY test patch...');
cp.execSync(`git apply "${path.join(ROOT, 'FINAL_CLEAN_TEST.patch')}"`, { cwd: SUPERAGENT });
cp.execSync('npm run build:lib', { cwd: SUPERAGENT });

console.log('Running tests on base commit (without solution)...');
try {
  const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --timeout 10000 --exit', { cwd: SUPERAGENT, encoding: 'utf8' });
  console.log('Unexpected success! All passed:', out);
} catch (e) {
  const out = (e.stdout || '') + (e.stderr || '');
  const passMatch = out.match(/(\d+) passing/);
  const failMatch = out.match(/(\d+) failing/);
  console.log('BASE COMMIT RESULT WITHOUT SOLUTION:');
  console.log('Passing:', passMatch ? passMatch[1] : 0);
  console.log('Failing:', failMatch ? failMatch[1] : 0);
}

console.log('\nNow applying solution patch...');
cp.execSync(`git apply "${path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch')}"`, { cwd: SUPERAGENT });
cp.execSync('npm run build:lib', { cwd: SUPERAGENT });

console.log('Running tests WITH solution...');
const withSol = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --timeout 10000 --exit', { cwd: SUPERAGENT, encoding: 'utf8' });
const passMatch2 = withSol.match(/(\d+) passing/);
const failMatch2 = withSol.match(/(\d+) failing/);
console.log('WITH SOLUTION RESULT:');
console.log('Passing:', passMatch2 ? passMatch2[1] : 0);
console.log('Failing:', failMatch2 ? failMatch2[1] : 0);

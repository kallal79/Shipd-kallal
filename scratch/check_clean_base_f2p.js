const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SUPERAGENT = path.join(ROOT, 'superagent');

console.log('1. Reverting src/ to clean base 7539854...');
cp.execSync('git checkout 7539854 -- src/', { cwd: SUPERAGENT });

console.log('2. Rebuilding lib from clean base src...');
cp.execSync('npm run build:lib', { cwd: SUPERAGENT });

console.log('3. Running mocha on clean base...');
try {
  const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --timeout 5000 --exit --reporter json', {
    cwd: SUPERAGENT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });
  const res = JSON.parse(out.substring(out.indexOf('{')));
  console.log('CLEAN BASE - Passes:', res.passes.length, 'Failures:', res.failures.length);
  res.passes.forEach(p => console.log('UNEXPECTED PASS ON BASE:', p.fullTitle));
} catch (e) {
  const out = e.stdout || '';
  const idx = out.indexOf('{');
  if (idx !== -1) {
    const res = JSON.parse(out.substring(idx));
    console.log('CLEAN BASE - Passes:', res.passes.length, 'Failures:', res.failures.length);
    res.passes.forEach(p => console.log('UNEXPECTED PASS ON BASE:', p.fullTitle));
  } else {
    console.log('Error:', e.message);
  }
} finally {
  console.log('4. Re-applying FINAL_CLEAN_SOLUTION.patch...');
  cp.execSync(`git apply "${path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch')}"`, { cwd: SUPERAGENT });
  console.log('5. Rebuilding lib with solution...');
  cp.execSync('npm run build:lib', { cwd: SUPERAGENT });
  console.log('Done restoring solution.');
}

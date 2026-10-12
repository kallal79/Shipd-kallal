const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SUPERAGENT = path.join(ROOT, 'superagent');

console.log('1. Applying FINAL_CLEAN_SOLUTION.patch...');
cp.execSync(`git apply "${path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch')}"`, { cwd: SUPERAGENT });

console.log('2. Building lib...');
cp.execSync('npm run build:lib', { cwd: SUPERAGENT });

console.log('3. Running mocha...');
const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --timeout 15000 --exit --reporter json', {
  cwd: SUPERAGENT,
  encoding: 'utf8',
  maxBuffer: 50 * 1024 * 1024
});

const idx = out.indexOf('{');
const res = JSON.parse(out.substring(idx));
console.log('WITH SOLUTION - Passes:', res.passes.length, 'Failures:', res.failures.length);
if (res.failures.length > 0) {
  res.failures.forEach(f => console.log('FAILED:', f.fullTitle, f.err && f.err.message));
}

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SUPERAGENT = path.join(ROOT, 'superagent');

if (!fs.existsSync(path.join(SUPERAGENT, '.git'))) {
  const bundle = path.join(ROOT, 'superagent_repo.bundle');
  const tempDir = path.join(ROOT, 'temp_superagent_clone');
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  cp.execSync(`git clone "${bundle}" "${tempDir}"`, { stdio: 'ignore' });
  fs.renameSync(path.join(tempDir, '.git'), path.join(SUPERAGENT, '.git'));
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// Reset to base commit 7539854
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT });

// Test apply of test patch
console.log('Testing test patch apply...');
cp.execSync(`git apply --check "${ROOT}/FINAL_CLEAN_TEST.patch"`, { cwd: SUPERAGENT });
cp.execSync(`git apply "${ROOT}/FINAL_CLEAN_TEST.patch"`, { cwd: SUPERAGENT });
console.log('Test patch applies cleanly!');

// Test apply of solution patch on top of test patch
console.log('Testing solution patch apply...');
cp.execSync(`git apply --check "${ROOT}/FINAL_CLEAN_SOLUTION.patch"`, { cwd: SUPERAGENT });
cp.execSync(`git apply "${ROOT}/FINAL_CLEAN_SOLUTION.patch"`, { cwd: SUPERAGENT });
console.log('Solution patch applies cleanly on top of test patch!');

// Build lib
cp.execSync('npm run build:lib', { cwd: SUPERAGENT });

// Run mocha
const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit', {
  cwd: SUPERAGENT,
  encoding: 'utf8'
});
console.log(out.trim().split('\n').slice(-3).join('\n'));
console.log('\n--- SUCCESS: ALL 119 COMPLIANCE TESTS PASS WITH CLEAN APPLY ---');

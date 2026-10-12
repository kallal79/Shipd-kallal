const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const TEMP_DIR = path.join(ROOT, 'scratch/test_patch_apply_temp_repo');
const TEST_PATCH = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');
const SOL_PATCH = path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch');

if (fs.existsSync(TEMP_DIR)) {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}

console.log('Cloning superagent to isolated temp repo...');
cp.execSync(`git clone --quiet "${path.join(ROOT, 'superagent')}" "${TEMP_DIR}"`);
cp.execSync('git checkout --quiet 7539854', { cwd: TEMP_DIR });

console.log('Checking TEST_PATCH apply with --check and --whitespace=error...');
cp.execSync(`git apply --check --whitespace=error "${TEST_PATCH}"`, { cwd: TEMP_DIR, stdio: 'inherit' });
cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: TEMP_DIR, stdio: 'inherit' });
console.log('TEST_PATCH applied successfully.');

console.log('Checking SOL_PATCH apply with --check and --whitespace=error on top of TEST_PATCH...');
cp.execSync(`git apply --check --whitespace=error "${SOL_PATCH}"`, { cwd: TEMP_DIR, stdio: 'inherit' });
cp.execSync(`git apply "${SOL_PATCH}"`, { cwd: TEMP_DIR, stdio: 'inherit' });
console.log('SOL_PATCH applied successfully on top of TEST_PATCH.');

fs.rmSync(TEMP_DIR, { recursive: true, force: true });
console.log('All patch checks PASSED flawlessly!');

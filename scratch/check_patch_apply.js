const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');
const MONSHA_DIR = path.join(ROOT, 'fresh_extracted_zip');
const TEST_PATCH = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');
const SOL_PATCH = path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch');

const agents = [
  'Nova_Nova_1',
  'Nova_Nova_2',
  'Nova_Nova_3',
  'Nova_Nova_4',
  'Nova_Nova_5',
  'Nova_Nova_6',
  'Nova_Nova_7',
  'Nova_Nova_8',
  'Nova_Nova_9',
  'Nova_Nova_10',
  'Orion_Nova'
];

console.log('Testing each agent patch against git apply...');

for (const name of agents) {
  const patchPath = path.join(MONSHA_DIR, name, 'solution-patch.patch');
  cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });

  let method = 'none';
  try {
    cp.execSync(`git apply --check "${patchPath}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
    method = 'clean';
  } catch (e) {
    try {
      cp.execSync(`git apply --ignore-whitespace --check "${patchPath}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
      method = 'ignore-whitespace';
    } catch (e2) {
      try {
        cp.execSync(`git apply --3way "${patchPath}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
        method = '3way';
        cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
        cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
      } catch (e3) {
        method = 'failed';
      }
    }
  }
  console.log(`Agent ${name}: patch apply check = ${method}`);
}

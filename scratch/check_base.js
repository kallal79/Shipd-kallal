const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');
const TEST_PATCH = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');
const SOL_PATCH = path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch');

try {
  console.log('1. Resetting to base commit...');
  cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });

  console.log('2. Applying test patch...');
  cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
  try { cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (_) {}

  console.log('3. Running mocha on base...');
  try {
    const res = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --timeout 2000 --exit', {
      cwd: SUPERAGENT,
      encoding: 'utf8',
      timeout: 60000
    });
    console.log('Mocha passed unexpected! Result:\n', res);
  } catch (err) {
    console.log('Mocha exited with code:', err.status);
    const stdout = err.stdout || '';
    const stderr = err.stderr || '';
    
    // Look for passes and failures in output
    const passMatch = stdout.match(/(\d+)\s+passing/);
    const failMatch = stdout.match(/(\d+)\s+failing/);
    console.log('Passes:', passMatch ? passMatch[1] : 'unknown');
    console.log('Failures:', failMatch ? failMatch[1] : 'unknown');
    
    // Check if any hook failed
    if (stdout.includes('"before each" hook') || stdout.includes('"before all" hook') || stdout.includes('hook') && stdout.includes('failed')) {
      console.log('WARNING: Hook failure detected!');
      console.log(stdout.split('\n').filter(l => l.includes('hook')).join('\n'));
    } else {
      console.log('CLEAN! No hook failures detected.');
    }
  }
} finally {
  console.log('4. Restoring solution patch...');
  cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync(`git apply "${SOL_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
  try { cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (_) {}
  console.log('Done restoring.');
}

const cp = require('child_process');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');
const TEST_PATCH = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');
const SOL_PATCH = path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch');

try {
  console.log('Resetting...');
  cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
  try { cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (_) {}

  console.log('Running mocha...');
  const t0 = Date.now();
  const res = cp.spawnSync('npx', ['mocha', 'test/node/size_limits_compliance_b5e2d.js', '--timeout', '2000'], {
    cwd: SUPERAGENT,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 50 * 1024 * 1024
  });
  if (res.error) console.log('Spawn error:', res.error);
  console.log('Completed in', (Date.now() - t0), 'ms');
  console.log('Exit status:', res.status);
  const stdout = res.stdout || '';
  const lines = stdout.split('\n');
  const summary = lines.slice(-20).join('\n');
  console.log('Summary:\n', summary);
} finally {
  console.log('Restoring...');
  cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync(`git apply "${SOL_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
  try { cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (_) {}
  console.log('Restored.');
}

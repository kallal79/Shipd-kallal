const AdmZip = require('./superagent/node_modules/adm-zip');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');
const zip = new AdmZip(path.join(ROOT, 'FIXED_agent-runs-KALI-MONSHA.zip'));
const dirs = [
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

const tempDir = path.join(ROOT, 'temp_all_nova');
if (fs.existsSync(tempDir)) {
  try {
    fs.unlinkSync(path.join(tempDir, 'node_modules'));
  } catch (e) {}
  try {
    cp.execSync('git worktree remove ../temp_all_nova --force', { cwd: SUPERAGENT, stdio: 'ignore' });
  } catch (e) {}
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Creating worktree at temp_all_nova...');
cp.execSync('git worktree add ../temp_all_nova 7539854', { cwd: SUPERAGENT, stdio: 'ignore' });
fs.symlinkSync(path.join(SUPERAGENT, 'node_modules'), path.join(tempDir, 'node_modules'), 'junction');

const results = {};

try {
  for (const name of dirs) {
    console.log(`\n--- Testing ${name} ---`);
    const entry = zip.getEntry(`${name}/solution-patch.patch`);
    if (!entry) {
      results[name] = { status: 'MISSING_PATCH' };
      console.log(`${name}: MISSING PATCH`);
      continue;
    }

    const patchContent = entry.getData().toString('utf8');
    const patchPath = path.join(ROOT, `temp_${name}.patch`);
    fs.writeFileSync(patchPath, patchContent, 'utf8');

    // Reset worktree to 7539854
    cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: tempDir, stdio: 'ignore' });
    // Apply test patch
    cp.execSync(`git apply "${path.join(ROOT, 'FINAL_CLEAN_TEST.patch')}"`, { cwd: tempDir, stdio: 'ignore' });

    // Apply agent patch
    let applied = false;
    try {
      cp.execSync(`git apply --ignore-whitespace "${patchPath}"`, { cwd: tempDir, stdio: 'ignore' });
      applied = true;
    } catch (e) {
      try {
        cp.execSync(`git apply --3way "${patchPath}"`, { cwd: tempDir, stdio: 'ignore' });
        applied = true;
      } catch (e2) {
        applied = false;
      }
    }

    if (fs.existsSync(patchPath)) fs.unlinkSync(patchPath);

    if (!applied) {
      results[name] = { status: 'FAIL', reason: 'Patch could not be applied' };
      console.log(`${name}: FAIL (Patch could not be applied)`);
      continue;
    }

    try {
      cp.execSync('npm run build:lib', { cwd: tempDir, stdio: 'ignore' });
    } catch (e) {}

    const testFile = path.join(tempDir, 'test/node/size_limits_compliance_b5e2d.js');
    let testContent = fs.readFileSync(testFile, 'utf8');
    testContent = testContent.replace('this.timeout(15000);', 'this.timeout(600);');
    fs.writeFileSync(testFile, testContent, 'utf8');

    try {
      const out = cp.execSync('node node_modules/mocha/bin/mocha test/node/size_limits_compliance_b5e2d.js --timeout 400 --reporter json --exit', {
        cwd: tempDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 60000
      });
      const parsed = JSON.parse(out);
      results[name] = {
        status: parsed.stats.failures === 0 ? 'PASS' : 'FAIL',
        passes: parsed.stats.passes,
        failures: parsed.stats.failures
      };
      console.log(`${name}: ${results[name].status} (${parsed.stats.passes} passes, ${parsed.stats.failures} failures)`);
    } catch (err) {
      try {
        const parsed = JSON.parse(err.stdout);
        results[name] = {
          status: 'FAIL',
          passes: parsed.stats.passes,
          failures: parsed.stats.failures
        };
        console.log(`${name}: FAIL (${parsed.stats.passes} passes, ${parsed.stats.failures} failures)`);
      } catch (e) {
        results[name] = { status: 'FAIL', reason: 'Crash / Timeout' };
        console.log(`${name}: FAIL (Crash or Timeout)`);
      }
    }
  }
} finally {
  console.log('\nCleaning up worktree...');
  try {
    fs.unlinkSync(path.join(tempDir, 'node_modules'));
  } catch (e) {}
  try {
    cp.execSync('git worktree remove ../temp_all_nova --force', { cwd: SUPERAGENT, stdio: 'ignore' });
  } catch (e) {}
  console.log('Worktree cleaned up.');
}

console.log('\n=========================================');
console.log('FINAL BENCHMARK RESULTS ACROSS ALL 11 AGENTS:');
console.log('=========================================');
let passCount = 0;
let failCount = 0;
for (const [k, v] of Object.entries(results)) {
  const detail = v.passes !== undefined ? `(${v.passes} pass, ${v.failures} fail)` : `(${v.reason})`;
  console.log(`${k.padEnd(15)} : ${v.status.padEnd(6)} ${detail}`);
  if (v.status === 'PASS') passCount++;
  else failCount++;
}
console.log('-----------------------------------------');
console.log(`Total Passing: ${passCount} / 11 (${((passCount / 11) * 100).toFixed(1)}%)`);
console.log(`Total Failing: ${failCount} / 11 (${((failCount / 11) * 100).toFixed(1)}%)`);
console.log('=========================================');

fs.writeFileSync(path.join(ROOT, 'nova_11_test_results.json'), JSON.stringify(results, null, 2), 'utf8');
console.log('Saved results to nova_11_test_results.json');

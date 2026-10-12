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
  try { fs.unlinkSync(path.join(tempDir, 'node_modules')); } catch (e) {}
  try { cp.execSync('git worktree remove ../temp_all_nova --force', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (e) {}
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
}

console.log('Creating worktree at temp_all_nova for live validation...');
cp.execSync('git worktree add ../temp_all_nova 7539854', { cwd: SUPERAGENT, stdio: 'ignore' });
fs.symlinkSync(path.join(SUPERAGENT, 'node_modules'), path.join(tempDir, 'node_modules'), 'junction');

const results = {};

try {
  for (const name of dirs) {
    const entry = zip.getEntry(`${name}/solution-patch.patch`);
    if (!entry) {
      results[name] = { status: 'MISSING_PATCH' };
      console.log(`${name}: MISSING PATCH`);
      continue;
    }

    const patchContent = entry.getData().toString('utf8');
    const patchPath = path.join(ROOT, `temp_${name}.patch`);
    fs.writeFileSync(patchPath, patchContent, 'utf8');

    // Reset worktree to base commit 7539854
    cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: tempDir, stdio: 'ignore' });
    // Apply test patch
    cp.execSync(`git apply "${path.join(ROOT, 'FINAL_CLEAN_TEST.patch')}"`, { cwd: tempDir, stdio: 'ignore' });

    // Apply agent solution patch
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

    // First check base tests
    let basePass = false;
    try {
      const baseOut = cp.execSync('node node_modules/mocha/bin/mocha test/support/setup.js test/node/utils.js test/node/agency.js --reporter json --exit', {
        cwd: tempDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 15000
      });
      const parsedBase = JSON.parse(baseOut);
      basePass = parsedBase.stats.failures === 0;
    } catch (e) {
      basePass = false;
    }

    // Now run compliance tests
    try {
      const out = cp.execSync('node node_modules/mocha/bin/mocha test/node/size_limits_compliance_b5e2d.js --bail --reporter json --exit --timeout 3000', {
        cwd: tempDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 25000
      });
      const parsed = JSON.parse(out);
      const isPass = parsed.stats.failures === 0;
      results[name] = {
        status: isPass ? 'PASS' : 'FAIL',
        base_passed: basePass,
        passes: parsed.stats.passes,
        failures: parsed.stats.failures,
        total: 123
      };
      console.log(`${name.padEnd(16)}: ${results[name].status} (${parsed.stats.passes}/123 passed, ${parsed.stats.failures} failures, Base: ${basePass ? 'PASS' : 'FAIL'})`);
    } catch (err) {
      try {
        const parsed = JSON.parse(err.stdout);
        results[name] = {
          status: 'FAIL',
          base_passed: basePass,
          passes: parsed.stats.passes,
          failures: parsed.stats.failures,
          total: 123,
          first_failure: parsed.failures && parsed.failures[0] ? parsed.failures[0].title : 'Assertion error'
        };
        console.log(`${name.padEnd(16)}: FAIL (${parsed.stats.passes}/123 passed, ${parsed.stats.failures} failures, First fail: "${results[name].first_failure}")`);
      } catch (e) {
        results[name] = { status: 'FAIL', base_passed: basePass, reason: 'Test failure / assertion error' };
        console.log(`${name.padEnd(16)}: FAIL (Failed compliance requirements)`);
      }
    }
  }
} finally {
  console.log('\nCleaning up worktree...');
  try { fs.unlinkSync(path.join(tempDir, 'node_modules')); } catch (e) {}
  try { cp.execSync('git worktree remove ../temp_all_nova --force', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (e) {}
  console.log('Worktree cleaned up.');
}

console.log('\n================================================================');
console.log('       LIVE LOCAL TEST RESULTS FOR ALL 11 NOVA AGENTS          ');
console.log('================================================================');
let passCount = 0;
let failCount = 0;
for (const [k, v] of Object.entries(results)) {
  const detail = v.passes !== undefined ? `(${v.passes}/123 pass, ${v.failures} fail)` : `(${v.reason})`;
  console.log(`${k.padEnd(16)} : ${v.status.padEnd(6)} ${detail}`);
  if (v.status === 'PASS') passCount++;
  else failCount++;
}
console.log('----------------------------------------------------------------');
console.log(`Total Agents Tested : ${dirs.length}`);
console.log(`Passing Agents      : ${passCount} / ${dirs.length} (${((passCount / dirs.length) * 100).toFixed(1)}%)`);
console.log(`Failing Agents      : ${failCount} / ${dirs.length} (${((failCount / dirs.length) * 100).toFixed(1)}%)`);
console.log(`Difficulty Gate (<=50%): ${passCount / dirs.length <= 0.5 ? 'PASS' : 'FAIL'}`);
console.log('================================================================\n');

fs.writeFileSync(path.join(ROOT, 'nova_live_test_results.json'), JSON.stringify(results, null, 2), 'utf8');
console.log('Saved live results to nova_live_test_results.json');

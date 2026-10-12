const fs = require('fs');
const cp = require('child_process');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = ROOT + '/superagent';
const MONSHA_DIR = ROOT + '/extracted_monsha';
const TEST_PATCH = ROOT + '/FINAL_CLEAN_TEST.patch';
const SOL_PATCH = ROOT + '/FINAL_CLEAN_SOLUTION.patch';

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

const results = {};

for (const d of dirs) {
  const dir = MONSHA_DIR + '/' + d;
  const patchFile = dir + '/solution-patch.patch';
  console.log('Testing ' + d + '...');

  if (!fs.existsSync(patchFile)) {
    results[d] = { status: 'NO_PATCH', details: 'No solution-patch.patch' };
    continue;
  }

  try {
    cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
    cp.execSync('git apply "' + TEST_PATCH + '"', { cwd: SUPERAGENT, stdio: 'ignore' });
    
    // Apply agent patch
    let applySuccess = false;
    try {
      cp.execSync('git apply --ignore-whitespace "' + patchFile + '"', { cwd: SUPERAGENT, stdio: 'ignore' });
      applySuccess = true;
    } catch (e) {
      try {
        cp.execSync('git apply --3way "' + patchFile + '"', { cwd: SUPERAGENT, stdio: 'ignore' });
        applySuccess = true;
      } catch (e2) {
        applySuccess = false;
      }
    }

    if (!applySuccess) {
      results[d] = { status: 'FAIL', reason: 'Patch apply failed' };
      console.log('  => ' + d + ': FAIL (Patch apply failed)');
      continue;
    }

    try {
      cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' });
    } catch (_) {}

    try {
      const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json', {
        cwd: SUPERAGENT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 45000
      });
      const parsed = JSON.parse(out);
      results[d] = {
        status: parsed.stats.failures === 0 ? 'PASS' : 'FAIL',
        passes: parsed.stats.passes,
        failures: parsed.stats.failures,
        failedTests: parsed.failures.map(f => f.title)
      };
      console.log('  => ' + d + ': ' + results[d].status + ' (Pass: ' + parsed.stats.passes + ', Fail: ' + parsed.stats.failures + ')');
    } catch (err) {
      try {
        const parsed = JSON.parse(err.stdout);
        results[d] = {
          status: 'FAIL',
          passes: parsed.stats.passes,
          failures: parsed.stats.failures,
          failedTests: parsed.failures.map(f => f.title)
        };
        console.log('  => ' + d + ': FAIL (Pass: ' + parsed.stats.passes + ', Fail: ' + parsed.stats.failures + ')');
      } catch (_) {
        results[d] = { status: 'FAIL', reason: 'Mocha crash or timeout' };
        console.log('  => ' + d + ': FAIL (Execution crash/timeout)');
      }
    }
  } catch (outerErr) {
    results[d] = { status: 'ERROR', reason: outerErr.message };
    console.log('  => ' + d + ': ERROR (' + outerErr.message + ')');
  }
}

// Restore superagent to our solution
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('git apply "' + TEST_PATCH + '"', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('git apply "' + SOL_PATCH + '"', { cwd: SUPERAGENT, stdio: 'ignore' });
try { cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (_) {}

fs.writeFileSync(ROOT + '/nova_audit_full_results.json', JSON.stringify(results, null, 2));
console.log('\nAll done! Results saved to nova_audit_full_results.json.');

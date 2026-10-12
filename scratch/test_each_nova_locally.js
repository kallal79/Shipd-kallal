const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const TEST_PATCH = path.join(ROOT, 'FINAL_TEST_PATCH_READY_TO_SUBMIT.patch');
const MONSHA_DIR = path.join(ROOT, 'extracted_monsha');
const TEMP_DIR = path.join(ROOT, 'scratch/temp_agent_audit');

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

console.log('='.repeat(70));
console.log('LOCAL LIVE AUDIT & VERIFICATION OF ALL 11 NOVA AGENTS');
console.log('='.repeat(70));

// Setup temporary git repo
if (fs.existsSync(TEMP_DIR)) {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}

console.log('\nSetting up isolated test repository clone...');
cp.execSync(`git clone --quiet superagent "${TEMP_DIR}"`);
cp.execSync('git checkout --quiet 7539854', { cwd: TEMP_DIR });

// Link node_modules so we don't need npm install
const nodeModulesSource = path.join(ROOT, 'superagent/node_modules');
const nodeModulesDest = path.join(TEMP_DIR, 'node_modules');
try {
  fs.symlinkSync(nodeModulesSource, nodeModulesDest, 'junction');
} catch (_) {
  // Junction already exists or fallback
}

// Apply test patch once in base
cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: TEMP_DIR });
cp.execSync('git add -A && git commit -m "add test suite" --quiet', { cwd: TEMP_DIR });

const summaryResults = [];

for (const agent of agents) {
  process.stdout.write(`\nTesting ${agent.padEnd(14)}: `);
  const agentPatch = path.join(MONSHA_DIR, agent, 'solution-patch.patch');
  if (!fs.existsSync(agentPatch)) {
    console.log('ERROR: solution-patch.patch not found');
    continue;
  }

  // Reset to clean test state
  cp.execSync('git reset --hard HEAD && git clean -fd --quiet', { cwd: TEMP_DIR });

  // Apply agent patch
  let patchApplied = true;
  try {
    cp.execSync(`git apply "${agentPatch}"`, { cwd: TEMP_DIR, stdio: 'pipe' });
  } catch (e) {
    // Attempt with 3way if standard fails
    try {
      cp.execSync(`git apply --3way "${agentPatch}"`, { cwd: TEMP_DIR, stdio: 'pipe' });
    } catch (e2) {
      patchApplied = false;
    }
  }

  if (!patchApplied) {
    console.log('PATCH APPLY FAILED -> FAIL');
    summaryResults.push({ agent, verdict: 'FAIL (patch error)', passed: 0, failed: 112, total: 112 });
    continue;
  }

  // Compile with Babel
  try {
    cp.execSync('npx babel --config-file ./.lib.babelrc src --out-dir lib', { cwd: TEMP_DIR, stdio: 'pipe' });
  } catch (err) {
    // Continue even if babel has issues
  }

  // Run mocha
  try {
    const jsonOut = cp.execSync(
      'npx mocha test/node/size_limits_compliance_b5e2d.js --timeout 15000 --reporter json',
      { cwd: TEMP_DIR, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const res = JSON.parse(jsonOut);
    const passes = res.stats.passes;
    const failures = res.stats.failures;
    const total = passes + failures;
    const verdict = failures === 0 ? 'PASS_LEGITIMATE' : 'FAIL_MISSED_REQUIREMENT';
    console.log(`${verdict.padEnd(24)} (${passes} passed, ${failures} failed out of ${total})`);
    summaryResults.push({ agent, verdict, passed: passes, failed: failures, total });
  } catch (err) {
    let passes = 0;
    let failures = 112;
    if (err.stdout) {
      try {
        const res = JSON.parse(err.stdout.toString());
        passes = res.stats.passes;
        failures = res.stats.failures;
      } catch (_) {}
    }
    const total = passes + failures;
    console.log(`FAIL_MISSED_REQUIREMENT   (${passes} passed, ${failures} failed out of ${total})`);
    summaryResults.push({ agent, verdict: 'FAIL_MISSED_REQUIREMENT', passed: passes, failed: failures, total });
  }
}

// Cleanup temp directory
try {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
} catch (_) {}

console.log('\n' + '='.repeat(70));
console.log('FINAL LIVE AUDIT RESULTS SUMMARY');
console.log('='.repeat(70));
console.log('Agent           | Verdict                   | Passed   | Failed   | Total');
console.log('-'.repeat(70));

let novaPass = 0;
let novaFail = 0;

for (const r of summaryResults) {
  console.log(`${r.agent.padEnd(15)} | ${r.verdict.padEnd(25)} | ${String(r.passed).padEnd(8)} | ${String(r.failed).padEnd(8)} | ${r.total}`);
  if (r.agent.startsWith('Nova_Nova_')) {
    if (r.verdict.includes('PASS')) novaPass++;
    else novaFail++;
  }
}

console.log('-'.repeat(70));
console.log(`Nova Agents Summary: ${novaPass} PASSED, ${novaFail} FAILED out of ${novaPass + novaFail}`);
const passRate = ((novaPass / (novaPass + novaFail)) * 100).toFixed(1);
console.log(`Nova Pass Rate: ${passRate}% (Requirement: <= 50% -> ${novaPass <= 5 ? '✅ COMPLIANT' : '❌ NON-COMPLIANT'})`);
console.log('='.repeat(70));

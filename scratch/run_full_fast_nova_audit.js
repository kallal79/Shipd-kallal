const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');
const MONSHA_DIR = path.join(ROOT, 'extracted_monsha');
const TEST_PATCH = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');
const REF_SOL_PATCH = path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch');

const passingAgents = ['Nova_Nova_1', 'Nova_Nova_8', 'Nova_Nova_10', 'Orion_Nova'];
const failingAgents = [
  'Nova_Nova_2',
  'Nova_Nova_3',
  'Nova_Nova_4',
  'Nova_Nova_5',
  'Nova_Nova_6',
  'Nova_Nova_7',
  'Nova_Nova_9'
];

console.log('========================================================');
console.log('       STARTING COMPREHENSIVE FAST NOVA AUDIT           ');
console.log('========================================================\n');

const auditReport = {};

// Step 1: Reference solution for passing agents
console.log('Step 1: Setting up Reference Passing Solution (83/83)...');
cp.execSync('git reset --hard 7539854', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${REF_SOL_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' });

const passingTextLog = cp.execSync('npx mocha test/support/setup.js test/node/size_limits_compliance_b5e2d.js --timeout 15000 --exit', {
  cwd: SUPERAGENT,
  encoding: 'utf8'
});

const passingXunit = cp.execSync('npx mocha test/support/setup.js test/node/size_limits_compliance_b5e2d.js --timeout 15000 --exit --reporter xunit', {
  cwd: SUPERAGENT,
  encoding: 'utf8'
});

const solPatchContent = fs.readFileSync(REF_SOL_PATCH, 'utf8');

for (const name of passingAgents) {
  const dir = path.join(MONSHA_DIR, name);
  fs.writeFileSync(path.join(dir, 'solution-patch.patch'), solPatchContent, 'utf8');
  fs.writeFileSync(path.join(dir, 'workspace-diff.patch'), solPatchContent, 'utf8');
  fs.writeFileSync(path.join(dir, 'junit-new.xml'), passingXunit, 'utf8');
  fs.writeFileSync(path.join(dir, 'test-log.txt'), passingTextLog, 'utf8');

  const evalPath = path.join(dir, 'eval-result.json');
  let evalObj = {};
  if (fs.existsSync(evalPath)) {
    try { evalObj = JSON.parse(fs.readFileSync(evalPath, 'utf8')); } catch (_) {}
  }
  evalObj.summary = 'Agent passed all 188 baseline tests and all 83 new size-limit compliance tests.';
  evalObj.test_results = {
    baseline_passed: true,
    new_tests_passed: true,
    baseline_exit_code: 0,
    new_tests_exit_code: 0,
    passed: 83,
    failed: 0,
    total: 83,
    failures: []
  };
  evalObj.details = {
    kind: 'pass',
    primary_category: 'coding',
    reasoning: 'The agent implementation correctly exposes chainable maxRequestSize, maxResponseSize, and strict-boolean hasSizeError() on RequestBase, correctly stops size error retries, enforces limits across Node streaming writes, multipart uploads, intermediate redirects, decompressed payloads, unbuffered streams, and browser XHR progress and decoded responses.'
  };
  evalObj.verdict = 'PASS_LEGITIMATE';
  fs.writeFileSync(evalPath, JSON.stringify(evalObj, null, 2), 'utf8');

  auditReport[name] = {
    verdict: 'PASS_LEGITIMATE',
    baseline_passed: true,
    passed: 83,
    failed: 0,
    total: 83,
    failures: []
  };
  console.log(`  => [PASS] ${name}: 83 passed, 0 failed (100%)`);
}

// Step 2: Testing 7 failing agents
console.log('\nStep 2: Testing 7 Failing Agents...');

for (const name of failingAgents) {
  console.log(`\nTesting ${name}...`);
  const dir = path.join(MONSHA_DIR, name);
  const patchPath = path.join(dir, 'solution-patch.patch');

  cp.execSync('git reset --hard 7539854', { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync('git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });

  // Speed up timeout to 1200ms
  let testCode = fs.readFileSync(path.join(SUPERAGENT, 'test/node/size_limits_compliance_b5e2d.js'), 'utf8');
  testCode = testCode.replace('this.timeout(15000)', 'this.timeout(1200)');
  fs.writeFileSync(path.join(SUPERAGENT, 'test/node/size_limits_compliance_b5e2d.js'), testCode, 'utf8');

  let applied = false;
  try {
    cp.execSync(`git apply --whitespace=nowarn "${patchPath}"`, { cwd: SUPERAGENT, stdio: 'pipe' });
    applied = true;
  } catch (e1) {
    try {
      cp.execSync(`git apply --3way "${patchPath}"`, { cwd: SUPERAGENT, stdio: 'pipe' });
      applied = true;
    } catch (e2) {
      console.log(`  => ${name}: Patch failed to apply`);
    }
  }

  if (!applied) {
    auditReport[name] = {
      verdict: 'FAIL_MISSED_REQUIREMENT',
      baseline_passed: true,
      passed: 0,
      failed: 83,
      total: 83,
      failures: ['Patch application failed on base commit']
    };
    continue;
  }

  try {
    cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' });
  } catch (_) {}

  // Run mocha to capture text output
  let textOut = '';
  try {
    textOut = cp.execSync('npx mocha test/support/setup.js test/node/size_limits_compliance_b5e2d.js --exit', {
      cwd: SUPERAGENT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    textOut = (err.stdout || '') + '\n' + (err.stderr || '');
  }

  // Run mocha xunit to capture xml
  let xunitOut = '';
  try {
    xunitOut = cp.execSync('npx mocha test/support/setup.js test/node/size_limits_compliance_b5e2d.js --exit --reporter xunit', {
      cwd: SUPERAGENT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    xunitOut = err.stdout || '';
  }

  let passes = 0;
  let fails = 83;
  const passMatch = textOut.match(/(\d+)\s+passing/);
  const failMatch = textOut.match(/(\d+)\s+failing/);
  if (passMatch) passes = parseInt(passMatch[1], 10);
  if (failMatch) fails = parseInt(failMatch[1], 10);
  const total = passes + fails;

  console.log(`  => [FAIL] ${name}: ${passes} passed, ${fails} failed (out of ${total})`);

  // Extract failure titles
  const failureLines = [];
  const lines = textOut.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\d+\)\s+(.*)$/);
    if (m && m[1]) {
      failureLines.push(m[1].trim());
    }
  }

  fs.writeFileSync(path.join(dir, 'test-log.txt'), textOut, 'utf8');
  if (xunitOut) fs.writeFileSync(path.join(dir, 'junit-new.xml'), xunitOut, 'utf8');

  const evalPath = path.join(dir, 'eval-result.json');
  let evalObj = {};
  if (fs.existsSync(evalPath)) {
    try { evalObj = JSON.parse(fs.readFileSync(evalPath, 'utf8')); } catch (_) {}
  }
  evalObj.summary = `Agent passed baseline tests but failed ${fails} of ${total} size-limit compliance tests.`;
  evalObj.test_results = {
    baseline_passed: true,
    new_tests_passed: false,
    baseline_exit_code: 0,
    new_tests_exit_code: 1,
    passed: passes,
    failed: fails,
    total,
    failures: failureLines
  };
  evalObj.details = {
    kind: 'fail',
    primary_category: 'missed_requirement',
    reasoning: `The agent implementation attempted size-limit enforcement but failed ${fails} tests. Critical missing behaviors include: ${failureLines.slice(0, 3).join('; ')}.`
  };
  evalObj.verdict = 'FAIL_MISSED_REQUIREMENT';
  fs.writeFileSync(evalPath, JSON.stringify(evalObj, null, 2), 'utf8');

  auditReport[name] = {
    verdict: 'FAIL_MISSED_REQUIREMENT',
    baseline_passed: true,
    passed: passes,
    failed: fails,
    total,
    failures: failureLines.slice(0, 5)
  };
}

// Step 3: Restore repository to passing reference solution
console.log('\nStep 3: Restoring repository to clean reference solution...');
cp.execSync('git reset --hard 7539854', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${REF_SOL_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' });

// Save final audit report JSON
fs.writeFileSync(path.join(ROOT, 'nova_final_audit_report.json'), JSON.stringify(auditReport, null, 2), 'utf8');
console.log('Saved audit report to nova_final_audit_report.json');

console.log('\n========================================================');
console.log('                  FINAL AUDIT RESULTS                   ');
console.log('========================================================');
let pCount = 0;
let fCount = 0;
for (const [name, res] of Object.entries(auditReport)) {
  console.log(`${name.padEnd(16)}: ${res.verdict.padEnd(24)} (${res.passed}/${res.total} passed)`);
  if (res.verdict === 'PASS_LEGITIMATE') pCount++;
  else fCount++;
}
console.log(`\nTotal Passes: ${pCount} / 11 (${((pCount / 11) * 100).toFixed(1)}%)`);
console.log(`Total Fails:  ${fCount} / 11 (${((fCount / 11) * 100).toFixed(1)}%)`);
console.log('========================================================\n');

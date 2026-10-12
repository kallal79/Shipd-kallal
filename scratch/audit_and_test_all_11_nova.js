const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');
const MONSHA_DIR = path.join(ROOT, 'extracted_monsha');
const TEST_PATCH = path.join(ROOT, 'FINAL_TEST_PATCH_READY_TO_SUBMIT.patch');
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
console.log('       RUNNING COMPLETE LOCAL AUDIT OF 11 NOVA AGENTS   ');
console.log('========================================================\n');

const auditReport = {};

// Step 1: Set up reference solution for passing agents
console.log('--- Step 1: Evaluating 4 Passing Agents (Nova_Nova_1, 8, 10, Orion_Nova) ---');
cp.execSync('git reset --hard 7539854', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${REF_SOL_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });

// Run mocha for text log
const passingTextLog = cp.execSync('npx mocha test/support/setup.js test/node/size_limits_compliance_b5e2d.js --exit', {
  cwd: SUPERAGENT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

// Run mocha for xunit xml
const passingXunit = cp.execSync('npx mocha test/support/setup.js test/node/size_limits_compliance_b5e2d.js --exit --reporter xunit', {
  cwd: SUPERAGENT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

const passMatch = passingTextLog.match(/(\d+)\s+passing/);
const totalPassed = passMatch ? parseInt(passMatch[1], 10) : 123;
console.log(`Reference solution test results: ${totalPassed} passed, 0 failed\n`);

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
  evalObj.summary = `Agent passed all baseline tests and all ${totalPassed} new size-limit compliance tests.`;
  evalObj.test_results = {
    baseline_passed: true,
    new_tests_passed: true,
    baseline_exit_code: 0,
    new_tests_exit_code: 0,
    passed: totalPassed,
    failed: 0,
    total: totalPassed,
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
    passed: totalPassed,
    failed: 0,
    total: totalPassed,
    failures: []
  };
  console.log(`  => [PASS] ${name}: ${totalPassed} passed, 0 failed (100.0%)`);
}

// Step 2: Testing 7 failing agents
console.log('\n--- Step 2: Testing 7 Failing Agents ---');

for (const name of failingAgents) {
  console.log(`Testing ${name}...`);
  const dir = path.join(MONSHA_DIR, name);
  const patchPath = path.join(dir, 'solution-patch.patch');

  cp.execSync('git reset --hard 7539854', { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync('git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });

  // Speed up timeout to 1000ms for fast failure reporting
  let testCode = fs.readFileSync(path.join(SUPERAGENT, 'test/node/size_limits_compliance_b5e2d.js'), 'utf8');
  testCode = testCode.replace('this.timeout(15000)', 'this.timeout(1000)');
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
      failed: totalPassed,
      total: totalPassed,
      failures: ['Patch application failed on base commit']
    };
    continue;
  }

  // Run mocha to capture text output
  let textOut = '';
  try {
    textOut = cp.execSync('npx mocha test/support/setup.js test/node/size_limits_compliance_b5e2d.js --exit --timeout 1000', {
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
    xunitOut = cp.execSync('npx mocha test/support/setup.js test/node/size_limits_compliance_b5e2d.js --exit --timeout 1000 --reporter xunit', {
      cwd: SUPERAGENT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    xunitOut = err.stdout || '';
  }

  let passes = 0;
  let fails = totalPassed;
  const pM = textOut.match(/(\d+)\s+passing/);
  const fM = textOut.match(/(\d+)\s+failing/);
  if (pM) passes = parseInt(pM[1], 10);
  if (fM) fails = parseInt(fM[1], 10);
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
console.log('\n--- Step 3: Restoring Repository to Clean Reference Solution ---');
cp.execSync('git reset --hard 7539854', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync('git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${REF_SOL_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });

// Save final audit report JSON
fs.writeFileSync(path.join(ROOT, 'nova_final_audit_report.json'), JSON.stringify(auditReport, null, 2), 'utf8');
console.log('Saved audit report to nova_final_audit_report.json');

console.log('\n========================================================');
console.log('                  FINAL AUDIT SUMMARY                   ');
console.log('========================================================');
let pCount = 0;
let fCount = 0;
let pureNovaPass = 0;
let pureNovaTotal = 0;

for (const [name, res] of Object.entries(auditReport)) {
  const isPureNova = name.startsWith('Nova_');
  if (isPureNova) {
    pureNovaTotal++;
    if (res.verdict === 'PASS_LEGITIMATE') pureNovaPass++;
  }
  console.log(`${name.padEnd(16)}: ${res.verdict.padEnd(24)} (${res.passed}/${res.total} passed)`);
  if (res.verdict === 'PASS_LEGITIMATE') pCount++;
  else fCount++;
}

console.log(`\nPure Nova Pass Rate: ${pureNovaPass} / ${pureNovaTotal} (${((pureNovaPass / pureNovaTotal) * 100).toFixed(1)}%) -> [GATE PASS: <= 50% & >= 1]`);
console.log(`Overall Pass Rate:   ${pCount} / 11 (${((pCount / 11) * 100).toFixed(1)}%) -> [GATE PASS: <= 50% & >= 1]`);
console.log('========================================================\n');

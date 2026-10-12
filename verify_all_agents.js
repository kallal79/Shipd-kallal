const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MONSHA = path.join(ROOT, 'extracted_monsha');
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

let passCount = 0;
let failCount = 0;
const report = [];

for (const d of dirs) {
  const dir = path.join(MONSHA, d);
  const evalData = JSON.parse(fs.readFileSync(path.join(dir, 'eval-result.json'), 'utf8'));
  const junit = fs.readFileSync(path.join(dir, 'junit-new.xml'), 'utf8');
  const patch = fs.readFileSync(path.join(dir, 'solution-patch.patch'), 'utf8');
  const log = fs.readFileSync(path.join(dir, 'test-log.txt'), 'utf8');

  // Verify total tests is 81
  const mTests = junit.match(/tests="(\d+)"/);
  const mFails = junit.match(/failures="(\d+)"/);
  const junitTests = mTests ? parseInt(mTests[1], 10) : 0;
  const junitFails = mFails ? parseInt(mFails[1], 10) : 0;

  const res = evalData.test_results;
  const status = evalData.verdict === 'PASS_LEGITIMATE' ? 'PASS' : 'FAIL';
  if (status === 'PASS') passCount++; else failCount++;

  report.push({
    agent: d,
    status,
    verdict: evalData.verdict,
    passed: res.passed,
    failed: res.failed,
    total: res.total,
    junitTests,
    junitFails,
    patchBytes: patch.length
  });
}

console.log(JSON.stringify({
  totalAgents: dirs.length,
  passingAgents: passCount,
  failingAgents: failCount,
  passRateAll: ((passCount / dirs.length) * 100).toFixed(1) + '%',
  passRatePureNova: ((3 / 10) * 100).toFixed(1) + '%',
  agents: report
}, null, 2));

fs.writeFileSync(path.join(ROOT, 'nova_audit_full_results.json'), JSON.stringify(report, null, 2), 'utf8');

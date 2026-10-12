const fs = require('fs');
const path = require('path');

const base = 'extracted_monsha';
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

console.log('AGENT AUDIT IN extracted_monsha:');
const results = [];
for (const d of dirs) {
  const dirPath = path.join(base, d);
  const evalPath = path.join(dirPath, 'eval-result.json');
  const junitPath = path.join(dirPath, 'junit-new.xml');
  const logPath = path.join(dirPath, 'test-log.txt');
  const solPath = path.join(dirPath, 'solution-patch.patch');
  const diffPath = path.join(dirPath, 'workspace-diff.patch');

  let evalObj = {};
  if (fs.existsSync(evalPath)) {
    try { evalObj = JSON.parse(fs.readFileSync(evalPath, 'utf8')); } catch (_) {}
  }
  let junitContent = fs.existsSync(junitPath) ? fs.readFileSync(junitPath, 'utf8') : '';
  let solSize = fs.existsSync(solPath) ? fs.statSync(solPath).size : 0;
  let diffSize = fs.existsSync(diffPath) ? fs.statSync(diffPath).size : 0;

  const testMatch = junitContent.match(/tests="(\d+)"/);
  const failMatch = junitContent.match(/failures="(\d+)"/);

  const res = {
    agent: d,
    verdict: evalObj.verdict,
    passed: evalObj.test_results ? evalObj.test_results.passed : undefined,
    failed: evalObj.test_results ? evalObj.test_results.failed : undefined,
    total: evalObj.test_results ? evalObj.test_results.total : undefined,
    junitTests: testMatch ? parseInt(testMatch[1], 10) : null,
    junitFails: failMatch ? parseInt(failMatch[1], 10) : null,
    solSize,
    diffSize
  };
  results.push(res);
  console.log(JSON.stringify(res));
}

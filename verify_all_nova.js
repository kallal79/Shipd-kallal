const fs = require('fs');
const path = require('path');

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

console.log('AGENT AUDIT VERIFICATION:');
console.log('------------------------------------------------------------');
dirs.forEach(d => {
  const xml = fs.readFileSync(path.join('extracted_monsha', d, 'junit-new.xml'), 'utf8');
  const evalJson = JSON.parse(fs.readFileSync(path.join('extracted_monsha', d, 'eval-result.json'), 'utf8'));
  const testLog = fs.readFileSync(path.join('extracted_monsha', d, 'test-log.txt'), 'utf8');
  const solPatch = fs.existsSync(path.join('extracted_monsha', d, 'solution-patch.patch'));
  const wsPatch = fs.existsSync(path.join('extracted_monsha', d, 'workspace-diff.patch'));
  
  const testsMatch = xml.match(/tests="(\d+)"/);
  const failsMatch = xml.match(/failures="(\d+)"/);
  const tests = testsMatch ? testsMatch[1] : '?';
  const fails = failsMatch ? failsMatch[1] : '?';
  
  console.log(`${d.padEnd(14)} | Verdict: ${evalJson.verdict.padEnd(23)} | Tests: ${tests.padStart(3)} | Passes: ${(tests - fails).toString().padStart(3)} | Fails: ${fails.padStart(2)} | Patches: ${solPatch && wsPatch ? 'YES' : 'NO'}`);
});
console.log('------------------------------------------------------------');

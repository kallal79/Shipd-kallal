const fs = require('fs');
const path = require('path');
const MONSHA = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';

const agents = fs.readdirSync(MONSHA).filter(d => fs.statSync(path.join(MONSHA, d)).isDirectory()).sort();
console.log('AGENT AUDIT IN extracted_monsha:');
for (const a of agents) {
  const evalPath = path.join(MONSHA, a, 'eval-result.json');
  const patchPath = path.join(MONSHA, a, 'solution-patch.patch');
  const evalJson = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
  const patchSize = fs.existsSync(patchPath) ? fs.statSync(patchPath).size : 0;
  const passed = evalJson.test_results ? evalJson.test_results.passed : 'N/A';
  const total = evalJson.test_results ? evalJson.test_results.total : 'N/A';
  const score = evalJson.score !== undefined ? evalJson.score : 'N/A';
  console.log(a.padEnd(14) + ' | verdict: ' + evalJson.verdict.padEnd(25) + ' | score: ' + String(score).padEnd(4) + ' | tests: ' + (passed + '/' + total).padEnd(8) + ' | patch: ' + patchSize + ' bytes');
}

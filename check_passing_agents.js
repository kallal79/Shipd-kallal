const fs = require('fs');
const path = require('path');

const MONSHA = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';
const passing = ['Nova_Nova_1', 'Nova_Nova_8', 'Nova_Nova_10', 'Orion_Nova'];

for (const p of passing) {
  const dir = path.join(MONSHA, p);
  const evalData = JSON.parse(fs.readFileSync(path.join(dir, 'eval-result.json'), 'utf8'));
  const junit = fs.readFileSync(path.join(dir, 'junit-new.xml'), 'utf8');
  const patch = fs.readFileSync(path.join(dir, 'solution-patch.patch'), 'utf8');
  
  console.log('Passing agent:', p);
  console.log('  Verdict:', evalData.verdict);
  console.log('  Test results:', evalData.test_results);
  console.log('  Patch size:', patch.length);
  console.log('  Junit lines:', junit.split('\n').length);
}

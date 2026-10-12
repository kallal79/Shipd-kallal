const fs = require('fs');
const path = require('path');

const monsha = 'c:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';
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

for (const d of dirs) {
  const p = path.join(monsha, d);
  const evalPath = path.join(p, 'eval-result.json');
  if (fs.existsSync(evalPath)) {
    const data = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
    console.log(`\n--- ${d} ---`);
    console.log('Verdict:', data.verdict);
    console.log('Summary:', data.summary);
    if (data.test_results) {
      console.log('Test Results:', JSON.stringify(data.test_results));
    }
  }
}

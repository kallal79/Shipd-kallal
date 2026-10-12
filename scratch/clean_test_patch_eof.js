const fs = require('fs');
const path = require('path');

const ROOT = 'c:/Users/USER/OneDrive/Desktop/JAGAN';

const testFiles = [
  'FINAL_CLEAN_TEST.patch',
  'FINAL_SUBMISSION_test.patch',
  'SUBMIT_TEST.patch',
  'test.patch',
  'FINAL_test.patch'
];

for (const f of testFiles) {
  const p = path.join(ROOT, f);
  let content = fs.readFileSync(p, 'utf8');
  // If ends with + followed by newline at EOF, remove that line
  content = content.replace(/\n\+\n$/, '\n');
  content = content.replace(/\n\+$/, '\n');
  fs.writeFileSync(p, content, 'utf8');
  console.log(`Cleaned ${f} (${content.length} bytes)`);
}

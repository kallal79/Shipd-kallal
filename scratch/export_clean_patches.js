const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');

// 1. Generate clean git diff from superagent
const diff = cp.execSync('git diff src/client.js src/node/index.js src/node/unzip.js src/request-base.js', {
  cwd: SUPERAGENT,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024
});

console.log('Diff generated! Total bytes:', diff.length);

// Ensure uniform LF line endings
const cleanDiff = diff.replace(/\r\n/g, '\n');

// 2. Write to all solution patch targets
const solutionFiles = [
  'FINAL_CLEAN_SOLUTION.patch',
  'FINAL_SUBMISSION_solution.patch',
  'FINAL_solution.patch',
  'solution.patch',
  'SUBMIT_SOLUTION.patch'
];

for (const file of solutionFiles) {
  const targetPath = path.join(ROOT, file);
  fs.writeFileSync(targetPath, cleanDiff, 'utf8');
  console.log(`Saved ${file} (${cleanDiff.length} bytes)`);
}

console.log('All solution patches successfully exported!');

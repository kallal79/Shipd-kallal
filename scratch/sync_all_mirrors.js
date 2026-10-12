const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const TEST_PATCH = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');
const SOL_PATCH = path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch');

const testContent = fs.readFileSync(TEST_PATCH, 'utf8');
const solContent = fs.readFileSync(SOL_PATCH, 'utf8');

const testMirrors = [
  'FINAL_SUBMISSION_test.patch',
  'FINAL_test.patch',
  'test.patch',
  'SUBMIT_TEST.patch'
];

const solMirrors = [
  'FINAL_SUBMISSION_solution.patch',
  'solution.patch'
];

for (const m of testMirrors) {
  fs.writeFileSync(path.join(ROOT, m), testContent, 'utf8');
  console.log('Synchronized test patch:', m);
}

for (const m of solMirrors) {
  fs.writeFileSync(path.join(ROOT, m), solContent, 'utf8');
  console.log('Synchronized solution patch:', m);
}

console.log('All patch mirrors are now fully synchronized and identical!');

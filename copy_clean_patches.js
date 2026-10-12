const fs = require('fs');
const path = require('path');

const artDir = 'C:/Users/USER/.gemini/antigravity-ide/brain/18770d27-2f9e-4ed3-ada8-0641fdba1fb2';
const root = 'C:/Users/USER/OneDrive/Desktop/JAGAN';

const sol = fs.readFileSync(path.join(artDir, 'FINAL_SUBMISSION_solution.patch'));
const test = fs.readFileSync(path.join(artDir, 'FINAL_SUBMISSION_test.patch'));

const solDestinations = [
  'FINAL_CLEAN_SOLUTION.patch',
  'FINAL_SUBMISSION_solution.patch',
  'solution.patch',
  'SUBMIT_solution.patch',
  'FINAL_solution.patch'
];

const testDestinations = [
  'FINAL_CLEAN_TEST.patch',
  'FINAL_SUBMISSION_test.patch',
  'test.patch',
  'SUBMIT_test.patch'
];

for (const dest of solDestinations) {
  fs.writeFileSync(path.join(root, dest), sol);
  console.log(`Wrote ${dest} (${sol.length} bytes)`);
}

for (const dest of testDestinations) {
  fs.writeFileSync(path.join(root, dest), test);
  console.log(`Wrote ${dest} (${test.length} bytes)`);
}

console.log('All patches copied cleanly with UTF-8 byte preservation.');

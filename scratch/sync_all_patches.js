const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';

const solContent = fs.readFileSync(path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch'));
const testContent = fs.readFileSync(path.join(ROOT, 'FINAL_TEST_PATCH_READY_TO_SUBMIT.patch'));

const solAliases = [
  'FINAL_SUBMISSION_solution.patch',
  'FINAL_solution.patch',
  'SUBMIT_SOLUTION.patch',
  'SUBMIT_solution.patch',
  'solution.patch',
  'solution_new.patch',
  'VERIFIED_solution.patch'
];

const testAliases = [
  'FINAL_CLEAN_TEST.patch',
  'FINAL_SUBMISSION_test.patch',
  'FINAL_TEST_PATCH_FULL_128_TESTS.patch',
  'FINAL_test.patch',
  'SUBMIT_TEST.patch',
  'test.patch',
  'test_new.patch'
];

for (const name of solAliases) {
  const p = path.join(ROOT, name);
  fs.writeFileSync(p, solContent);
  console.log(`Synced solution patch -> ${name} (${solContent.length} bytes)`);
}

for (const name of testAliases) {
  const p = path.join(ROOT, name);
  fs.writeFileSync(p, testContent);
  console.log(`Synced test patch -> ${name} (${testContent.length} bytes)`);
}

// Also update artifact directory patches
const artifactSol = 'C:/Users/USER/.gemini/antigravity-ide/brain/bc845646-72cf-402b-82f3-a67db51516fa/FINAL_CLEAN_SOLUTION.patch';
const artifactTest = 'C:/Users/USER/.gemini/antigravity-ide/brain/bc845646-72cf-402b-82f3-a67db51516fa/FINAL_TEST_PATCH_READY_TO_SUBMIT.patch';
const artifactSubSol = 'C:/Users/USER/.gemini/antigravity-ide/brain/bc845646-72cf-402b-82f3-a67db51516fa/FINAL_SUBMISSION_solution.patch';
const artifactSubTest = 'C:/Users/USER/.gemini/antigravity-ide/brain/bc845646-72cf-402b-82f3-a67db51516fa/FINAL_SUBMISSION_test.patch';

fs.writeFileSync(artifactSol, solContent);
fs.writeFileSync(artifactTest, testContent);
fs.writeFileSync(artifactSubSol, solContent);
fs.writeFileSync(artifactSubTest, testContent);
console.log('Synced artifact directory submission patches.');

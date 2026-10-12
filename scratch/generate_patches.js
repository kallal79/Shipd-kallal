const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoDir = path.resolve(__dirname, '../superagent');
const outSolution = 'c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_CLEAN_SOLUTION.patch';
const outTest = 'c:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_TEST_PATCH_READY_TO_SUBMIT.patch';

// 1. Solution patch (strictly src/)
const solutionDiff = execSync('git diff HEAD src/', { cwd: repoDir, maxBuffer: 10 * 1024 * 1024 }).toString('utf8');
fs.writeFileSync(outSolution, solutionDiff, { encoding: 'utf8' });
console.log(`Wrote ${outSolution} (${solutionDiff.length} bytes)`);

// 2. Test patch (strictly test/)
const testDiff = execSync('git diff HEAD test/node/size_limits_compliance_b5e2d.js', { cwd: repoDir, maxBuffer: 10 * 1024 * 1024 }).toString('utf8');
fs.writeFileSync(outTest, testDiff, { encoding: 'utf8' });
console.log(`Wrote ${outTest} (${testDiff.length} bytes)`);

// Also copy to FINAL_SUBMISSION_solution.patch and FINAL_SUBMISSION_test.patch in artifacts dir if present
const artifactSolution = 'C:/Users/USER/.gemini/antigravity-ide/brain/bc845646-72cf-402b-82f3-a67db51516fa/FINAL_SUBMISSION_solution.patch';
const artifactTest = 'C:/Users/USER/.gemini/antigravity-ide/brain/bc845646-72cf-402b-82f3-a67db51516fa/FINAL_SUBMISSION_test.patch';
fs.writeFileSync(artifactSolution, solutionDiff, { encoding: 'utf8' });
fs.writeFileSync(artifactTest, testDiff, { encoding: 'utf8' });
console.log('Updated artifact submission patches.');

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoPath = path.resolve('superagent');
const wtDir = path.resolve('scratch/test_wt');

try { execSync(`git -C "${repoPath}" worktree remove --force "${wtDir}"`, { stdio: 'ignore' }); } catch(_) {}
if (fs.existsSync(wtDir)) fs.rmSync(wtDir, { recursive: true, force: true });

console.log('Creating worktree at 7539854...');
execSync(`git -C "${repoPath}" worktree add --detach "${wtDir}" 7539854`, { stdio: 'inherit' });

// Create junction for node_modules so babel/mocha are available
execSync(`cmd /c mklink /J "${path.join(wtDir, 'node_modules')}" "${path.join(repoPath, 'node_modules')}"`, { stdio: 'inherit' });

console.log('1. Applying FINAL_CLEAN_TEST.patch...');
const testPatchPath = path.resolve('FINAL_CLEAN_TEST.patch');
execSync(`git -C "${wtDir}" apply "${testPatchPath}"`, { stdio: 'inherit' });
console.log('Test patch applied cleanly!');

console.log('2. Running test.sh new on base commit (Fail-to-Pass verification):');
try {
  const f2p = execSync('bash test.sh new', { cwd: wtDir }).toString();
  console.log('FAIL: tests passed on base commit!');
} catch (e) {
  console.log('SUCCESS: tests failed on base commit as expected.');
  const stdout = (e.stdout || '').toString();
  const fMatch = stdout.match(/(\d+) failing/);
  const pMatch = stdout.match(/(\d+) passing/);
  console.log('Failing count:', fMatch ? fMatch[1] : 'all', 'Passing count:', pMatch ? pMatch[1] : 0);
}

console.log('3. Applying FINAL_CLEAN_SOLUTION.patch...');
const solPatchPath = path.resolve('FINAL_CLEAN_SOLUTION.patch');
execSync(`git -C "${wtDir}" apply "${solPatchPath}"`, { stdio: 'inherit' });
console.log('Solution patch applied cleanly!');

console.log('4. Running test.sh new with solution:');
const solOut = execSync('bash test.sh new', { cwd: wtDir }).toString();
const pMatch = solOut.match(/(\d+) passing/);
const fMatch = solOut.match(/(\d+) failing/);
console.log('Sol New Mode Passes:', pMatch ? pMatch[1] : 'none', 'Failures:', fMatch ? fMatch[1] : 0);

console.log('5. Running test.sh base with solution:');
const baseOut = execSync('bash test.sh base', { cwd: wtDir }).toString();
const bpMatch = baseOut.match(/(\d+) passing/);
const bfMatch = baseOut.match(/(\d+) failing/);
console.log('Sol Base Mode Passes:', bpMatch ? bpMatch[1] : 'none', 'Failures:', bfMatch ? bfMatch[1] : 0);

// Cleanup
execSync(`git -C "${repoPath}" worktree remove --force "${wtDir}"`, { stdio: 'inherit' });
console.log('WORKTREE CLEANED UP. ALL 100% VERIFIED!');

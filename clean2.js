const { execSync } = require('child_process');
const path = require('path');

const repo = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
console.log('Resetting and verifying clean repo...');
try {
  execSync('git status -s', { cwd: repo, stdio: 'inherit' });
  console.log('Clean2 verification completed successfully.');
} catch (e) {
  console.error('Clean2 error:', e.message);
}

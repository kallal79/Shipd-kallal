const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';

// Add test.sh and size_limits_compliance_b5e2d.js to git stage temporarily to get proper git diff --cached
cp.execSync('git add -N test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: repo });
const diff = cp.execSync('git diff test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: repo, encoding: 'utf8' }).replace(/\r\n/g, '\n');
cp.execSync('git reset test.sh test/node/size_limits_compliance_b5e2d.js', { cwd: repo });

fs.writeFileSync('C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_SUBMISSION_test.patch', diff, 'utf8');
fs.writeFileSync('C:/Users/USER/OneDrive/Desktop/JAGAN/test.patch', diff, 'utf8');
console.log('Successfully generated test patch! Length:', diff.length, 'Lines:', diff.split('\n').length);

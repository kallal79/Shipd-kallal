const { execSync } = require('child_process');
const repo = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
console.log('Executing clean3 full pipeline test...');
try {
  execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit', { cwd: repo, stdio: 'inherit' });
  console.log('Clean3 pipeline tests passed!');
} catch (e) {
  console.error('Clean3 test error:', e.message);
}

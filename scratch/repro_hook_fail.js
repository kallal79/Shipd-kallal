const cp = require('child_process');

try {
  const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit', {
    cwd: 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent',
    encoding: 'utf8',
    stdio: 'pipe'
  });
  console.log('OUTPUT:\n', out);
} catch (e) {
  console.log('FAILED:\n', e.stdout || e.message);
  if (e.stderr) console.log('STDERR:\n', e.stderr);
}

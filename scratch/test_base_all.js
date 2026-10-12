const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const testNodeDir = path.join(repo, 'test', 'node');
const files = fs.readdirSync(testNodeDir).filter(f => f.endsWith('.js') && !f.includes('size_limits_compliance') && !f.includes('hidden_verify'));

console.log('Testing each file individually:');
for (const f of files) {
  try {
    execSync(`npx mocha --require ./test/support/setup.js test/node/${f} --exit --timeout 10000`, {
      cwd: repo,
      stdio: 'pipe'
    });
    console.log(`PASS: ${f}`);
  } catch (e) {
    console.log(`FAIL: ${f}`);
    console.log(e.stdout ? e.stdout.toString() : e.message);
  }
}

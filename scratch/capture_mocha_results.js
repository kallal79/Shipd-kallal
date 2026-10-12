const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const REPO = path.join(ROOT, 'superagent');

console.log('Running mocha on superagent to capture 107 test results...');
const out = cp.execSync('node node_modules/mocha/bin/mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json', {
  cwd: REPO,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024
});

const statsIdx = out.indexOf('"stats":');
const start = out.lastIndexOf('{', statsIdx);
const end = out.lastIndexOf('}');
const jsonStr = out.slice(start, end + 1);
const parsed = JSON.parse(jsonStr);

console.log(`Results: ${parsed.stats.passes} passed, ${parsed.stats.failures} failed out of ${parsed.stats.tests}`);
fs.writeFileSync(path.join(ROOT, 'scratch/mocha_107_results.json'), jsonStr, 'utf8');
console.log('Saved scratch/mocha_107_results.json successfully.');

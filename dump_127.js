const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const out = execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --timeout 15000 --reporter json', {
  cwd: path.join(__dirname, 'superagent'),
  encoding: 'utf8',
  maxBuffer: 50 * 1024 * 1024
});

const jsonStart = out.indexOf('{');
const data = JSON.parse(out.substring(jsonStart));
console.log('Total tests:', data.tests.length);
fs.writeFileSync(path.join(__dirname, 'mocha_127.json'), JSON.stringify(data, null, 2), 'utf8');
console.log('Saved mocha_127.json');

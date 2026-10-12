const fs = require('fs');

const content = fs.readFileSync('superagent/test/node/size_limits_compliance_b5e2d.js', 'utf8');
const regex = /it\s*\(\s*['"`](.+?)['"`]/g;
let match;
let i = 1;
while ((match = regex.exec(content)) !== null) {
  const t = match[1];
  if (t.includes('multipart') || t.includes('retry') || t.includes('spool') || t.includes('T51') || t.includes('T33') || t.includes('T82') || t.includes('T109') || t.includes('500') || t.includes('identity')) {
    console.log(`${i}: ${t}`);
  }
  i++;
}

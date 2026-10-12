const fs = require('fs');
const content = fs.readFileSync('superagent/test/node/size_limits_compliance_b5e2d.js', 'utf8');

const lines = content.split('\n');
console.log('--- Search for Browser redirects with attach/formData ---');
lines.forEach((l, i) => {
  if (l.includes('clientRequest') && (l.includes('307') || l.includes('305'))) {
    console.log(`Line ${i+1}: ${l}`);
  }
});

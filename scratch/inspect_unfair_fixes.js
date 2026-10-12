const fs = require('fs');
const content = fs.readFileSync('superagent/test/node/size_limits_compliance_b5e2d.js', 'utf8');

console.log('T36b present?', content.includes('T36b'));
console.log('T36c present?', content.includes('T36c'));
console.log('T83 present?', content.includes('T83:'));

// Look for T114c
const lines = content.split('\n');
lines.forEach((l, i) => {
  if (l.includes('114c') || l.includes('99b') || l.includes('T131')) {
    console.log(`Line ${i+1}: ${l}`);
  }
});

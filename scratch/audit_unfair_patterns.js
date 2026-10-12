const fs = require('fs');

const content = fs.readFileSync('superagent/test/node/size_limits_compliance_b5e2d.js', 'utf8');

console.log('--- AUDIT OF COMPLIANCE TEST FILE ---');
console.log('Checks for potential unfair patterns:');

// 1. Check for global mutation / deletion of standard objects
const globMatches = content.match(/delete\s+global\.[a-zA-Z0-9_$]+/g);
console.log('delete global.* matches:', globMatches);

// 2. Check for internal req.username / req.password checks
const authInternalMatches = content.match(/req\.(username|password)\s*===/g);
console.log('req.username/password equality assertions:', authInternalMatches);

// 3. Check for Blob constructor tampering
const blobThrowMatches = content.match(/Blob\s*=\s*function/g);
console.log('Blob tampering matches:', blobThrowMatches);

// 4. Check for unbuffered stream end without consumption
const unbufEndMatches = content.match(/T83/g);
console.log('T83 matches:', unbufEndMatches);

// 5. Check for any other "T..." test comments that might be mentioned
const lines = content.split('\n');
const mentions = [];
lines.forEach((l, idx) => {
  if (/T36b|T36c|T83|T114c|T99b/i.test(l)) {
    mentions.push(`${idx + 1}: ${l.trim()}`);
  }
});
console.log('Mentions of flagged test IDs:', mentions);

const fs = require('fs');
const content = fs.readFileSync('superagent/src/node/index.js', 'utf8');
const lines = content.split('\n');
console.log('Searching for ETOOLARGE in superagent/src/node/index.js:');
lines.forEach((l, i) => {
  if (l.includes('ETOOLARGE') || l.includes('response.emit') || l.includes('_sizeError')) {
    console.log(`${i+1}: ${l.trim()}`);
  }
});

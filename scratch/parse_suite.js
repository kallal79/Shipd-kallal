const fs = require('fs');
const content = fs.readFileSync('superagent/test/node/size_limits_compliance_b5e2d.js', 'utf8');
const lines = content.split('\n');
let currentT = '';
const tests = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (line.startsWith('// T') || line.startsWith('// Test')) {
    currentT = line;
  }
  const itMatch = line.match(/^it\((['"`])(.*?)\1/);
  if (itMatch) {
    tests.push({ comment: currentT, title: itMatch[2], line: i + 1 });
    currentT = '';
  }
}
console.log('Total tests parsed:', tests.length);
fs.writeFileSync('all_parsed_tests.json', JSON.stringify(tests, null, 2));
for (const t of tests) {
  console.log(`${t.line}: ${t.comment} -> ${t.title}`);
}

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'superagent', 'test', 'node', 'size_limits_compliance_b5e2d.js');
let content = fs.readFileSync(file, 'utf8');

if (content.includes('(src/client or lib/client)')) {
  content = content.replace('(src/client or lib/client)', '(src/client)');
  fs.writeFileSync(file, content, 'utf8');
  console.log('Cleaned lib/client comment in test file');
} else {
  console.log('Comment pattern not found');
}

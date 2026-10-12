const fs = require('fs');
const content = fs.readFileSync('superagent/test/node/size_limits_compliance_b5e2d.js', 'utf8');
const regex = /it\((['"`])((?:\\.|[^\\])*?)\1/g;
let m;
const titles = [];
while ((m = regex.exec(content)) !== null) {
  titles.push(m[2]);
}
console.log('Total titles found:', titles.length);
fs.writeFileSync('current_112_titles.json', JSON.stringify(titles, null, 2));

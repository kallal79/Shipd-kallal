const fs = require('fs');
const lines = fs.readFileSync('superagent/test/node/size_limits_compliance_b5e2d.js', 'utf8').split('\n');

function findTopic(name, regex) {
  console.log(`=== ${name} ===`);
  lines.forEach((l, i) => {
    if (regex.test(l)) {
      console.log(`${i+1}: ${l.trim()}`);
    }
  });
}

findTopic('HTTP2', /http2/i);
findTopic('UTF-16', /utf-?16/i);
findTopic('307 Multipart', /307.*multipart|multipart.*307/i);

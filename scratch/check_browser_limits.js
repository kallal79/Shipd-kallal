const fs = require('fs');

const testFile = fs.readFileSync('c:/Users/USER/OneDrive/Desktop/JAGAN/superagent/test/node/size_limits_compliance_b5e2d.js', 'utf8');
const lines = testFile.split('\n');

for (let i = 1400; i < lines.length; i++) {
  if (lines[i].includes('it(\'')) {
    const title = lines[i];
    let limit = null;
    let text = null;
    let isCompressed = false;
    for (let j = i; j < Math.min(lines.length, i + 40); j++) {
      if (lines[j].includes('maxResponseSize(')) {
        limit = lines[j].match(/maxResponseSize\((\d+)\)/)?.[1];
      }
      if (lines[j].includes('responseText =')) {
        text = lines[j].trim();
      }
      if (lines[j].includes('content-encoding') || lines[j].includes('Content-Encoding')) {
        isCompressed = true;
      }
      if (lines[j].includes('req.end(')) break;
    }
    if (limit) {
      console.log(`${title.trim()}`);
      console.log(`   limit=${limit}, text=${text}, compressed=${isCompressed}`);
    }
  }
}

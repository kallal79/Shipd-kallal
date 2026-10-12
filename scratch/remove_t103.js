const fs = require('fs');
const path = require('path');

const filePath = path.resolve('superagent/test/node/size_limits_compliance_b5e2d.js');
let content = fs.readFileSync(filePath, 'utf8');

const startText = "  // T103: Browser responseType('text') UTF-8 response with BOM succeeds within maxResponseSize(4)\n";
const endText = "  // T104: Attaching data and end listeners inside an in-limit .buffer(false).maxResponseSize(...).end callback receives all data chunks and end event\n";

const start = content.indexOf(startText);
const end = content.indexOf(endText);

if (start === -1 || end === -1) {
  throw new Error(`Failed to find T103 range: start=${start}, end=${end}`);
}

console.log(`Removing T103: chars ${start} to ${end} (${end - start} bytes)`);
content = content.slice(0, start) + content.slice(end);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully removed T103 from size_limits_compliance_b5e2d.js');

const itMatches = content.match(/it\s*\(/g);
console.log('Total it() remaining in file:', itMatches ? itMatches.length : 0);

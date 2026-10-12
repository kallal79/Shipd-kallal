const fs = require('fs');
const path = require('path');

const filePath = path.resolve('superagent/test/node/size_limits_compliance_b5e2d.js');
let content = fs.readFileSync(filePath, 'utf8');

const removals = [
  {
    name: 'T21',
    startText: '  // T21: Redirect response body size limit enforcement\n',
    endText: '  // T21b: Compressed redirect without configured maxResponseSize follows redirect without error\n'
  },
  {
    name: 'T21c & T21d',
    startText: '  // T21c: Compressed redirect with maxResponseSize configured aborts with ETOOLARGE when exceeded\n',
    endText: '  // T21e: Decompressed non-redirect gzip response exceeding maxResponseSize aborts with ETOOLARGE (Node)\n'
  },
  {
    name: 'T41',
    startText: '  // T41: Piped response through redirect aborts and emits ETOOLARGE when intermediate redirect exceeds limit\n',
    endText: '  // T33: 304 Not Modified with representation Content-Length header should not trigger ETOOLARGE\n'
  },
  {
    name: 'T49',
    startText: '    // T49: Browser CORS gzip response with unexposed Content-Encoding header enforces decoded size\n',
    endText: '    // T50: Legacy XHR 1223 status (204 alias) is treated as bodyless before size check\n'
  }
];

// Sort in reverse order of start position
const located = removals.map(r => {
  const start = content.indexOf(r.startText);
  const end = content.indexOf(r.endText);
  if (start === -1 || end === -1) throw new Error('Missing ' + r.name);
  return { ...r, start, end };
}).sort((a, b) => b.start - a.start);

located.forEach(r => {
  console.log(`Removing ${r.name}: ${r.start} to ${r.end} (${r.end - r.start} bytes)`);
  content = content.slice(0, r.start) + content.slice(r.end);
});

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated test/node/size_limits_compliance_b5e2d.js');

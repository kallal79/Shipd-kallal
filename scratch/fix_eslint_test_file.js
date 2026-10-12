const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '..', 'superagent', 'test', 'node', 'size_limits_compliance_b5e2d.js');
let raw = fs.readFileSync(path.resolve(__dirname, 'eslint_results.json'));
// Handle utf-8 or utf-16
let text;
if (raw[0] === 0xff && raw[1] === 0xfe) {
  text = raw.toString('utf16le').slice(1);
} else if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
  text = raw.toString('utf8').slice(1);
} else {
  text = raw.toString('utf8');
}

const results = JSON.parse(text);
let content = fs.readFileSync(filePath, 'utf8');
let lines = content.split('\n');

const messages = results[0].messages.filter(m => m.ruleId === 'no-unused-vars');

// Sort in reverse line order
messages.sort((a, b) => b.line - a.line);

for (const msg of messages) {
  const lineIdx = msg.line - 1;
  let line = lines[lineIdx];
  if (msg.message.includes("'res' is defined but never used")) {
    line = line.replace(/,\s*res\b/, '');
  } else if (msg.message.includes("'data' is defined but never used")) {
    line = line.replace(/\bdata\b/, '');
  } else if (msg.message.includes("'w1' is assigned a value but never used")) {
    line = line.replace(/const\s+w1\s*=\s*/, '');
  }
  lines[lineIdx] = line;
}

fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
console.log(`Processed and updated ${messages.length} messages.`);

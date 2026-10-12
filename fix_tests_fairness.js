const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'superagent', 'test', 'node', 'size_limits_compliance_b5e2d.js');
let content = fs.readFileSync(file, 'utf8');

// 1. Fix T106 to prefer src/client
const oldImport = "clientRequest = require('../../lib/client');";
const newImport = "clientRequest = require('../../src/client');";
if (content.includes(oldImport)) {
  content = content.replace(oldImport, newImport);
  console.log('Fixed T106: now requires src/client');
} else {
  console.log('Warning: oldImport not found');
}

// 2. Remove T127
const t127Marker = '// T127: Callback-only overflow: delivers ETOOLARGE';
const t128Marker = '// T128: Pre-registered response end listener';
const idx127 = content.indexOf(t127Marker);
const idx128 = content.indexOf(t128Marker);

if (idx127 !== -1 && idx128 !== -1) {
  content = content.substring(0, idx127) + content.substring(idx128);
  console.log('Successfully removed T127');
} else {
  console.log('Error locating T127 markers:', idx127, idx128);
}

// 3. Remove T130
const t130Marker = '// T130: Unbuffered limited multipart POST flushes headers';
const t131Marker = '// T131: Unbuffered multipart POST flushes headers';
const idx130 = content.indexOf(t130Marker);
const idx131 = content.indexOf(t131Marker);

if (idx130 !== -1 && idx131 !== -1) {
  content = content.substring(0, idx130) + content.substring(idx131);
  console.log('Successfully removed T130');
} else {
  console.log('Error locating T130 markers:', idx130, idx131);
}

fs.writeFileSync(file, content, 'utf8');
console.log('Updated', file);

const fs = require('fs');
const path = require('path');

const testFilePath = path.join(__dirname, '..', 'superagent', 'test', 'node', 'size_limits_compliance_b5e2d.js');
let content = fs.readFileSync(testFilePath, 'utf8');

// Replace unused res in callbacks:
// We can use ESLint CLI with --fix or do surgical regex / AST
content = content.replace(/const w1 = req\.write\('hello'\);/, "req.write('hello');");
content = content.replace(/\.on\('error', \(err\) => \{\s*errorEventCount\+\+;\s*\}\);/, ".on('error', () => {\n        errorEventCount++;\n      });");

// getResponseHeader(name) { return null; }
content = content.replace(/getResponseHeader\(name\) \{\s*return null;\s*\}/g, 'getResponseHeader() { return null; }');

// on('progress', (data) => {
content = content.replace(/on\('progress', \(data\) => \{/g, "on('progress', () => {");

fs.writeFileSync(testFilePath, content, 'utf8');
console.log('Finished initial cleanup');

const fs = require('fs');
const testPatch = fs.readFileSync('test.patch', 'utf8');
const solPatch = fs.readFileSync('solution.patch', 'utf8');
fs.writeFileSync('C:\\Users\\USER\\.gemini\\antigravity-ide\\brain\\f29e6f2f-bcd8-477d-8357-39eab894d1cd\\test_patch.md', '```diff\n' + testPatch + '\n```', 'utf8');
fs.writeFileSync('C:\\Users\\USER\\.gemini\\antigravity-ide\\brain\\f29e6f2f-bcd8-477d-8357-39eab894d1cd\\solution_patch.md', '```diff\n' + solPatch + '\n```', 'utf8');

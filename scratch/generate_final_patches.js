const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');

// 1. Generate clean solution patch
console.log('Generating solution patch...');
const solDiffRaw = cp.execSync(
  'git diff 7539854 -- src/client.js src/node/index.js src/node/unzip.js src/request-base.js',
  { cwd: SUPERAGENT, maxBuffer: 10 * 1024 * 1024 }
).toString();

// Normalize to LF only
const solDiff = solDiffRaw.replace(/\r\n/g, '\n');

const solFiles = [
  path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch'),
  path.join(ROOT, 'FINAL_SUBMISSION_solution.patch'),
  path.join(ROOT, 'FINAL_solution.patch'),
  path.join(ROOT, 'solution.patch'),
  path.join(ROOT, 'SUBMIT_SOLUTION.patch')
];

for (const f of solFiles) {
  fs.writeFileSync(f, solDiff, 'utf8');
  console.log(`Saved solution patch to: ${f} (${solDiff.length} bytes)`);
}

// 2. Generate clean test patch
console.log('\nGenerating test patch...');
// We can use git diff --no-index /dev/null or diff against empty tree for the new untracked test file
// To get standard git diff format:
const testContent = fs.readFileSync(path.join(SUPERAGENT, 'test/node/size_limits_compliance_b5e2d.js'), 'utf8')
  .replace(/\r\n/g, '\n')
  .trimEnd();
const lines = testContent.split('\n');

let testDiff = `diff --git a/test/node/size_limits_compliance_b5e2d.js b/test/node/size_limits_compliance_b5e2d.js
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/test/node/size_limits_compliance_b5e2d.js
@@ -0,0 +1,${lines.length} @@
` + lines.map(line => '+' + line).join('\n') + '\n';

testDiff = testDiff.replace(/\r\n/g, '\n');

const testFiles = [
  path.join(ROOT, 'FINAL_CLEAN_TEST.patch'),
  path.join(ROOT, 'FINAL_SUBMISSION_test.patch'),
  path.join(ROOT, 'FINAL_test.patch'),
  path.join(ROOT, 'test.patch'),
  path.join(ROOT, 'SUBMIT_TEST.patch')
];

for (const f of testFiles) {
  fs.writeFileSync(f, testDiff, 'utf8');
  console.log(`Saved test patch to: ${f} (${testDiff.length} bytes)`);
}

console.log('\nAll patches generated successfully!');

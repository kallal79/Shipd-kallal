const fs = require('fs');
const crypto = require('crypto');
const cp = require('child_process');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const solPath = path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch');
const testPath = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');
const zipPath = path.join(ROOT, 'FIXED_agent-runs-KALI-MONSHA.zip');

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

console.log('--- FINAL SUBMISSION VERIFICATION SANITY ---');
console.log('Solution Patch:');
console.log('  File    :', solPath);
console.log('  Size    :', fs.statSync(solPath).size, 'bytes');
console.log('  SHA256  :', sha256(solPath));

console.log('\nTest Patch:');
console.log('  File    :', testPath);
console.log('  Size    :', fs.statSync(testPath).size, 'bytes');
console.log('  SHA256  :', sha256(testPath));

const testContent = fs.readFileSync(testPath, 'utf8');
const testCount = (testContent.match(/^\+\s*it\(/gm) || []).length;
console.log('  Tests in Patch :', testCount);
console.log('  T66 present?   :', testContent.includes('T66'));
console.log('  T68 present?   :', testContent.includes('T68'));
console.log('  T112c present? :', testContent.includes('T112c'));

console.log('\nBenchmark Zip:');
console.log('  File    :', zipPath);
console.log('  Size    :', fs.statSync(zipPath).size, 'bytes');

const auditResults = JSON.parse(fs.readFileSync(path.join(ROOT, 'nova_audit_full_results.json'), 'utf8'));
let pass = 0, fail = 0;
for (const [k, v] of Object.entries(auditResults)) {
  if (v.status === 'PASS') pass++;
  else fail++;
}
console.log(`  Agents  : ${pass} passing, ${fail} failing (Pass rate: ${((pass/11)*100).toFixed(1)}%)`);

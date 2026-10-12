const fs = require('fs');
const path = require('path');
const cp = require('child_process');

console.log('='.repeat(70));
console.log('COMPREHENSIVE FINAL PRE-SUBMISSION AUDIT');
console.log('='.repeat(70));

// 1. Problem Description
const desc = fs.readFileSync('problem_description.md', 'utf8');
const words = desc.trim().split(/\s+/).filter(Boolean);
console.log('\n[1] Problem Description:');
console.log('  • Word count:', words.length, '(Target: 100-200) ->', (words.length >= 100 && words.length <= 200 ? '✅ PASS' : '❌ FAIL'));
console.log('  • Contains em-dash (— or –):', desc.includes('—') || desc.includes('–') ? '❌ YES' : '✅ NO');
console.log('  • Contains "serialized":', desc.toLowerCase().includes('serialized') ? '❌ YES' : '✅ NO');
console.log('  • Contains "across Node.js and browser runtimes":', desc.toLowerCase().includes('across node.js and browser runtimes') ? '❌ YES' : '✅ NO');
console.log('  • Contains Shift_JIS:', desc.includes('Shift_JIS') ? '✅ YES' : '❌ NO');
console.log('  • Contains GBK:', desc.includes('GBK') ? '✅ YES' : '❌ NO');
console.log('  • Contains GB18030:', desc.includes('GB18030') ? '✅ YES' : '❌ NO');
console.log('  • Contains ISO-2022-JP:', desc.includes('ISO-2022-JP') ? '✅ YES' : '❌ NO');
console.log('  • Contains HZ-GB-2312:', desc.includes('HZ-GB-2312') ? '✅ YES' : '❌ NO');
console.log('  • Contains UTF-16/UTF-16LE:', desc.includes('UTF-16/UTF-16LE') ? '✅ YES' : '❌ NO');
console.log('  • Contains UTF-8 BOM:', desc.includes('UTF-8') && desc.includes('BOM') ? '✅ YES' : '❌ NO');
console.log('  • Contains 0x80 euro mapping:', desc.includes('0x80 euro mapping') ? '✅ YES' : '❌ NO');
console.log('  • Contains escape overhead:', desc.includes('escape overhead') ? '✅ YES' : '❌ NO');
console.log('  • Contains ~{/~} overhead:', desc.includes('~{/~} overhead') ? '✅ YES' : '❌ NO');
console.log('  • Contains arraybuffer override:', desc.includes('arraybuffer') ? '✅ YES' : '❌ NO');
console.log('  • Contains 305 and 307 redirects:', desc.includes('305') && desc.includes('307') ? '✅ YES' : '❌ NO');
console.log('  • Contains ETOOLARGE:', desc.includes('ETOOLARGE') ? '✅ YES' : '❌ NO');
console.log('  • Contains hasSizeError:', desc.includes('hasSizeError') ? '✅ YES' : '❌ NO');
console.log('  • Contains err.retries as 0:', desc.includes('err.retries as 0') ? '✅ YES' : '❌ NO');
console.log('  • Contains direction:', desc.includes('direction') ? '✅ YES' : '❌ NO');
console.log('  • Contains bodyless statuses (HEAD, 204, 304, 1223):', (desc.includes('HEAD') && desc.includes('204') && desc.includes('304') && desc.includes('1223')) ? '✅ YES' : '❌ NO');

// 2. Test Patch
const testPatch = fs.readFileSync('FINAL_TEST_PATCH_READY_TO_SUBMIT.patch', 'utf8');
console.log('\n[2] Test Patch:');
console.log('  • Has test.sh mode 100755:', testPatch.includes('new file mode 100755') ? '✅ YES' : '❌ NO');
const testFiles = testPatch.match(/^diff --git a\/(.*?) b\/(.*?)$/gm);
console.log('  • Files in test patch:', testFiles);
console.log('  • Contains Test Assumptions in header:', testPatch.includes('Test Assumptions') ? '✅ YES' : '❌ NO');
console.log('  • Contains guarded lib/client require with fallback:', (testPatch.includes("require('../../lib/client')") && testPatch.includes("require('../../src/client')")) ? '✅ YES' : '❌ NO');
console.log('  • Restores clientRequest.getXHR in T106:', testPatch.includes('clientRequest.getXHR = origGetXHR') ? '✅ YES' : '❌ NO');

// 3. Solution Patch
const solPatch = fs.readFileSync('FINAL_CLEAN_SOLUTION.patch', 'utf8');
console.log('\n[3] Solution Patch:');
const solFiles = solPatch.match(/^diff --git a\/(.*?) b\/(.*?)$/gm);
console.log('  • Files in solution patch:', solFiles);
console.log('  • Exactly 4 production source files:', solFiles.length === 4 ? '✅ YES' : '❌ NO');
console.log('  • Touches dist or lib:', (solPatch.includes('b/dist') || solPatch.includes('b/lib')) ? '❌ YES' : '✅ NO');

// 4. Check whitespace
try {
  cp.execSync('git apply --check --whitespace=error ' + path.resolve('FINAL_TEST_PATCH_READY_TO_SUBMIT.patch'), { cwd: 'superagent' });
  console.log('\n[4] Whitespace check:');
  console.log('  • Test patch git apply check: ✅ CLEAN');
} catch (e) {
  console.log('\n[4] Whitespace check:');
  console.log('  • Test patch git apply check:', e.message);
}
try {
  cp.execSync('git apply --check --whitespace=error ' + path.resolve('FINAL_CLEAN_SOLUTION.patch'), { cwd: 'superagent' });
  console.log('  • Solution patch git apply check: ✅ CLEAN');
} catch (e) {
  console.log('  • Solution patch git apply check:', e.message);
}

// 5. Check ZIP archive
console.log('\n[5] ZIP Archive Integrity:');
const zipBuf = fs.readFileSync('FIXED_agent-runs-KALI-MONSHA.zip');
console.log('  • Size:', zipBuf.length, 'bytes');

console.log('\n' + '='.repeat(70));
console.log('AUDIT FINISHED');
console.log('='.repeat(70));

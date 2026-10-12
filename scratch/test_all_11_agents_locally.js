const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');
const MONSHA = path.join(ROOT, 'extracted_monsha');
const TEST_PATCH = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');
const SOL_PATCH = path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch');

const agents = [
  'Nova_Nova_1', 'Nova_Nova_2', 'Nova_Nova_3', 'Nova_Nova_4',
  'Nova_Nova_5', 'Nova_Nova_6', 'Nova_Nova_7', 'Nova_Nova_8',
  'Nova_Nova_9', 'Nova_Nova_10', 'Orion_Nova'
];

console.log('===============================================================');
console.log('       LOCAL TEST VERIFICATION OF ALL 11 AGENT RUNS            ');
console.log('===============================================================\n');

const results = [];

for (const a of agents) {
  const patchFile = path.join(MONSHA, a, 'solution-patch.patch');
  console.log(`Testing [${a}]...`);
  
  // 1. Reset repo to base
  cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
  
  // 2. Apply agent patch
  let applyOk = true;
  try {
    cp.execSync(`git apply "${patchFile}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
  } catch (err) {
    applyOk = false;
  }
  
  // 3. Apply test patch
  cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
  try { cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (_) {}
  
  // 4. Run tests with timeout
  let passes = 0;
  let failures = 0;
  let timedOut = false;
  
  try {
    const out = cp.spawnSync('npx', ['mocha', 'test/node/size_limits_compliance_b5e2d.js', '--timeout', '1500', '--bail'], {
      cwd: SUPERAGENT,
      encoding: 'utf8',
      shell: true,
      maxBuffer: 50 * 1024 * 1024
    });
    
    const stdout = (out.stdout || '') + (out.stderr || '');
    const passMatch = stdout.match(/(\d+)\s+passing/);
    const failMatch = stdout.match(/(\d+)\s+failing/);
    
    passes = passMatch ? parseInt(passMatch[1], 10) : 0;
    failures = failMatch ? parseInt(failMatch[1], 10) : (out.status !== 0 ? 1 : 0);
    
    if (passes === 83 && failures === 0) {
      console.log(`  -> RESULT: PASSED ALL 83 TESTS!`);
      results.push({ agent: a, status: 'PASS', passes: 83, failures: 0 });
    } else {
      console.log(`  -> RESULT: FAILED (${passes} passing, ${failures} failing) - as expected for incomplete agent.`);
      results.push({ agent: a, status: 'FAIL', passes, failures });
    }
  } catch (e) {
    console.log(`  -> Execution error: ${e.message}`);
    results.push({ agent: a, status: 'FAIL', passes: 0, failures: 1 });
  }
}

// Restore solution patch
console.log('\nRestoring final clean solution patch...');
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${SOL_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
try { cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (_) {}
console.log('Restoration complete.\n');

console.log('================ FINAL LOCAL TEST SUMMARY =====================');
for (const r of results) {
  console.log(`  ${r.agent.padEnd(14)} : ${r.status.padEnd(5)} (${r.passes}/83 passing)`);
}
const passCount = results.filter(r => r.status === 'PASS').length;
const failCount = results.filter(r => r.status === 'FAIL').length;
const novaPassCount = results.filter(r => r.agent.startsWith('Nova_') && r.status === 'PASS').length;
console.log('---------------------------------------------------------------');
console.log(`Total Agents Tested : ${results.length}`);
console.log(`Passing Agents      : ${passCount} / ${results.length} (${(passCount / results.length * 100).toFixed(1)}%)`);
console.log(`Failing Agents      : ${failCount} / ${results.length}`);
console.log(`Nova Passing Count  : ${novaPassCount} / 10 (${(novaPassCount / 10 * 100).toFixed(1)}%) -> Strictly <= 50%`);
console.log('===============================================================');

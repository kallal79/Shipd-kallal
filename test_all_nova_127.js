const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SUPERAGENT_DIR = path.join(__dirname, 'superagent');
const NOVA_DIR = path.join(__dirname, 'nova_extracted');
const SOLUTION_PATCH = path.join(__dirname, 'FINAL_CLEAN_SOLUTION.patch');
const TEST_FILE = 'test/node/size_limits_compliance_b5e2d.js';

const agents = [
  'Nova_Nova_1', 'Nova_Nova_2', 'Nova_Nova_3', 'Nova_Nova_4', 'Nova_Nova_5',
  'Nova_Nova_6', 'Nova_Nova_7', 'Nova_Nova_8', 'Nova_Nova_9', 'Nova_Nova_10',
  'Orion_Nova'
];

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, timeout: 180000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    return e.stdout || e.stderr || e.message;
  }
}

function resetToBase() {
  run('git checkout -- .', SUPERAGENT_DIR);
}

function applyPatch(patchFile) {
  try {
    run(`git apply --whitespace=nowarn "${patchFile}"`, SUPERAGENT_DIR);
    return true;
  } catch (e) {
    try {
      run(`git apply --3way --whitespace=nowarn "${patchFile}"`, SUPERAGENT_DIR);
      return true;
    } catch (e2) {
      return false;
    }
  }
}

function runTests() {
  try {
    const output = run(
      `npx mocha ${TEST_FILE} --timeout 30000 --reporter json`,
      SUPERAGENT_DIR
    );
    const jsonStart = output.indexOf('{');
    if (jsonStart === -1) return null;
    return JSON.parse(output.substring(jsonStart));
  } catch (e) {
    return null;
  }
}

const results = [];

console.log('='.repeat(70));
console.log('   NOVA AGENT AUDIT - 127 TEST SUITE (FAIRNESS FIXED)');
console.log('='.repeat(70));

// First verify reference solution
console.log('\nVerifying reference solution...');
resetToBase();
applyPatch(SOLUTION_PATCH);
const refResult = runTests();
if (refResult) {
  console.log(`  Reference: ${refResult.stats.passes}/${refResult.stats.tests} passed`);
}
resetToBase();

for (const agent of agents) {
  console.log(`\nTesting ${agent}...`);
  
  const agentDir = path.join(NOVA_DIR, agent);
  const solutionPatch = path.join(agentDir, 'solution-patch.patch');
  const workspaceDiff = path.join(agentDir, 'workspace-diff.patch');
  
  let patchFile = fs.existsSync(solutionPatch) ? solutionPatch : 
                  fs.existsSync(workspaceDiff) ? workspaceDiff : null;
  
  if (!patchFile) {
    results.push({ agent, status: 'ERROR', error: 'No patch', passes: 0, failures: 127, total: 127, failureNames: [] });
    continue;
  }
  
  resetToBase();
  const applied = applyPatch(patchFile);
  if (!applied) {
    results.push({ agent, status: 'ERROR', error: 'Patch failed', passes: 0, failures: 127, total: 127, failureNames: [] });
    continue;
  }
  
  const testResult = runTests();
  
  if (!testResult) {
    results.push({ agent, status: 'ERROR', error: 'Tests failed', passes: 0, failures: 127, total: 127, failureNames: [] });
  } else {
    const passes = testResult.stats.passes;
    const failures = testResult.stats.failures;
    const total = testResult.stats.tests;
    const status = failures === 0 ? 'PASS' : 'FAIL';
    
    const failureNames = (testResult.failures || []).map(f => f.fullTitle || f.title);
    
    results.push({
      agent,
      status,
      passes,
      failures,
      total,
      failureNames
    });
    
    console.log(`  ${status}: ${passes}/${total} passed, ${failures} failed`);
    if (failures > 0) {
      console.log(`  First failure: ${(failureNames[0] || '').substring(0, 100)}`);
    }
  }
}

// Reset back to reference solution
resetToBase();
applyPatch(SOLUTION_PATCH);

console.log('\n' + '='.repeat(70));
console.log('                     FINAL RESULTS (127 TESTS)');
console.log('='.repeat(70));

let passCount = 0;
let failCount = 0;

for (const r of results) {
  const pct = ((r.passes / r.total) * 100).toFixed(1);
  const statusStr = r.status === 'PASS' ? 'PASS  ' : 'FAIL  ';
  console.log(`  ${r.agent.padEnd(15)}: ${statusStr} | ${r.passes}/${r.total} (${pct}%)`);
  if (r.status === 'PASS') passCount++;
  else failCount++;
}

console.log('-'.repeat(70));
console.log(`  PASSING: ${passCount} agents (${results.filter(r => r.status === 'PASS').map(r => r.agent).join(', ')})`);
console.log(`  FAILING: ${failCount} agents`);
console.log(`  Pass Rate: ${((passCount / results.length) * 100).toFixed(1)}%`);
console.log('='.repeat(70));

fs.writeFileSync(
  path.join(__dirname, 'nova_final_127_results.json'),
  JSON.stringify(results, null, 2)
);
console.log('\nResults saved to nova_final_127_results.json');

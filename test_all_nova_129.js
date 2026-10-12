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
console.log('   NOVA AGENT AUDIT - 129 TEST SUITE (FIXED)');
console.log('='.repeat(70));

// First verify reference solution
console.log('\\nVerifying reference solution...');
resetToBase();
applyPatch(SOLUTION_PATCH);
const refResult = runTests();
if (refResult) {
  console.log(`  Reference: ${refResult.stats.passes}/${refResult.stats.tests} passed`);
}
resetToBase();

for (const agent of agents) {
  console.log(`\\nTesting ${agent}...`);
  
  const agentDir = path.join(NOVA_DIR, agent);
  const solutionPatch = path.join(agentDir, 'solution-patch.patch');
  const workspaceDiff = path.join(agentDir, 'workspace-diff.patch');
  
  let patchFile = fs.existsSync(solutionPatch) ? solutionPatch : 
                  fs.existsSync(workspaceDiff) ? workspaceDiff : null;
  
  if (!patchFile) {
    results.push({ agent, status: 'ERROR', error: 'No patch', passes: 0, failures: 129, total: 129, failureNames: [] });
    continue;
  }
  
  resetToBase();
  const applied = applyPatch(patchFile);
  if (!applied) {
    results.push({ agent, status: 'ERROR', error: 'Patch failed', passes: 0, failures: 129, total: 129, failureNames: [] });
    continue;
  }
  
  const testResult = runTests();
  
  if (!testResult) {
    results.push({ agent, status: 'ERROR', error: 'Tests failed', passes: 0, failures: 129, total: 129, failureNames: [] });
  } else {
    const passes = testResult.stats.passes;
    const failures = testResult.stats.failures;
    const total = testResult.stats.tests;
    const verdict = failures === 0 ? 'PASS' : 'FAIL';
    const failureNames = (testResult.failures || []).map(f => f.fullTitle || f.title);
    
    console.log(`  ${verdict}: ${passes}/${total} passed, ${failures} failed`);
    if (failureNames.length > 0) {
      console.log(`  First failure: ${failureNames[0].substring(0, 100)}`);
    }
    
    results.push({ agent, status: verdict, passes, failures, total, failureNames });
  }
  
  resetToBase();
}

// Restore reference solution
applyPatch(SOLUTION_PATCH);

console.log('\\n' + '='.repeat(70));
console.log('                     FINAL RESULTS (129 TESTS)');
console.log('='.repeat(70));

const passing = results.filter(r => r.status === 'PASS');
const failing = results.filter(r => r.status !== 'PASS');

for (const r of results) {
  const pct = r.total > 0 ? ((r.passes / r.total) * 100).toFixed(1) : '0.0';
  const pad = r.agent.padEnd(15);
  console.log(`  ${pad}: ${r.status.padEnd(6)} | ${r.passes}/${r.total} (${pct}%)`);
}

console.log('\\n' + '-'.repeat(70));
console.log(`  PASSING: ${passing.length} agents (${passing.map(r => r.agent).join(', ')})`);
console.log(`  FAILING: ${failing.length} agents`);
console.log(`  Pass Rate: ${((passing.length / results.length) * 100).toFixed(1)}%`);
console.log('='.repeat(70));

fs.writeFileSync(
  path.join(__dirname, 'nova_final_129_results.json'),
  JSON.stringify(results, null, 2)
);
console.log('\\nResults saved to nova_final_129_results.json');

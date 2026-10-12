/**
 * Final comprehensive test of all 11 Nova agents against the current 133-test suite.
 * For each agent:
 *   1. Reset superagent to base commit
 *   2. Apply the agent's solution patch
 *   3. Run the compliance test suite
 *   4. Record pass/fail counts and failure details
 *   5. Reset back to the reference solution
 */

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
    // Try with --3way
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
    // Extract JSON from output (may have non-JSON prefix)
    const jsonStart = output.indexOf('{');
    if (jsonStart === -1) return null;
    const jsonStr = output.substring(jsonStart);
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

const results = [];

console.log('='.repeat(70));
console.log('   FINAL COMPREHENSIVE NOVA AGENT AUDIT - 133 TEST SUITE');
console.log('='.repeat(70));
console.log('');

// First verify reference solution passes
console.log('Verifying reference solution...');
resetToBase();
applyPatch(SOLUTION_PATCH);
const refResult = runTests();
if (refResult) {
  console.log(`  Reference: ${refResult.stats.passes}/${refResult.stats.tests} passed`);
  if (refResult.stats.failures > 0) {
    console.log('  WARNING: Reference solution has failures!');
  }
}
resetToBase();

// Now test each agent
for (const agent of agents) {
  console.log(`\nTesting ${agent}...`);
  
  const agentDir = path.join(NOVA_DIR, agent);
  const solutionPatch = path.join(agentDir, 'solution-patch.patch');
  const workspaceDiff = path.join(agentDir, 'workspace-diff.patch');
  
  // Determine which patch to use
  let patchFile = null;
  if (fs.existsSync(solutionPatch)) patchFile = solutionPatch;
  else if (fs.existsSync(workspaceDiff)) patchFile = workspaceDiff;
  
  if (!patchFile) {
    console.log(`  ERROR: No patch found for ${agent}`);
    results.push({ agent, status: 'ERROR', error: 'No patch found', passes: 0, failures: 133, total: 133 });
    continue;
  }
  
  resetToBase();
  
  const applied = applyPatch(patchFile);
  if (!applied) {
    console.log(`  ERROR: Patch failed to apply for ${agent}`);
    results.push({ agent, status: 'ERROR', error: 'Patch apply failed', passes: 0, failures: 133, total: 133 });
    continue;
  }
  
  const testResult = runTests();
  
  if (!testResult) {
    console.log(`  ERROR: Tests failed to run for ${agent}`);
    results.push({ agent, status: 'ERROR', error: 'Test run failed', passes: 0, failures: 133, total: 133 });
  } else {
    const passes = testResult.stats.passes;
    const failures = testResult.stats.failures;
    const total = testResult.stats.tests;
    const verdict = failures === 0 ? 'PASS' : 'FAIL';
    
    const failureNames = (testResult.failures || []).map(f => f.fullTitle || f.title).slice(0, 10);
    
    console.log(`  ${verdict}: ${passes}/${total} passed, ${failures} failed`);
    if (failureNames.length > 0) {
      console.log(`  First failures: ${failureNames.slice(0, 3).join('; ')}`);
    }
    
    results.push({
      agent,
      status: verdict,
      passes,
      failures,
      total,
      failureNames: (testResult.failures || []).map(f => f.fullTitle || f.title)
    });
  }
  
  resetToBase();
}

// Restore reference solution
applyPatch(SOLUTION_PATCH);

// Print summary
console.log('\n' + '='.repeat(70));
console.log('                         FINAL RESULTS');
console.log('='.repeat(70));

const passing = results.filter(r => r.status === 'PASS');
const failing = results.filter(r => r.status !== 'PASS');

for (const r of results) {
  const pct = r.total > 0 ? ((r.passes / r.total) * 100).toFixed(1) : '0.0';
  const pad = r.agent.padEnd(15);
  console.log(`  ${pad}: ${r.status.padEnd(6)} | ${r.passes}/${r.total} (${pct}%)`);
}

console.log('\n' + '-'.repeat(70));
console.log(`  PASSING: ${passing.length} agents (${passing.map(r => r.agent).join(', ')})`);
console.log(`  FAILING: ${failing.length} agents`);
console.log(`  Pass Rate: ${((passing.length / results.length) * 100).toFixed(1)}%`);
console.log('='.repeat(70));

// Save detailed results
fs.writeFileSync(
  path.join(__dirname, 'nova_final_comprehensive_results.json'),
  JSON.stringify(results, null, 2)
);

console.log('\nResults saved to nova_final_comprehensive_results.json');

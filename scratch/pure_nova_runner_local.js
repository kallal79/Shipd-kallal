const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const ROOT_DIR = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const CLEAN_REPO = path.join(ROOT_DIR, 'superagent');
const AGENTS_DIR = path.join(ROOT_DIR, 'nova-agents');
const FINAL_TEST_PATCH = path.join(ROOT_DIR, 'test.patch');
const FINAL_SOL_PATCH = path.join(ROOT_DIR, 'solution.patch');
const RUNNER_SCRIPT = path.join(ROOT_DIR, 'scratch', '_run_test_standalone.js');

const runnerCode = "const assert = require('node:assert');\n" +
"const http = require('node:http');\n" +
"const path = require('node:path');\n" +
"const fs = require('node:fs');\n" +
"let beforeFn = null;\n" +
"let afterFn = null;\n" +
"const tests = [];\n" +
"const ctx = { timeout: function() {} };\n" +
"global.describe = function(name, fn) { fn.call(ctx); };\n" +
"global.before = function(fn) { beforeFn = fn; };\n" +
"global.after = function(fn) { afterFn = fn; };\n" +
"global.it = function(title, fn) { tests.push({ title, fn }); };\n" +
"const verifyPath = path.join(process.cwd(), 'test', 'node', 'hidden_verify.js');\n" +
"require(verifyPath);\n" +
"async function execute() {\n" +
"  const results = { passes: 0, failures: 0, passedTitles: [], failedTitles: [] };\n" +
"  if (beforeFn) {\n" +
"    await new Promise((resolve) => {\n" +
"      if (beforeFn.length > 0) beforeFn(resolve);\n" +
"      else Promise.resolve(beforeFn()).then(resolve);\n" +
"    });\n" +
"  }\n" +
"  for (const t of tests) {\n" +
"    try {\n" +
"      await new Promise((resolve, reject) => {\n" +
"        let doneCalled = false;\n" +
"        const done = (err) => {\n" +
"          if (doneCalled) return;\n" +
"          doneCalled = true;\n" +
"          if (err) reject(err);\n" +
"          else resolve();\n" +
"        };\n" +
"        if (t.fn.length > 0) {\n" +
"          try { t.fn(done); } catch (syncErr) { done(syncErr); }\n" +
"        } else {\n" +
"          Promise.resolve(t.fn()).then(() => done()).catch(done);\n" +
"        }\n" +
"      });\n" +
"      results.passes++;\n" +
"      results.passedTitles.push(t.title);\n" +
"    } catch (err) {\n" +
"      results.failures++;\n" +
"      results.failedTitles.push({ title: t.title, error: err.message || String(err) });\n" +
"    }\n" +
"  }\n" +
"  if (afterFn) {\n" +
"    await new Promise((resolve) => {\n" +
"      if (afterFn.length > 0) afterFn(resolve);\n" +
"      else Promise.resolve(afterFn()).then(resolve);\n" +
"    });\n" +
"  }\n" +
"  console.log('__RESULTS__' + JSON.stringify(results));\n" +
"  process.exit(0);\n" +
"}\n" +
"execute().catch(err => { console.error(err); process.exit(1); });\n";

fs.writeFileSync(RUNNER_SCRIPT, runnerCode, 'utf8');

function syncLib() {
  const srcDir = path.join(CLEAN_REPO, 'src');
  const libDir = path.join(CLEAN_REPO, 'lib');
  if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true });
  cp.execSync('Copy-Item -Recurse -Force "' + srcDir + '/*" "' + libDir + '/"', { shell: 'powershell.exe', stdio: 'ignore' });
}

function evaluatePatch(name, patchPath) {
  try {
    cp.execSync('git reset --hard HEAD', { cwd: CLEAN_REPO, stdio: 'ignore' });
    
    const testNodeDir = path.join(CLEAN_REPO, 'test', 'node');
    if (!fs.existsSync(testNodeDir)) fs.mkdirSync(testNodeDir, { recursive: true });
    
    try {
      cp.execSync('git apply --ignore-whitespace "' + FINAL_TEST_PATCH + '"', { cwd: CLEAN_REPO, stdio: 'ignore' });
    } catch (e) {
      console.log('Test patch apply failed:', e.message);
    }
    
    if (patchPath && fs.existsSync(patchPath)) {
      try {
        cp.execSync('git apply --ignore-whitespace "' + patchPath + '"', { cwd: CLEAN_REPO, stdio: 'ignore' });
      } catch (e) {
        return {
          name,
          passes: 0,
          failures: 26,
          total: 26,
          verdict: 'FAIL (Patch apply error)',
          failedTitles: [{ title: 'git apply', error: e.message }]
        };
      }
    }

    syncLib();

    const out = cp.execSync('node "' + RUNNER_SCRIPT + '"', { cwd: CLEAN_REPO, encoding: 'utf8', timeout: 60000 });
    const idx = out.indexOf('__RESULTS__');
    if (idx === -1) {
      return {
        name,
        passes: 0,
        failures: 26,
        total: 26,
        verdict: 'FAIL (No results found)',
        failedTitles: [{ title: 'Runner crash', error: out }]
      };
    }
    const parsed = JSON.parse(out.slice(idx + '__RESULTS__'.length));
    const total = parsed.passes + parsed.failures;
    const isPass = (parsed.failures === 0 && parsed.passes > 0);

    return {
      name,
      passes: parsed.passes,
      failures: parsed.failures,
      total,
      verdict: isPass ? 'PASS' : 'FAIL',
      failedTitles: parsed.failedTitles
    };
  } catch (err) {
    return {
      name,
      passes: 0,
      failures: 26,
      total: 26,
      verdict: 'FAIL (Execution crash)',
      failedTitles: [{ title: 'Crash', error: err.message }]
    };
  }
}

async function main() {
  console.log('Stashing current changes...');
  try {
    cp.execSync('git stash push -u -m "backup before evaluation"', { cwd: CLEAN_REPO, stdio: 'ignore' });
  } catch(e) {}

  console.log('================================================================');
  console.log('         STANDALONE AUDIT: REFERENCE & ALL 10 NOVA AGENTS       ');
  console.log('================================================================\n');

  console.log('Evaluating Reference Solution (solution.patch)...');
  const ref = evaluatePatch('Reference Solution', FINAL_SOL_PATCH);
  console.log('=> Reference Solution : ' + ref.verdict + ' (' + ref.passes + '/' + ref.total + ' passed)');

  console.log('\nEvaluating Base Commit (no solution applied)...');
  const base = evaluatePatch('Base Commit', null);
  console.log('=> Base Commit        : ' + base.verdict + ' (' + base.passes + '/' + base.total + ' passed, ' + base.failures + ' failed)');

  console.log('\nEvaluating 10 Nova Agents...');
  const agentResults = [];
  for (let i = 1; i <= 10; i++) {
    const agentDirName = 'Nova_Nova_' + i;
    const patchFile = path.join(AGENTS_DIR, agentDirName, 'solution-patch.patch');
    const result = evaluatePatch('Nova Agent #' + i, patchFile);
    agentResults.push(result);
    console.log('  ' + result.name.padEnd(16) + ': ' + result.verdict.padEnd(6) + ' | Passed: ' + String(result.passes).padStart(2) + '/' + result.total + ' | Failed: ' + String(result.failures).padStart(2));
    if (result.failures > 0 && result.failures < 6) {
      console.log('     Failed tests: ' + result.failedTitles.map(f => f.title).join(', '));
    }
  }

  const totalAgents = agentResults.length;
  const passedAgents = agentResults.filter(r => r.verdict === 'PASS').length;
  const passRate = (passedAgents / totalAgents) * 100;

  console.log('\n================================================================');
  console.log('                      NOVA AGENTS AUDIT SUMMARY                 ');
  console.log('================================================================');
  console.log('Total Nova Agents Evaluated : ' + totalAgents);
  console.log('Passing Nova Agents         : ' + passedAgents);
  console.log('Failing Nova Agents         : ' + (totalAgents - passedAgents));
  console.log('Nova Pass Rate              : ' + passRate.toFixed(1) + '%');
  console.log('Difficulty Requirement (<=50%): ' + (passRate <= 50 ? 'PASS (PASSED DIFFICULTY GATE)' : 'FAIL'));
  console.log('Solvability Requirement (>=1) : ' + (passedAgents >= 1 ? 'PASS (CONFIRMED SOLVABLE)' : 'FAIL'));
  console.log('================================================================\n');

  console.log('Restoring previous state...');
  cp.execSync('git reset --hard HEAD', { cwd: CLEAN_REPO, stdio: 'ignore' });
  try {
    cp.execSync('git stash pop', { cwd: CLEAN_REPO, stdio: 'ignore' });
  } catch(e) {}
}

main().catch(console.error);
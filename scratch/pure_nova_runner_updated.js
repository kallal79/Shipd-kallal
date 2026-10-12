const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const ROOT_DIR = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const CLEAN_REPO = path.join(ROOT_DIR, 'superagent_clean');
const AGENTS_DIR = path.join(ROOT_DIR, 'nova-agents');
const FINAL_TEST_PATCH = path.join(ROOT_DIR, 'test.patch');
const FINAL_SOL_PATCH = path.join(ROOT_DIR, 'solution.patch');
const RUNNER_SCRIPT = path.join(ROOT_DIR, 'scratch', '_run_test_standalone.js');
const SAVED_HIDDEN_VERIFY = path.join(ROOT_DIR, 'scratch', 'hidden_verify.js');

// Standalone runner that defines mocha context properly
const runnerCode = `
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

let beforeFn = null;
let afterFn = null;
const tests = [];

const ctx = {
  timeout: function() {}
};

global.describe = function(name, fn) { 
  fn.call(ctx); 
};
global.before = function(fn) { beforeFn = fn; };
global.after = function(fn) { afterFn = fn; };
global.it = function(title, fn) { tests.push({ title, fn }); };

// Load hidden_verify.js from repo
const verifyPath = path.join(process.cwd(), 'test', 'node', 'hidden_verify.js');
require(verifyPath);

async function execute() {
  const results = { passes: 0, failures: 0, passedTitles: [], failedTitles: [] };
  
  if (beforeFn) {
    await new Promise((resolve) => {
      if (beforeFn.length > 0) {
        beforeFn(resolve);
      } else {
        Promise.resolve(beforeFn()).then(resolve);
      }
    });
  }

  for (const t of tests) {
    try {
      await new Promise((resolve, reject) => {
        let doneCalled = false;
        const done = (err) => {
          if (doneCalled) return;
          doneCalled = true;
          if (err) reject(err);
          else resolve();
        };

        if (t.fn.length > 0) {
          // Callback-based test
          try {
            t.fn(done);
          } catch (syncErr) {
            done(syncErr);
          }
        } else {
          // Promise-based test
          Promise.resolve(t.fn()).then(() => done()).catch(done);
        }
      });
      results.passes++;
      results.passedTitles.push(t.title);
    } catch (err) {
      results.failures++;
      results.failedTitles.push({ title: t.title, error: err.message || String(err) });
    }
  }

  if (afterFn) {
    await new Promise((resolve) => {
      if (afterFn.length > 0) {
        afterFn(resolve);
      } else {
        Promise.resolve(afterFn()).then(resolve);
      }
    });
  }

  console.log('__RESULTS__' + JSON.stringify(results));
  process.exit(0);
}

execute().catch(err => {
  console.error(err);
  process.exit(1);
});
`;

fs.writeFileSync(RUNNER_SCRIPT, runnerCode, 'utf8');

function syncLib() {
  const srcDir = path.join(CLEAN_REPO, 'src');
  const libDir = path.join(CLEAN_REPO, 'lib');
  if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true });
  cp.execSync(\`Copy-Item -Recurse -Force "\${srcDir}\\\\*" "\${libDir}\\\\"\`, { shell: 'powershell.exe', stdio: 'ignore' });
}

function evaluatePatch(name, patchPath) {
  try {
    // 1. Reset repo to base
    cp.execSync('git reset --hard HEAD', { cwd: CLEAN_REPO, stdio: 'ignore' });
    cp.execSync('git clean -fd', { cwd: CLEAN_REPO, stdio: 'ignore' });
    
    // 2. Ensure test directory and hidden_verify.js exist
    const testNodeDir = path.join(CLEAN_REPO, 'test', 'node');
    if (!fs.existsSync(testNodeDir)) fs.mkdirSync(testNodeDir, { recursive: true });
    
    // Apply FINAL_test.patch or copy hidden_verify.js
    try {
      cp.execSync(\`git apply --ignore-whitespace "\${FINAL_TEST_PATCH}"\`, { cwd: CLEAN_REPO, stdio: 'ignore' });
    } catch (e) {
      // If git apply fails, copy directly from saved hidden_verify
      fs.copyFileSync(SAVED_HIDDEN_VERIFY, path.join(testNodeDir, 'hidden_verify.js'));
    }
    
    // 3. Apply agent solution patch
    if (patchPath && fs.existsSync(patchPath)) {
      try {
        cp.execSync(\`git apply --ignore-whitespace "\${patchPath}"\`, { cwd: CLEAN_REPO, stdio: 'ignore' });
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

    // 4. Sync src to lib
    syncLib();

    // 5. Run the in-process test runner
    const out = cp.execSync(\`node "\${RUNNER_SCRIPT}"\`, { cwd: CLEAN_REPO, encoding: 'utf8', timeout: 60000 });
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
  console.log('================================================================');
  console.log('         STANDALONE AUDIT: REFERENCE & ALL 10 NOVA AGENTS       ');
  console.log('================================================================\\n');

  // 1. Reference Solution
  console.log('Evaluating Reference Solution (solution.patch)...');
  const ref = evaluatePatch('Reference Solution', FINAL_SOL_PATCH);
  console.log(\`=> Reference Solution : \${ref.verdict} (\${ref.passes}/\${ref.total} passed)\`);
  if (ref.failures > 0) {
    console.log('   Failures:', ref.failedTitles);
  }

  // 2. Base Commit
  console.log('\\nEvaluating Base Commit (no solution applied)...');
  const base = evaluatePatch('Base Commit', null);
  console.log(\`=> Base Commit        : \${base.verdict} (\${base.passes}/\${base.total} passed, \${base.failures} failed)\`);

  // 3. 10 Nova Agents
  console.log('\\nEvaluating 10 Nova Agents...');
  const agentResults = [];
  for (let i = 1; i <= 10; i++) {
    const agentDirName = \`Nova_Nova_\${i}\`;
    const patchFile = path.join(AGENTS_DIR, agentDirName, 'solution-patch.patch');
    const result = evaluatePatch(\`Nova Agent #\${i}\`, patchFile);
    agentResults.push(result);
    console.log(\`  \${result.name.padEnd(16)}: \${result.verdict.padEnd(6)} | Passed: \${String(result.passes).padStart(2)}/\${result.total} | Failed: \${String(result.failures).padStart(2)}\`);
    if (result.failures > 0 && result.failures < 6) {
      console.log(\`     Failed tests: \${result.failedTitles.map(f => f.title).join(', ')}\`);
    }
  }

  // 4. Metrics
  const totalAgents = agentResults.length;
  const passedAgents = agentResults.filter(r => r.verdict === 'PASS').length;
  const passRate = (passedAgents / totalAgents) * 100;

  console.log('\\n================================================================');
  console.log('                      NOVA AGENTS AUDIT SUMMARY                 ');
  console.log('================================================================');
  console.log(\`Total Nova Agents Evaluated : \${totalAgents}\`);
  console.log(\`Passing Nova Agents         : \${passedAgents}\`);
  console.log(\`Failing Nova Agents         : \${totalAgents - passedAgents}\`);
  console.log(\`Nova Pass Rate              : \${passRate.toFixed(1)}%\`);
  console.log(\`Difficulty Requirement (<=50%): \${passRate <= 50 ? 'PASS (PASSED DIFFICULTY GATE)' : 'FAIL'}\`);
  console.log(\`Solvability Requirement (>=1) : \${passedAgents >= 1 ? 'PASS (CONFIRMED SOLVABLE)' : 'FAIL'}\`);
  console.log('================================================================\\n');

  // Reset repo to clean state
  cp.execSync('git reset --hard HEAD', { cwd: CLEAN_REPO, stdio: 'ignore' });
  cp.execSync('git clean -fd', { cwd: CLEAN_REPO, stdio: 'ignore' });
  cp.execSync(\`git apply --ignore-whitespace "\${FINAL_SOL_PATCH}"\`, { cwd: CLEAN_REPO, stdio: 'ignore' });
  syncLib();
}

main().catch(console.error);

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const repo = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const monshaDir = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';
const callbackDir = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_callback';
const solPatch = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_SUBMISSION_solution.patch';

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function runAgent(name, patchPath) {
  // 1. Reset repo to base 7539854
  try {
    cp.execSync('git checkout 7539854 -- src', { cwd: repo, stdio: 'ignore' });
  } catch (e) {
    return { name, error: 'Reset failed: ' + e.message };
  }

  // 2. Apply patch
  if (patchPath) {
    try {
      const content = fs.readFileSync(patchPath, 'utf8').replace(/\r\n/g, '\n');
      const tmp = path.join(repo, 'temp_eval.patch');
      fs.writeFileSync(tmp, content, 'utf8');
      try {
        cp.execSync('git apply --ignore-whitespace temp_eval.patch', { cwd: repo, stdio: 'ignore' });
      } catch (_) {
        cp.execSync('git apply --3way temp_eval.patch', { cwd: repo, stdio: 'ignore' });
      }
      fs.unlinkSync(tmp);
    } catch (e) {
      return { name, error: 'Patch apply failed: ' + e.message, passes: 0, failures: 55, verdict: 'FAIL' };
    }
  }

  // 3. Sync src to lib
  copyDir(path.join(repo, 'src'), path.join(repo, 'lib'));

  // 4. Run compliance test suite
  try {
    const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --timeout 5000', {
      cwd: repo,
      encoding: 'utf8'
    });
    const passMatch = out.match(/(\d+) passing/);
    const failMatch = out.match(/(\d+) failing/);
    const passes = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failures = failMatch ? parseInt(failMatch[1], 10) : 0;
    return {
      name,
      passes,
      failures,
      total: passes + failures,
      verdict: failures === 0 && passes > 0 ? 'PASS' : 'FAIL'
    };
  } catch (e) {
    const out = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
    const passMatch = out.match(/(\d+) passing/);
    const failMatch = out.match(/(\d+) failing/);
    const passes = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failures = failMatch ? parseInt(failMatch[1], 10) : 0;
    return {
      name,
      passes,
      failures,
      total: passes + failures,
      verdict: 'FAIL',
      error: out.slice(-200)
    };
  }
}

console.log('Testing Reference Solution...');
const refRes = runAgent('Reference Solution', solPatch);
console.log('Reference Solution:', refRes);

console.log('\nTesting Base Commit (no patch)...');
const baseRes = runAgent('Base Commit', null);
console.log('Base Commit:', baseRes);

console.log('\nTesting Monsha Agents...');
const monshaResults = [];
for (const ag of ['Nova_Nova_1', 'Nova_Nova_2', 'Nova_Nova_3', 'Nova_Nova_4', 'Nova_Nova_5', 'Nova_Nova_6', 'Nova_Nova_7', 'Nova_Nova_8', 'Nova_Nova_9', 'Nova_Nova_10', 'Orion_Nova']) {
  const p = path.join(monshaDir, ag, 'solution-patch.patch');
  const res = runAgent(ag, p);
  monshaResults.push(res);
  console.log(`  ${ag.padEnd(16)}: ${res.verdict.padEnd(5)} (${res.passes}/${res.total || 55})`);
}

// Restore reference solution
runAgent('Reference Solution', solPatch);

console.log('\nMonsha Summary:');
const passCount = monshaResults.filter(r => r.verdict === 'PASS').length;
console.log(`Total: ${monshaResults.length}, Passing: ${passCount}, Failing: ${monshaResults.length - passCount}`);

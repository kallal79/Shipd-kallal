const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');
const TEST_PATCH = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');

console.log('Testing Base Commit (without solution.patch)...');
// 1. Reset repo to base
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });

// 2. Apply ONLY test patch
cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
try { cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (_) {}

// 3. Run mocha with json reporter
let jsonOut = '';
try {
  jsonOut = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json --timeout 3000', {
    cwd: SUPERAGENT,
    encoding: 'utf8',
    timeout: 150000
  });
} catch (err) {
  jsonOut = err.stdout;
}

// 4. Restore superagent back to solution patch immediately
const SOL_PATCH = path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch');
cp.execSync(`git apply "${SOL_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
try { cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' }); } catch (_) {}

try {
  const json = JSON.parse(jsonOut);
  fs.writeFileSync(path.join(ROOT, 'scratch/base_results.json'), jsonOut, 'utf8');
  console.log('Base commit results:');
  console.log(`  Tests: ${json.stats.tests}`);
  console.log(`  Passes: ${json.stats.passes}`);
  json.passes.forEach(p => console.log('  PASS ON BASE:', p.fullTitle));
  console.log(`  Failures: ${json.stats.failures}`);
  console.log(`  Pending: ${json.stats.pending}`);
  
  // Check if any hook failed
  const hookFailures = (json.failures || []).filter(f => f.title && (f.title.includes('hook') || f.title.includes('before') || f.title.includes('after')));
  console.log(`  Hook failures count: ${hookFailures.length}`);
  if (hookFailures.length > 0) {
    hookFailures.forEach(h => console.log('    Hook failed:', h.fullTitle));
  } else {
    console.log('  NO HOOK FAILURES! All failures are individual test assertions as expected for F2P.');
  }
} catch (e) {
  console.log('Could not parse JSON output:', e.message);
  console.log('Output snippet:', jsonOut.slice(0, 500));
}

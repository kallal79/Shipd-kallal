const cp = require('child_process');
const path = require('path');
const ROOT = __dirname;
const SUPERAGENT = path.join(ROOT, 'superagent');

console.log('Resetting superagent to base commit 7539854...');
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT });

console.log('Applying test patch only...');
cp.execSync(`git apply "${path.join(ROOT, 'FINAL_CLEAN_TEST.patch')}"`, { cwd: SUPERAGENT });

console.log('Running tests on BASE commit (WITHOUT solution)...');
try {
  const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --timeout 15000 --reporter json', {
    cwd: SUPERAGENT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });
  const json = JSON.parse(out.substring(out.indexOf('{')));
  console.log('Unexpected passing tests on base:');
  json.passes.forEach(p => console.log('  PASS ON BASE:', p.fullTitle));
  console.log('Total passes on base:', json.passes.length);
} catch (e) {
  const out = e.stdout || '';
  const jsonStart = out.indexOf('{');
  if (jsonStart !== -1) {
    const json = JSON.parse(out.substring(jsonStart));
    console.log('Unexpected passing tests on base:');
    json.passes.forEach(p => console.log('  PASS ON BASE:', p.fullTitle));
    console.log('\nTotal passes on base:', json.passes.length);
    console.log('Total failures on base:', json.failures.length);
    console.log('Total tests:', json.stats.tests);
  } else {
    console.log('Error parsing mocha output:', e.message);
    console.log(out.substring(0, 500));
  }
}

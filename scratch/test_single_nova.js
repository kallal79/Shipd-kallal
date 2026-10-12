const cp = require('child_process');
const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = ROOT + '/superagent';
const patchFile = ROOT + '/extracted_monsha/Nova_Nova_9/solution-patch.patch';

cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply "${ROOT}/FINAL_CLEAN_TEST.patch"`, { cwd: SUPERAGENT, stdio: 'ignore' });
cp.execSync(`git apply --ignore-whitespace "${patchFile}"`, { cwd: SUPERAGENT, stdio: 'ignore' });

try {
  const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --reporter json --timeout 400', {
    cwd: SUPERAGENT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 60000
  });
  console.log('Result:', JSON.parse(out).stats);
} catch (e) {
  if (e.stdout) {
    try {
      console.log('Result err:', JSON.parse(e.stdout).stats);
    } catch (_) {
      console.log('Could not parse JSON from stdout. Length:', e.stdout.length);
      console.log(e.stdout.slice(0, 300));
    }
  } else {
    console.log('Execution error:', e.message);
  }
}

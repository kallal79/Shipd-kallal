const fs = require('fs');
const cp = require('child_process');

const ROOT = process.cwd().replace(/\\/g, '/');
const SUPERAGENT = `${ROOT}/superagent`;
const AGENT_RUNS_DIR = `${ROOT}/scratch/agent-runs-kali-monsha`;

async function main() {
  const dirs = fs.readdirSync(AGENT_RUNS_DIR).filter(d => fs.statSync(`${AGENT_RUNS_DIR}/${d}`).isDirectory());
  for (const d of dirs) {
    const dir = `${AGENT_RUNS_DIR}/${d}`;
    const patchFile = `${dir}/solution-patch.patch`;
    
    console.log(`\n================ Run: ${d} ================`);
    if (fs.existsSync(patchFile)) {
      try {
        cp.execSync('git reset --hard v10.2.3 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
        cp.execSync(`git apply --ignore-whitespace "${ROOT}/test.patch"`, { cwd: SUPERAGENT, stdio: 'ignore' });
        cp.execSync(`git apply --ignore-whitespace "${patchFile}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
        cp.execSync('npm run build:lib', { cwd: SUPERAGENT, stdio: 'ignore' });

        try {
          const out = cp.execSync('node node_modules/mocha/bin/_mocha test/support/setup.js test/node/hidden_verify.js --timeout 2000 --exit --reporter json', { cwd: SUPERAGENT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
          const res = JSON.parse(out);
          console.log(`Status: PASS (${res.stats.passes} passing)`);
        } catch (e) {
          try {
            const res = JSON.parse(e.stdout);
            const failures = res.failures.map(f => f.title);
            console.log(`Status: FAIL (${res.stats.failures} failing)`);
            console.log('Failed tests:', failures);
          } catch(err2) {
            console.log('Status: CRASH or Parse Error');
            console.log(e.stdout || e.stderr || e.message);
          }
        }
      } catch (err) {
        console.log('Apply or build error:', err.message);
      }
    } else {
      console.log('No solution-patch.patch found');
    }
  }
}

main().catch(console.error);

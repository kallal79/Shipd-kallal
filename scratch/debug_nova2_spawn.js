const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/USER/OneDrive/Desktop/JAGAN';
const SUPERAGENT = path.join(ROOT, 'superagent');
const TEST_PATCH = path.join(ROOT, 'FINAL_CLEAN_TEST.patch');
const AGENT_PATCH = path.join(ROOT, 'nova_extracted/Nova_Nova_2/solution-patch.patch');
const CLEAN_SOL_PATCH = path.join(ROOT, 'FINAL_CLEAN_SOLUTION.patch');

console.log('Testing Nova_Nova_2 with spec reporter and 1s timeout...');
try {
  cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync(`git apply --whitespace=fix "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync(`git apply --whitespace=fix "${AGENT_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync('npx babel --config-file ./.lib.babelrc src --out-dir lib', { cwd: SUPERAGENT, stdio: 'ignore' });

  // Run mocha with spawn and stream stdout
  const proc = cp.spawn('npx', ['mocha', 'test/node/size_limits_compliance_b5e2d.js', '--timeout', '1000', '--exit'], {
    cwd: SUPERAGENT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
  });

  let output = '';
  proc.stdout.on('data', d => {
    const str = d.toString();
    output += str;
    const lines = str.split('\n');
    for (const l of lines) {
      if (l.includes('passing') || l.includes('failing') || l.includes('Error') || l.includes('timeout')) {
        console.log('  [MOCHA]:', l.trim());
      }
    }
  });

  proc.stderr.on('data', d => {
    console.log('  [STDERR]:', d.toString().trim());
  });

  proc.on('close', code => {
    console.log(`Mocha exited with code ${code}`);
    const passMatch = output.match(/(\d+) passing/);
    const failMatch = output.match(/(\d+) failing/);
    console.log('Passed:', passMatch ? passMatch[1] : 0);
    console.log('Failed:', failMatch ? failMatch[1] : 0);

    // Restore clean solution
    cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
    cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
    cp.execSync(`git apply "${CLEAN_SOL_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
    cp.execSync('npx babel --config-file ./.lib.babelrc src --out-dir lib', { cwd: SUPERAGENT, stdio: 'ignore' });
    console.log('Restored clean solution.');
  });
} catch (err) {
  console.log('Error setup:', err.message);
  cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync(`git apply "${TEST_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync(`git apply "${CLEAN_SOL_PATCH}"`, { cwd: SUPERAGENT, stdio: 'ignore' });
  cp.execSync('npx babel --config-file ./.lib.babelrc src --out-dir lib', { cwd: SUPERAGENT, stdio: 'ignore' });
}

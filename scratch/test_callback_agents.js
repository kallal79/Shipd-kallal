const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const repo = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const callbackDir = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_callback';

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

for (let i = 1; i <= 7; i++) {
  const ag = `Nova_Nova_${i}`;
  const p = path.join(callbackDir, ag, 'solution-patch.patch');
  if (!fs.existsSync(p)) continue;
  
  cp.execSync('git reset --hard 7539854', { cwd: repo, stdio: 'ignore' });
  cp.execSync('git clean -fd', { cwd: repo, stdio: 'ignore' });

  const content = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const tmp = path.join(repo, 'temp_cb.patch');
  fs.writeFileSync(tmp, content, 'utf8');
  let applied = false;
  try {
    cp.execSync('git apply --ignore-whitespace temp_cb.patch', { cwd: repo, stdio: 'ignore' });
    applied = true;
  } catch (_) {
    try {
      cp.execSync('git apply --3way temp_cb.patch', { cwd: repo, stdio: 'ignore' });
      applied = true;
    } catch (_) {}
  }
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);

  if (!applied) {
    console.log(`Callback ${ag}: FAIL (Patch reject)`);
    continue;
  }

  copyDir(path.join(repo, 'src'), path.join(repo, 'lib'));

  try {
    const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --timeout 5000', {
      cwd: repo,
      encoding: 'utf8'
    });
    const passMatch = out.match(/(\d+) passing/);
    const failMatch = out.match(/(\d+) failing/);
    const passes = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failures = failMatch ? parseInt(failMatch[1], 10) : 0;
    console.log(`Callback ${ag}: ${failures === 0 && passes > 0 ? 'PASS' : 'FAIL'} (${passes}/${passes + failures})`);
  } catch (e) {
    const out = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
    const passMatch = out.match(/(\d+) passing/);
    const failMatch = out.match(/(\d+) failing/);
    const passes = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failures = failMatch ? parseInt(failMatch[1], 10) : 0;
    console.log(`Callback ${ag}: FAIL (${passes}/${passes + failures})`);
  }
}

// Restore reference solution
const solPatch = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_SUBMISSION_solution.patch';
cp.execSync('git reset --hard 7539854', { cwd: repo, stdio: 'ignore' });
cp.execSync('git clean -fd', { cwd: repo, stdio: 'ignore' });
const content = fs.readFileSync(solPatch, 'utf8').replace(/\r\n/g, '\n');
const tmp = path.join(repo, 'temp_cb.patch');
fs.writeFileSync(tmp, content, 'utf8');
cp.execSync('git apply --ignore-whitespace temp_cb.patch', { cwd: repo, stdio: 'ignore' });
fs.unlinkSync(tmp);
copyDir(path.join(repo, 'src'), path.join(repo, 'lib'));
console.log('Restored reference solution!');

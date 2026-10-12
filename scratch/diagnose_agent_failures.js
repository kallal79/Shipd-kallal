const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const repo = 'C:/Users/USER/OneDrive/Desktop/JAGAN/superagent';
const monshaDir = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';

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

for (const ag of ['Nova_Nova_8', 'Nova_Nova_1', 'Nova_Nova_10', 'Nova_Nova_4']) {
  console.log(`\n========================================`);
  console.log(`Diagnosing ${ag}...`);
  cp.execSync('git checkout 7539854 -- src', { cwd: repo, stdio: 'ignore' });
  const p = path.join(monshaDir, ag, 'solution-patch.patch');
  const content = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const tmp = path.join(repo, 'temp_diag.patch');
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    cp.execSync('git apply --ignore-whitespace temp_diag.patch', { cwd: repo, stdio: 'ignore' });
  } catch (_) {
    cp.execSync('git apply --3way temp_diag.patch', { cwd: repo, stdio: 'ignore' });
  }
  fs.unlinkSync(tmp);
  copyDir(path.join(repo, 'src'), path.join(repo, 'lib'));

  try {
    cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --exit --timeout 5000 --reporter list', {
      cwd: repo,
      encoding: 'utf8',
      stdio: 'inherit'
    });
  } catch (e) {
    // Expected failures
  }
}

// Restore reference solution
const solPatch = 'C:/Users/USER/OneDrive/Desktop/JAGAN/FINAL_SUBMISSION_solution.patch';
cp.execSync('git checkout 7539854 -- src', { cwd: repo, stdio: 'ignore' });
const content = fs.readFileSync(solPatch, 'utf8').replace(/\r\n/g, '\n');
const tmp = path.join(repo, 'temp_diag.patch');
fs.writeFileSync(tmp, content, 'utf8');
cp.execSync('git apply --ignore-whitespace temp_diag.patch', { cwd: repo, stdio: 'ignore' });
fs.unlinkSync(tmp);
copyDir(path.join(repo, 'src'), path.join(repo, 'lib'));

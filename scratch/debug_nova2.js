const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = 'c:/Users/USER/OneDrive/Desktop/JAGAN';
const REPO = path.join(BASE, 'superagent');
const TEST_PATCH = path.join(BASE, 'FINAL_CLEAN_TEST.patch');
const solPatch = path.join(BASE, 'nova_extracted', 'Nova_Nova_2', 'solution-patch.patch');
const tempRepo = path.join(BASE, 'scratch', 'temp_debug_nova2');

if (fs.existsSync(tempRepo)) {
  const nm = path.join(tempRepo, 'node_modules');
  if (fs.existsSync(nm)) {
    try { execSync(`rmdir "${nm}"`, { stdio: 'pipe' }); } catch(e) {}
  }
  execSync(`rmdir /s /q "${tempRepo}"`, { stdio: 'pipe' });
}

console.log('1. Cloning fresh repo...');
execSync(`git clone "${REPO}" "${tempRepo}"`, { stdio: 'pipe' });
execSync(`git checkout 7539854`, { cwd: tempRepo, stdio: 'pipe' });

console.log('2. Linking node_modules...');
execSync(`mklink /J "${path.join(tempRepo, 'node_modules')}" "${path.join(REPO, 'node_modules')}"`, { stdio: 'pipe' });

console.log('3. Applying test patch...');
try {
  execSync(`git apply --whitespace=fix "${TEST_PATCH}"`, { cwd: tempRepo, stdio: 'pipe' });
  console.log('Test patch applied successfully.');
} catch (e) {
  console.log('Test patch failed:', e.stderr ? e.stderr.toString() : e.message);
}

console.log('4. Applying solution patch...');
try {
  execSync(`git apply --whitespace=fix "${solPatch}"`, { cwd: tempRepo, stdio: 'pipe' });
  console.log('Solution patch applied successfully.');
} catch (e) {
  console.log('Solution patch failed:', e.stderr ? e.stderr.toString() : e.message);
}

console.log('5. Building lib...');
try {
  execSync(`npx babel --config-file ./.lib.babelrc src --out-dir lib`, { cwd: tempRepo, stdio: 'pipe' });
  console.log('Build successful.');
} catch (e) {
  console.log('Build failed:', e.stderr ? e.stderr.toString() : e.message);
}

console.log('6. Running Mocha without json reporter...');
const res = spawnSync('npx', ['mocha', 'test/node/size_limits_compliance_b5e2d.js', '--exit', '--timeout', '10000'], {
  cwd: tempRepo,
  encoding: 'utf8',
  shell: true
});

console.log('Exit code:', res.status);
console.log('STDOUT:\n', res.stdout);
console.log('STDERR:\n', res.stderr);

// Cleanup
try {
  const nm = path.join(tempRepo, 'node_modules');
  if (fs.existsSync(nm)) execSync(`rmdir "${nm}"`, { stdio: 'pipe' });
  execSync(`rmdir /s /q "${tempRepo}"`, { stdio: 'pipe' });
} catch(e) {}

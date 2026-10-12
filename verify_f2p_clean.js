const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SUPERAGENT = path.join(ROOT, 'superagent');

console.log('1. Resetting to clean base 7539854...');
cp.execSync('git reset --hard 7539854 && git clean -fd', { cwd: SUPERAGENT });

console.log('2. Removing lib completely...');
const libPath = path.join(SUPERAGENT, 'lib');
if (fs.existsSync(libPath)) {
  fs.rmSync(libPath, { recursive: true, force: true });
}

console.log('3. Compiling clean base src -> lib...');
cp.execSync('npm run build:lib', { cwd: SUPERAGENT });

console.log('4. Applying test patch...');
cp.execSync(`git apply "${path.join(ROOT, 'FINAL_CLEAN_TEST.patch')}"`, { cwd: SUPERAGENT });

console.log('5. Running mocha on clean base...');
try {
  const out = cp.execSync('npx mocha test/node/size_limits_compliance_b5e2d.js --timeout 15000 --reporter json', {
    cwd: SUPERAGENT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });
  const json = JSON.parse(out.substring(out.indexOf('{')));
  console.log('Passes on base:', json.passes.length);
  json.passes.forEach(p => console.log('  PASS ON BASE:', p.fullTitle));
} catch (e) {
  const out = e.stdout || '';
  const jsonStart = out.indexOf('{');
  if (jsonStart !== -1) {
    const json = JSON.parse(out.substring(jsonStart));
    console.log('Passes on base:', json.passes.length);
    json.passes.forEach(p => console.log('  PASS ON BASE:', p.fullTitle));
    console.log('Failures on base:', json.failures.length);
  } else {
    console.log('Error running mocha:', e.message);
  }
}

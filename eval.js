const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const repo = path.join(ROOT, 'superagent');
const agentsDir = path.join(ROOT, 'extracted_monsha');

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

const agents = [
  'Nova_Nova_1',
  'Nova_Nova_2',
  'Nova_Nova_3',
  'Nova_Nova_4',
  'Nova_Nova_5',
  'Nova_Nova_6',
  'Nova_Nova_7',
  'Nova_Nova_8',
  'Nova_Nova_9',
  'Nova_Nova_10',
  'Orion_Nova'
];

const results = {};

console.log('=== STARTING FAST 11-AGENT EVALUATION ===');

for (const agent of agents) {
  process.stdout.write(`Testing ${agent}... `);
  const agentFolder = path.join(agentsDir, agent);
  let patchFile = path.join(agentFolder, 'solution.patch');
  if (!fs.existsSync(patchFile)) {
    patchFile = path.join(agentFolder, 'solution-patch.patch');
  }

  if (!fs.existsSync(patchFile)) {
    console.log(`FAIL (No patch file found)`);
    results[agent] = { passed: false, reason: 'No patch file' };
    continue;
  }

  // 1. Reset repo files to commit 38b258b
  try {
    execSync('git checkout 38b258b -- src test.sh test', { cwd: repo, stdio: 'ignore' });
  } catch (e) {
    console.log(`FAIL (Reset failure)`);
    results[agent] = { passed: false, reason: 'Reset failure' };
    continue;
  }

  // 2. Apply agent solution patch
  let patchApplied = false;
  try {
    const patchContent = fs.readFileSync(patchFile, 'utf8').replace(/\r\n/g, '\n');
    fs.writeFileSync(path.join(repo, 'temp_agent.patch'), patchContent);
    execSync('git apply temp_agent.patch', { cwd: repo, stdio: 'ignore' });
    patchApplied = true;
  } catch (e) {
    try {
      execSync('git apply --3way temp_agent.patch', { cwd: repo, stdio: 'ignore' });
      patchApplied = true;
    } catch (_) {
      patchApplied = false;
    }
  } finally {
    if (fs.existsSync(path.join(repo, 'temp_agent.patch'))) {
      fs.unlinkSync(path.join(repo, 'temp_agent.patch'));
    }
  }

  if (!patchApplied) {
    console.log(`FAIL (Patch rejected)`);
    results[agent] = { passed: false, reason: 'Patch rejected' };
    continue;
  }

  // 3. Sync src to lib
  copyDir(path.join(repo, 'src'), path.join(repo, 'lib'));

  // 4. Run mocha on hidden_verify.js with 2500ms timeout
  try {
    const mochaOut = execSync('npx mocha test/node/hidden_verify.js --exit --timeout 2500', {
      cwd: repo,
      encoding: 'utf8'
    });

    const passMatch = mochaOut.match(/(\d+) passing/);
    const passedCount = passMatch ? parseInt(passMatch[1], 10) : 0;
    const isFullPass = passedCount === 32 && !mochaOut.includes('failing');

    if (isFullPass) {
      console.log(`PASS (${passedCount}/32 passing)`);
      results[agent] = { passed: true, passedCount, total: 32 };
    } else {
      console.log(`FAIL (${passedCount}/32 passing)`);
      results[agent] = { passed: false, passedCount, total: 32, reason: 'Incomplete implementation' };
    }
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '') + err.message;
    const passMatch = out.match(/(\d+) passing/);
    const failMatch = out.match(/(\d+) failing/);
    const passedCount = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failedCount = failMatch ? parseInt(failMatch[1], 10) : 0;

    console.log(`FAIL (${passedCount}/32 passed, ${failedCount} failed)`);
    results[agent] = { passed: false, passedCount, failedCount, total: 32, reason: 'Test failure' };
  }
}

// Summary
let totalPasses = 0;
let totalFails = 0;
for (const agent of agents) {
  if (results[agent] && results[agent].passed) totalPasses++;
  else totalFails++;
}

console.log('\n=== FINAL NOVA AGENT LOCAL EVALUATION DISTRIBUTION ===');
console.log(`Total Agent Runs Evaluated: ${agents.length}`);
console.log(`Passed Agents: ${totalPasses}`);
console.log(`Failed Agents: ${totalFails}`);
console.log(`Pass Rate: ${((totalPasses / agents.length) * 100).toFixed(2)}%`);

fs.writeFileSync('C:/Users/USER/OneDrive/Desktop/JAGAN/evaluation_summary.json', JSON.stringify(results, null, 2));

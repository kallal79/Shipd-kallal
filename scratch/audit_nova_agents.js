const fs = require('fs');
const path = require('path');

const MONSHA = 'C:/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha';
const dirs = [
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

console.log('================================================================');
console.log('              LIVE AUDIT OF ALL 11 NOVA AGENTS                  ');
console.log('================================================================');

let passCount = 0;
let failCount = 0;
const results = [];

dirs.forEach((d, idx) => {
  const dir = path.join(MONSHA, d);
  const evalFile = path.join(dir, 'eval-result.json');
  const junitFile = path.join(dir, 'junit-new.xml');
  const solPatch = path.join(dir, 'solution-patch.patch');
  const wsPatch = path.join(dir, 'workspace-diff.patch');
  const testLog = path.join(dir, 'test-log.txt');
  const junitBase = path.join(dir, 'junit-baseline.xml');

  const evalJson = JSON.parse(fs.readFileSync(evalFile, 'utf8'));
  const xml = fs.readFileSync(junitFile, 'utf8');
  
  const mTests = xml.match(/tests="(\d+)"/);
  const mFails = xml.match(/failures="(\d+)"/);
  const tests = mTests ? parseInt(mTests[1], 10) : 0;
  const fails = mFails ? parseInt(mFails[1], 10) : 0;
  const passes = tests - fails;

  const solSize = fs.existsSync(solPatch) ? fs.statSync(solPatch).size : 0;
  const allFilesExist = fs.existsSync(evalFile) && fs.existsSync(junitFile) && fs.existsSync(solPatch) && fs.existsSync(wsPatch) && fs.existsSync(testLog) && fs.existsSync(junitBase);

  const status = evalJson.verdict === 'PASS_LEGITIMATE' ? 'PASS' : 'FAIL';
  if (status === 'PASS') passCount++; else failCount++;

  results.push({
    index: idx + 1,
    agent: d,
    status,
    verdict: evalJson.verdict,
    tests,
    passes,
    fails,
    patchBytes: solSize,
    allArtifactsPresent: allFilesExist,
    reasoning: evalJson.details ? evalJson.details.reasoning : ''
  });

  console.log(`[${String(idx + 1).padStart(2)}] ${d.padEnd(14)} | Status: ${status.padEnd(4)} | Verdict: ${evalJson.verdict.padEnd(23)} | Passes: ${String(passes).padStart(3)}/${tests} | Fails: ${String(fails).padStart(2)} | SolSize: ${String(solSize).padStart(6)}B | Files: ${allFilesExist ? 'OK' : 'MISSING'}`);
});

console.log('================================================================');
console.log('                    SUMMARY OF NOVA AUDIT                       ');
console.log('================================================================');
console.log(`Total Agents            : ${dirs.length}`);
console.log(`Passing Agents          : ${passCount} (${dirs.filter((d, i) => results[i].status === 'PASS').join(', ')})`);
console.log(`Failing Agents          : ${failCount} (${dirs.filter((d, i) => results[i].status === 'FAIL').join(', ')})`);
console.log(`Pass Rate (All 11)      : ${((passCount / dirs.length) * 100).toFixed(1)}%`);
console.log(`Pass Rate (10 Pure Nova): ${((dirs.filter((d, i) => results[i].status === 'PASS' && d !== 'Orion_Nova').length / 10) * 100).toFixed(1)}% (3 / 10)`);
console.log(`Difficulty Gate (<= 50%): ${passCount / dirs.length <= 0.5 ? 'PASS (PASSED DIFFICULTY GATE)' : 'FAIL'}`);
console.log(`Solvability Gate (>= 1) : ${passCount >= 1 ? 'PASS (CONFIRMED SOLVABLE)' : 'FAIL'}`);
console.log('================================================================');
